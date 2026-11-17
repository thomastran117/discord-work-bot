#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
unset GH_TOKEN
export STATE_BRANCH=bot-state
git init --bare "$temp/remote.git" >/dev/null
git init "$temp/client" >/dev/null
cd "$temp/client"
git remote add origin "$temp/remote.git"
export DATABASE_PATH="$temp/first/jobs.db"
bash "$root/scripts/workflow-state.sh" restore
python3 - "$DATABASE_PATH" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.executescript("""
        CREATE TABLE jobs (id TEXT PRIMARY KEY, state TEXT, payload TEXT, first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE identities (identity TEXT PRIMARY KEY);
        CREATE TABLE sources (name TEXT PRIMARY KEY);
        INSERT INTO jobs(id,state,payload) VALUES ('example', 'pending', '{"company":"RBC","title":"Software Developer","locations":["Toronto, ON"],"url":"https://example.com/job"}');
    """)
PY
bash "$root/scripts/workflow-state.sh" save
first="$(git ls-remote origin refs/heads/bot-state | cut -f1)"
[[ -n "$first" ]]
git fetch origin refs/heads/bot-state
git show FETCH_HEAD:jobs.json | python3 -c 'import sys,json; x=json.load(sys.stdin); assert x["version"] == 1 and x["jobs"][0]["company"] == "RBC" and "state" not in x["jobs"][0]'

# Simulate a fresh hosted runner, then mark one job delivered.
export DATABASE_PATH="$temp/second/jobs.db"
bash "$root/scripts/workflow-state.sh" restore
python3 - "$DATABASE_PATH" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    assert db.execute("SELECT state FROM jobs").fetchone() == ("pending",)
    db.execute("UPDATE jobs SET state='sent'")
PY
bash "$root/scripts/workflow-state.sh" save
second="$(git ls-remote origin refs/heads/bot-state | cut -f1)"
[[ "$first" != "$second" ]]

export DATABASE_PATH="$temp/third/jobs.db"
bash "$root/scripts/workflow-state.sh" restore
python3 - "$DATABASE_PATH" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    assert db.execute("SELECT state FROM jobs").fetchone() == ("sent",)
PY
bash "$root/scripts/workflow-state.sh" save
[[ "$(git ls-remote origin refs/heads/bot-state | cut -f1)" == "$second" ]]

# A broken remote is not mistaken for first-run initialization.
git remote set-url origin "$temp/nonexistent.git"
export DATABASE_PATH="$temp/fourth/jobs.db"
if bash "$root/scripts/workflow-state.sh" restore; then
  echo "Expected restore to fail for an unreachable remote" >&2
  exit 1
fi
[[ ! -e "$DATABASE_PATH" ]]
# Two independent hosts share the same remote lock.
git remote set-url origin "$temp/remote.git"
export DATABASE_PATH="$temp/lock-a/jobs.db"
bash "$root/scripts/workflow-state.sh" lock
owner="$(git ls-remote origin refs/heads/bot-state-lock | cut -f1)"
[[ -n "$owner" ]]
export DATABASE_PATH="$temp/lock-b/jobs.db"
if bash "$root/scripts/workflow-state.sh" lock; then
    echo "Expected second host to be excluded" >&2
    exit 1
fi
[[ "$(git ls-remote origin refs/heads/bot-state-lock | cut -f1)" == "$owner" ]]
export DATABASE_PATH="$temp/lock-a/jobs.db"
bash "$root/scripts/workflow-state.sh" unlock
export DATABASE_PATH="$temp/lock-b/jobs.db"
bash "$root/scripts/workflow-state.sh" lock
replacement="$(git ls-remote origin refs/heads/bot-state-lock | cut -f1)"
[[ "$replacement" != "$owner" ]]
# A stale owner's cleanup must not remove a new owner's lock.
printf '%s\n' "$owner" > "$temp/lock-a/lock-commit"
export DATABASE_PATH="$temp/lock-a/jobs.db"
if bash "$root/scripts/workflow-state.sh" unlock; then
    echo "Expected stale owner's unlock to fail" >&2
    exit 1
fi
[[ "$(git ls-remote origin refs/heads/bot-state-lock | cut -f1)" == "$replacement" ]]
export DATABASE_PATH="$temp/lock-b/jobs.db"
bash "$root/scripts/workflow-state.sh" unlock
[[ -z "$(git ls-remote origin refs/heads/bot-state-lock)" ]]
echo "Workflow state persistence and shared lock tests passed."
