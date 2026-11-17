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
        CREATE TABLE jobs (id TEXT PRIMARY KEY, state TEXT);
        CREATE TABLE identities (identity TEXT PRIMARY KEY);
        CREATE TABLE sources (name TEXT PRIMARY KEY);
        INSERT INTO jobs VALUES ('example', 'pending');
    """)
PY
bash "$root/scripts/workflow-state.sh" save
first="$(git ls-remote origin refs/heads/bot-state | cut -f1)"
[[ -n "$first" ]]

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
echo "Workflow state persistence tests passed."
