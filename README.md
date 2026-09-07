# Chesshub

A learning project exploring “FUSE for Git” through a Git-backed chess game.

## Run locally

Use Node.js 24 or newer and Git. The optional Nix development shell provides both.

```sh
npm ci
npm run setup
npm start
```

The server accepts any client public key for the `git` user, verifying that the
client holds its private key. Anyone with a key can fetch and push through the
local server, which listens on `127.0.0.1:2222`.

`npm run setup` generates the server's persistent
host key at `var/ssh_host_ed25519`, which is gitignored. Running setup again
preserves the existing key. This identifies the server and is separate from your
personal key used to log in.

From another terminal:

```sh
git ls-remote ssh://git@localhost:2222/chess.git
```

An empty repository returns no refs. SSH will ask you to trust the local server's
host key on the first connection. If your key isn't selected automatically, use
`GIT_SSH_COMMAND='ssh -i /path/to/private-key -o IdentitiesOnly=yes'` with the Git
command.

The server hands fetches and pushes to Git subprocesses. The existing
`proc-receive` hook still rejects modifications to `refs/heads/games/*`; game
logic is not implemented yet.

Optional configuration:

| Environment variable | Default |
| --- | --- |
| `CHESSHUB_PORT` | `2222` |
| `CHESSHUB_REPO` | Project's `var/chess.git` directory |
| `CHESSHUB_HOST_KEY` | Project's `var/ssh_host_ed25519` |

If overriding `CHESSHUB_HOST_KEY`, use the same value for setup and start. Keep any
custom key path outside version control.

## Development

```sh
npm run typecheck
npm run build
```

Root TypeScript files compile to `dist/`. `npm start` builds before starting the
server, and `npm run setup` builds, generates the local SSH host key if missing,
and installs the hook into the local bare repository.
