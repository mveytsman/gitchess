#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

bash scripts/setup-host-key.sh
bash scripts/setup-repo.sh
bash scripts/setup-bot.sh

bot_pid=''
server_pid=''

shutdown() {
  trap - TERM INT
  [[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true
  [[ -z "$bot_pid" ]] || kill "$bot_pid" 2>/dev/null || true
  [[ -z "$server_pid" ]] || wait "$server_pid" 2>/dev/null || true
  [[ -z "$bot_pid" ]] || wait "$bot_pid" 2>/dev/null || true
}

trap 'shutdown; exit 0' TERM INT

node dist/bot-worker.js &
bot_pid=$!
node dist/server.js &
server_pid=$!

set +e
wait -n "$bot_pid" "$server_pid"
status=$?
set -e
shutdown
exit "$status"
