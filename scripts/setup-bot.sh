#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$root/var/chess.git"
bot_key="$root/var/chessbot_ed25519"

if [[ ! -e "$bot_key" && ! -L "$bot_key" ]]; then
  if [[ -e "$bot_key.pub" || -L "$bot_key.pub" ]]; then
    printf 'Refusing to overwrite existing public key at %s.pub\n' "$bot_key" >&2
    exit 1
  fi
  umask 077
  mkdir -p "$(dirname "$bot_key")"
  ssh-keygen -q -t ed25519 -N '' -C _chessbot -f "$bot_key" </dev/null
fi

# Derive the public key from the private key, rather than trusting a stale .pub.
public_key="$(ssh-keygen -y -f "$bot_key" </dev/null)"
read -r algorithm key_data _ <<<"$public_key"
# Match Users' SHA-256 fingerprint of the SSH wire bytes (not the Git blob).
fingerprint="$(printf '%s' "$key_data" | openssl base64 -d -A | openssl dgst -sha256 -r | awk '{print $1}')"
oid="$(printf '%s %s\n' "$algorithm" "$key_data" | git --git-dir="$repo" hash-object -w --stdin)"
user_ref='refs/users/_chessbot'
key_ref="refs/keys/$fingerprint"

registered() {
  [[ "$(git --git-dir="$repo" symbolic-ref --quiet --no-recurse "$key_ref")" == "$user_ref" ]] &&
    [[ "$(git --git-dir="$repo" show-ref --verify --hash "$user_ref")" == "$oid" ]]
}

if ! registered 2>/dev/null; then
  if ! git --git-dir="$repo" update-ref --no-deref --stdin >/dev/null <<EOF
start
create $user_ref $oid
symref-create $key_ref $user_ref
prepare
commit
EOF
  then
    # A concurrent setup may have installed the same mapping. Never replace one.
    if ! registered; then
      printf 'Cannot register _chessbot: conflicting identity or Git error\n' >&2
      exit 1
    fi
  fi
fi
printf 'Bot _chessbot ready\n'
