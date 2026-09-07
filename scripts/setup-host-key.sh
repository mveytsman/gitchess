#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host_key="${CHESSHUB_HOST_KEY:-$root/var/ssh_host_ed25519}"

if [[ -e "$host_key" || -L "$host_key" ]]; then
  printf 'Keeping existing SSH host key at %s\n' "$host_key"
  exit 0
fi

if [[ -e "$host_key.pub" || -L "$host_key.pub" ]]; then
  printf 'Refusing to overwrite existing public key at %s.pub\n' "$host_key" >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname "$host_key")"
ssh-keygen -q -t ed25519 -N '' -C chesshub-host -f "$host_key" </dev/null
printf 'Generated SSH host key at %s\n' "$host_key"
