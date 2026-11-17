#!/usr/bin/env bash
# Shared one-shot entrypoint for Railway and manual GitHub Actions.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-poll}"
days="${2:-7}"
if [[ "$mode" != poll && "$mode" != backfill ]] || [[ $# -gt 2 ]]; then
  echo "Usage: bash scripts/run-job.sh [poll|backfill [1-30]]" >&2
  exit 2
fi
if [[ "$mode" == backfill && ! "$days" =~ ^([1-9]|[12][0-9]|30)$ ]]; then
  echo "Backfill days must be a whole number from 1 to 30." >&2
  exit 2
fi
: "${DISCORD_WEBHOOK_URL:?DISCORD_WEBHOOK_URL is required}"
# A local file remote is permitted for offline tests, never with a hosted token.
if [[ -n "${STATE_REMOTE:-}" && -z "${GH_TOKEN:-}" ]]; then
  remote="$STATE_REMOTE"
else
  : "${GH_TOKEN:?GH_TOKEN is required for shared GitHub state}"
  repo="${STATE_REPOSITORY:-${GITHUB_REPOSITORY:-}}"
  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Set STATE_REPOSITORY to owner/repo" >&2; exit 2; }
  remote="https://github.com/$repo.git"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# Interrupted runs deliberately leave the remote lock for operator inspection.
trap 'exit 143' TERM
trap 'exit 130' INT
export DATABASE_PATH="$work/state/jobs.db"
export STATE_BRANCH=bot-state
export GIT_TERMINAL_PROMPT=0
git init -q "$work/git"
git -C "$work/git" remote add origin "$remote"
state() {
  (cd "$work/git" && timeout --kill-after=10s 120s bash "$root/scripts/workflow-state.sh" "$1")
}

state lock
if ! state restore; then
  state unlock
  exit 1
fi

cd "$root"
poll_status=0
# Never pass the Git write credential to the source/Discord HTTP process.
# A hard execution bound leaves time to save the SQLite snapshot after failures.
if [[ "$mode" == backfill ]]; then
  env -u GH_TOKEN timeout --kill-after=15s 20m node --env-file-if-exists=.env src/index.ts --backfill "$days" || poll_status=$?
else
  env -u GH_TOKEN timeout --kill-after=15s 20m node --env-file-if-exists=.env src/index.ts --once || poll_status=$?
fi

if ! state save; then
  echo "State save failed; shared lock retained to prevent duplicate delivery. Inspect logs before clearing the lock." >&2
  exit 1
fi
state unlock
exit "$poll_status"
