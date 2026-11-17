#!/usr/bin/env bash
# Store the SQLite snapshot in a dedicated Git ref, not the code branch.
# A missing ref is the only condition that permits bootstrapping a fresh DB.
set -euo pipefail

: "${DATABASE_PATH:?DATABASE_PATH is required}"
# Use the same directory for the state snapshot and its restore metadata.
state_dir="$(dirname "$DATABASE_PATH")"
branch="${STATE_BRANCH:-bot-state}"
ref="refs/heads/$branch"
git check-ref-format "$ref"
mkdir -p "$state_dir"
base_file="$state_dir/base-commit"

# Supply Git credentials only in the restore/save steps. Local CI uses a
# file:// remote and does not need a token. Never put the token in a URL.
if [[ -n "${GH_TOKEN:-}" ]]; then
  auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  # Actions consumes mask commands; other hosts would log the encoded secret.
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then echo "::add-mask::$auth"; fi
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=http.https://github.com/.extraheader
  export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth"
fi

verify_db() {
  python3 - "$1" <<'PY'
import sqlite3
import sys
from pathlib import Path
path = Path(sys.argv[1]).resolve()
with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
    if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
        raise SystemExit("SQLite integrity check failed")
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"jobs", "identities", "sources"}.issubset(tables):
        raise SystemExit("Invalid job database schema")
PY
}

lock_ref="refs/heads/$branch-lock"
lock_file="$state_dir/lock-commit"

case "${1:-}" in
  lock)
    [[ ! -e "$lock_file" ]] || { echo "Local lock metadata already exists" >&2; exit 1; }
    # A unique orphan commit is an ownership token; creation is atomic on the remote.
    nonce="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    empty_tree="$(git mktree </dev/null)"
    owner="$(printf 'Job bot execution lock %s\n' "$nonce" | git -c user.name='discord-work-bot' -c user.email='bot@users.noreply.github.com' commit-tree "$empty_tree")"
    if ! git push --force-with-lease="$lock_ref:" origin "$owner:$lock_ref"; then
      echo "Could not acquire shared execution lock; another job may be active. No polling performed." >&2
      exit 1
    fi
    printf '%s\n' "$owner" > "$lock_file"
    echo "Acquired shared execution lock $owner"
    ;;
  unlock)
    [[ -f "$lock_file" ]] || { echo "Missing local lock ownership" >&2; exit 1; }
    owner="$(cat "$lock_file")"
    # Delete only our own lock, never a replacement created by another runner.
    git push --force-with-lease="$lock_ref:$owner" origin ":$lock_ref"
    rm "$lock_file"
    echo "Released shared execution lock"
    ;;
  restore)
    if [[ -e "$DATABASE_PATH" || -e "$base_file" ]]; then
      echo "Refusing to overwrite existing local state" >&2
      exit 1
    fi
    if remote="$(git ls-remote --exit-code origin "$ref")"; then
      git fetch --no-tags origin "$ref"
      base="$(git rev-parse FETCH_HEAD)"
      git show "$base:jobs.db" > "$DATABASE_PATH.tmp"
      verify_db "$DATABASE_PATH.tmp"
      mv "$DATABASE_PATH.tmp" "$DATABASE_PATH"
      printf '%s\n' "$base" > "$base_file"
      echo "Restored job database from $base"
    else
      status=$?
      if [[ "$status" != 2 ]]; then
        echo "Could not inspect state branch; aborting rather than resetting" >&2
        exit "$status"
      fi
      printf '%s\n' 'EMPTY' > "$base_file"
      echo "No state branch: first run will initialize the database"
    fi
    ;;
  save)
    [[ -f "$base_file" ]] || { echo "Missing restore metadata" >&2; exit 1; }
    base="$(cat "$base_file")"
    if [[ ! -f "$DATABASE_PATH" ]]; then
      if [[ "$base" == EMPTY ]]; then
        echo "No database created; nothing to persist"
        exit 0
      fi
      echo "Previously restored database is missing; refusing to overwrite state" >&2
      exit 1
    fi
    # The one-shot bot closes SQLite before the workflow reaches this step.
    # SQLite backup safely incorporates any remaining WAL data.
    snapshot="$state_dir/snapshot.db"
    rm -f "$snapshot"
    python3 - "$DATABASE_PATH" "$snapshot" <<'PY'
import sqlite3
import sys
from pathlib import Path
source = Path(sys.argv[1]).resolve()
with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db:
    with sqlite3.connect(sys.argv[2]) as snapshot:
        db.backup(snapshot)
        snapshot.execute("PRAGMA journal_mode=DELETE").fetchall()
PY
    verify_db "$snapshot"
    index="$state_dir/jobs.json"
    node "$(dirname "${BASH_SOURCE[0]}")/export-search.ts" "$snapshot" "$index"
    blob="$(git hash-object -w "$snapshot")"
    index_blob="$(git hash-object -w "$index")"
    tree="$(printf '100644 blob %s\tjobs.db\n100644 blob %s\tjobs.json\n' "$blob" "$index_blob" | git mktree)"
    parents=()
    if [[ "$base" != EMPTY ]]; then
      # Compare logical contents to avoid writing commits for no-op polls.
      previous="$state_dir/previous.db"
      git show "$base:jobs.db" > "$previous"
      if git show "$base:jobs.json" > "$state_dir/previous.json" 2>/dev/null && cmp -s "$state_dir/previous.json" "$index" && python3 - "$previous" "$snapshot" <<'PY'
import sqlite3
import sys
def dump(path):
    with sqlite3.connect(path) as db:
        return list(db.iterdump())
sys.exit(0 if dump(sys.argv[1]) == dump(sys.argv[2]) else 1)
PY
      then
        echo "No state changes"
        exit 0
      fi
      parents=(-p "$base")
    fi
    commit="$(printf 'Update job bot state\n' | git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit-tree "$tree" "${parents[@]}")"
    # Never force-push: an unexpected concurrent writer must fail visibly.
    # Explicit lease for initial creation prevents replacing unrelated state.
    if [[ "$base" == EMPTY ]]; then
      git push --force-with-lease="$ref:" origin "$commit:$ref"
    else
      git push origin "$commit:$ref"
    fi
    echo "Persisted job database to $branch at $commit"
    ;;
  *)
    echo "Usage: $0 lock|restore|save|unlock" >&2
    exit 2
    ;;
esac
