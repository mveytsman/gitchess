# ChessHub

A learning project exploring “FUSE for Git” through a Git-backed chess game.

## Run locally

Use Node.js 24 or newer and Git 2.50 or newer (registration uses symbolic-ref
transactions), Bash, and OpenSSH's `ssh-keygen`. The optional Nix development
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
Welcome to ChessHub
Your username and public key will be publicly discoverable.
Choose a ChessHub username: alice
```

Choose 1–32 lowercase letters, digits, underscores or hyphens, starting with a
letter. Invalid or taken names are prompted again, up to five attempts. Signup
completes before Git's transfer starts, so the same clone continues afterward.
With no game branches yet, Git may warn that the repository appears empty or
has no usable default branch; user discovery still works.

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
git fetch origin '+refs/users/*:refs/chesshub/users/*'
git for-each-ref --format='%(refname:strip=3)' refs/chesshub/users/
git cat-file blob refs/chesshub/users/alice
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
name to Git and its hooks as `CHESSHUB_PLAYER`; clients cannot set it via SSH
environment requests. Pushes may only write game aliases whose first username
matches that authenticated name. Direct canonical writes and all other ref paths
are rejected. Chess rules and turn authorization are not implemented yet.

Run `npm run setup` after updating the code to install both hooks. The setup
preserves existing users, games and the host key. Run the server yourself with
`npm start`.

### Game refs

Create a local branch using your username, a registered opponent, and a game ID:

```sh
git switch -c games/alice/bob/demo
# Make a commit, then:
git push -u origin games/alice/bob/demo
```

IDs contain 1–64 letters, digits, underscores or hyphens. Each pair can have
multiple games with different IDs; playing yourself is not supported.
The server creates these refs together:

```text
refs/heads/games/alice/bob/demo -> refs/heads/canonical/alice/bob/demo
refs/heads/games/bob/alice/demo -> refs/heads/canonical/alice/bob/demo
```

The canonical ref stores the commit ID and uses sorted usernames. Both game
aliases are symbolic refs on the server. Bob can fetch and check out his alias:

```sh
git fetch origin
git switch --track origin/games/bob/alice/demo
```

Clients see ordinary branches; the symbolic relationship stays server-side.
Each player pushes their own branch, and the hook updates the shared canonical
ref, checking its previous commit ID to reject concurrent stale updates.
Fetch/pull before continuing after the other player pushes.

Setup uses `am:refs/heads/games/` to route both creation and modification through
[proc-receive](https://git-scm.com/docs/githooks#_proc_receive).
All game updates in a push share one ref transaction. Game deletion is rejected.
This is ref routing and ownership authorization only: either participant can
currently submit arbitrary commits, including forced history changes.

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
npm test
```

TypeScript files in `src/` compile to `dist/`. `npm start` builds before starting the
server, and `npm run setup` builds, generates the local SSH host key if missing,
and installs both hooks into the local bare repository. Tests use temporary Git
repositories and simulated authentication events; they do not start an SSH server.
