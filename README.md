# gitchess

A learning project exploring “FUSE for Git” through a Git-backed chess game.

## Run locally

Use Node.js 24 or newer and Git 2.50 or newer (registration uses symbolic-ref
transactions), Bash, OpenSSH's `ssh-keygen`, and `openssl` (for bot key fingerprinting). The optional Nix development
shell provides Node.js and Git.

```sh
npm ci
npm run setup
npm start
```

The server listens on `127.0.0.1:2222`. Connect as SSH user `git` with your own
SSH key. An unregistered key triggers username signup during authentication;
returning keys log in automatically. No account password is required.

`npm run setup` generates the server's persistent
host key at `var/ssh_host_ed25519`, which is gitignored. Running setup again
preserves the existing key. The Bash setup scripts live in `scripts/`;
`ssh-keygen` also creates the corresponding `.pub` file. This identifies the server and is separate from your
personal key used to log in.

Setup also generates a separate bot keypair at `var/chessbot_ed25519` (and
`.pub`) and registers the public key as `_chessbot`. Reruns preserve the key
and registration; a conflicting identity causes setup to fail rather than
overwrite it. Underscore-prefixed usernames are reserved and cannot be chosen
during interactive signup.

You can challenge `_chessbot`; gitchess generates the game ID. This provisions
the bot's identity only—it does not yet run a bot or generate chess moves. For
future bot Git commands, select its key with
`GIT_SSH_COMMAND='ssh -i /absolute/path/to/var/chessbot_ed25519 -o IdentitiesOnly=yes'`.

From another terminal:

```sh
git clone ssh://git@localhost:2222/chess.git chess
cd chess
```

SSH will ask you to trust the local server's host key on the first connection.
If your key isn't selected automatically, use
`GIT_SSH_COMMAND='ssh -i /path/to/private-key -o IdentitiesOnly=yes'` with the Git
command.

After verifying possession of an unregistered key, the server asks:

```text
Welcome to gitchess
Your username and public key will be publicly discoverable.
Choose a gitchess username: alice
```

Choose 1–32 lowercase letters, digits, underscores or hyphens, starting with a
letter. Invalid or taken names are prompted again, up to five attempts. Signup
completes before Git's transfer starts, so the same clone continues afterward
and checks out the repository's player guide.

This uses SSH keyboard-interactive authentication after public-key verification.
It needs an interactive terminal and a client supporting that method (such as
OpenSSH). For a client configuration that disables it, try:

```sh
GIT_SSH_COMMAND='ssh -o BatchMode=no -o KbdInteractiveAuthentication=yes -o PreferredAuthentications=publickey,keyboard-interactive' \
  git clone ssh://git@localhost:2222/chess.git chess
```

Register a key interactively before using it in automated jobs. There is no
password fallback, username rename, key rotation or additional-key enrollment
yet; a different key is a new identity.

## Discover players

From your clone, list registered players without downloading their keys:

```sh
git ls-remote origin 'refs/users/*'
```

