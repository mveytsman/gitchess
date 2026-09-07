#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$root/var/chess.git"

if [[ ! -d "$repo" ]]; then
  git init --bare "$repo"
fi

git --git-dir="$repo" config receive.denyDeletes true
git --git-dir="$repo" config --replace-all \
  receive.procReceiveRefs \
  'm:refs/heads/games/'

printf '#!/usr/bin/env bash\nexec node %q\n' \
  "$root/dist/hooks/proc-receive.js" \
  >"$repo/hooks/proc-receive"
chmod +x "$repo/hooks/proc-receive"

printf '#!/usr/bin/env bash\nexec node %q\n' \
  "$root/dist/hooks/pre-receive.js" \
  >"$repo/hooks/pre-receive"
chmod +x "$repo/hooks/pre-receive"

printf 'Bare repository ready at %s\n' "$repo"
