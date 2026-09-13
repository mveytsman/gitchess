#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$root/var/chess.git"

if [[ ! -d "$repo" ]]; then
  git init --bare "$repo"
fi

git --git-dir="$repo" config receive.denyDeletes true
git --git-dir="$repo" config receive.advertisePushOptions true
git --git-dir="$repo" config --replace-all \
  receive.procReceiveRefs \
  'a:refs/new-game'
git --git-dir="$repo" config --add \
  receive.procReceiveRefs \
  'a:refs/moves'

if ! git --git-dir="$repo" show-ref --verify --quiet refs/heads/main; then
  readme_oid="$(git --git-dir="$repo" hash-object -w "$root/repository/README.md")"
  tree_oid="$(printf '100644 blob %s\tREADME.md\n' "$readme_oid" | git --git-dir="$repo" mktree)"
  commit_oid="$(printf 'Welcome to ChessHub\n' | \
    GIT_AUTHOR_NAME=ChessHub \
    GIT_AUTHOR_EMAIL=server@chesshub \
    GIT_COMMITTER_NAME=ChessHub \
    GIT_COMMITTER_EMAIL=server@chesshub \
    git --git-dir="$repo" commit-tree "$tree_oid")"
  git --git-dir="$repo" update-ref refs/heads/main "$commit_oid"
fi
git --git-dir="$repo" symbolic-ref HEAD refs/heads/main

printf '#!/usr/bin/env bash\nexec node %q\n' \
  "$root/dist/hooks/proc-receive.js" \
  >"$repo/hooks/proc-receive"
chmod +x "$repo/hooks/proc-receive"

printf '#!/usr/bin/env bash\nexec node %q\n' \
  "$root/dist/hooks/pre-receive.js" \
  >"$repo/hooks/pre-receive"
chmod +x "$repo/hooks/pre-receive"

printf 'Bare repository ready at %s\n' "$repo"