Example output (the first column is a public-key blob's object ID):

```text
<object-id>    refs/users/alice
<object-id>    refs/users/bob
```

For usernames only:

```sh
git ls-remote origin 'refs/users/*' | sed 's|.*refs/users/||'
```

These are registered players, not online presence or an indication that they are
accepting challenges. Before cloning, you can replace `origin` with the SSH URL;
that also triggers signup for an unregistered key.

Normal clones do not create local copies of `refs/users/*`. To fetch the directory
explicitly and inspect Alice's public key:

```sh
git fetch origin '+refs/users/*:refs/gitchess/users/*'
git for-each-ref --format='%(refname:strip=3)' refs/gitchess/users/
git cat-file blob refs/gitchess/users/alice
```

## Identity storage

```text
refs/keys/<hex-sha256-fingerprint> -> refs/users/alice -> public-key blob
```

The fingerprint is SHA-256 of the SSH wire-format public-key bytes. The blob
contains the OpenSSH public key (`algorithm base64-key`), without a comment.
There are no JSON profiles or private keys in the Git object store.

Registration creates the user ref and symbolic key ref in one Git transaction,
requiring both names to be absent. This prevents concurrent requests from
claiming the same username or registering one key as multiple users. Returning
connections verify a fresh signature and resolve the fingerprint's symbolic ref.

Both ref prefixes are publicly readable for discovery. The pre-receive hook
rejects all client creation, modification and deletion of identity refs; only
server-side registration writes them. The SSH server passes the authenticated
name to Git and its hooks as `GITCHESS_PLAYER`; clients cannot set it via SSH
environment requests. Clients invoke the write-only `refs/new-game` and
`refs/moves` action refs. Direct writes to identity, game, canonical, and normal
branch refs are rejected.

Ref advertisements are filtered for each authenticated player. Fetches and
`git ls-remote` expose only the user list, `main`, and game aliases beginning
with `games/<authenticated-user>/`. Key mappings, canonical refs, and other
players' game aliases are hidden. Push advertisements hide all stored refs and
permit only the `refs/new-game` and `refs/moves` action paths. These rules are
passed directly to each Git transport subprocess, so they can vary by player.

Run `npm run setup` after updating the code to install both hooks. The setup
preserves existing users, games and the host key. Run the server yourself with
`npm start`.

The repository's `main` branch is initialized with a player-facing README from
`repository/README.md`. It explains how to discover players, create a game, and
make moves, so a fresh clone contains its own instructions.

### Game refs

Create a game by naming an opponent and choosing your color. The server assigns
a random 16-character hexadecimal game ID:

```sh
git push -o opponent=bob -o color=black origin HEAD:refs/new-game
```

`refs/new-game` is a pseudo-ref: proc-receive handles the action but never stores
that ref. The pushed `HEAD` merely gives Git an object to send; it does not become
part of the game. The server creates a unique root commit containing the initial
`position.fen` and `position.png`. It also reuses the exact `README.md` blob from
`main`, so the player guide is available on every game branch without a second
copy to maintain. The server then prints the generated branch and checkout
command. For Alice choosing Black, the refs look like:

```text
refs/heads/games/alice/bob/0123456789abcdef -> refs/heads/canonical/bob/alice/0123456789abcdef
refs/heads/games/bob/alice/0123456789abcdef -> refs/heads/canonical/bob/alice/0123456789abcdef
```

The canonical path is ordered White then Black. Each player's alias is ordered
self then opponent, and both symbolic aliases point to the same canonical ref.
Fetch the server-created commit and check out the alias printed by the push:

```sh
git fetch origin
git switch --track origin/games/alice/bob/0123456789abcdef
```

Make a move by sending strict SAN as a push option to the shared action ref:

```sh
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

`HEAD` identifies the exact game and position because the unique canonical game
ref points to that commit. The server rejects stale positions, wrong turns, and
illegal moves. For a legal move it creates a child position commit whose author
is the authenticated mover and whose committer is gitchess. The client then
downloads that server-created object with an ordinary fast-forward pull. No
client-side proposal commit is needed.

Setup advertises push options and routes additions of `refs/new-game` and
`refs/moves` through
[proc-receive](https://git-scm.com/docs/githooks#_proc_receive). Both remain
absent, allowing every action to look like a new pseudo-ref creation. Exactly one
game action is accepted per push, and stored refs cannot be changed by clients.

Optional configuration:

| Environment variable | Default |
| --- | --- |
| `GITCHESS_PORT` | `2222` |
| `GITCHESS_REPO` | Project's `var/chess.git` directory |
| `GITCHESS_HOST_KEY` | Project's `var/ssh_host_ed25519` |

If overriding `GITCHESS_HOST_KEY`, use the same value for setup and start. Keep any
custom key path outside version control.

## Development

```sh
npm run typecheck
npm run build
npm test
```

TypeScript files in `src/` compile to `dist/`. `npm start` builds before starting the
server, and `npm run setup` builds, generates the local SSH host key if missing,
and installs both hooks into the local bare repository. Tests use temporary Git
repositories and simulated authentication events; they do not start an SSH server.
