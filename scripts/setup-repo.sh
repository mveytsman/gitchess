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

readme_oid="$(git --git-dir="$repo" hash-object -w "$root/repository/README.md")"
command_oid="$(git --git-dir="$repo" hash-object -w "$root/repository/git-chess")"
current_main="$(git --git-dir="$repo" rev-parse --verify refs/heads/main 2>/dev/null || true)"
current_readme="$(git --git-dir="$repo" rev-parse --verify refs/heads/main:README.md 2>/dev/null || true)"
current_command="$(git --git-dir="$repo" rev-parse --verify refs/heads/main:git-chess 2>/dev/null || true)"
if [[ "$current_readme" != "$readme_oid" || "$current_command" != "$command_oid" ]]; then
  tree_oid="$(printf '100644 blob %s\tREADME.md\n100755 blob %s\tgit-chess\n' \
    "$readme_oid" "$command_oid" | git --git-dir="$repo" mktree)"
  message='Welcome to gitchess'
  if [[ -n "$current_main" ]]; then
    message='Update the gitchess player guide'
  fi
  if [[ -n "$current_main" ]]; then
    commit_oid="$(printf '%s\n' "$message" | \
      GIT_AUTHOR_NAME=gitchess GIT_AUTHOR_EMAIL=server@gitchess \
      GIT_COMMITTER_NAME=gitchess GIT_COMMITTER_EMAIL=server@gitchess \
      git --git-dir="$repo" commit-tree "$tree_oid" -p "$current_main")"
    git --git-dir="$repo" update-ref refs/heads/main "$commit_oid" "$current_main"
  else
    commit_oid="$(printf '%s\n' "$message" | \
      GIT_AUTHOR_NAME=gitchess GIT_AUTHOR_EMAIL=server@gitchess \
      GIT_COMMITTER_NAME=gitchess GIT_COMMITTER_EMAIL=server@gitchess \
      git --git-dir="$repo" commit-tree "$tree_oid")"
    git --git-dir="$repo" update-ref refs/heads/main "$commit_oid"
  fi
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
