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
# In another terminal:
npm run bot
```

The server listens on `127.0.0.1:2222`. Connect as SSH user `git` with your own
SSH key. An unregistered key triggers username signup during authentication;
returning keys log in automatically. No account password is required.

`npm run setup` generates the server's persistent
host key at `var/ssh_host_ed25519`, which is gitignored. Running setup again
preserves the existing key. The Bash setup scripts live in `scripts/`;
`ssh-keygen` also creates the corresponding `.pub` file. This identifies the server and is separate from your
personal key used to log in.

Setup also generates separate keypairs for `_chessbot-easy`, `_chessbot`, and
`_chessbot-hard` under `var/`, then registers their public keys as user refs.
Reruns preserve the keys and registrations; a conflicting identity causes
setup to fail rather than overwrite it. Underscore-prefixed usernames are
reserved and cannot be chosen during interactive signup.

The bot worker operates directly on the Git repository, so it does not use the
bots' private SSH keys at runtime. The keypairs give them normal stored
identities alongside other players.

From another terminal, clone into a directory outside this project checkout
(a clone placed inside it would otherwise show up as an untracked embedded
repository):

```sh
git clone ssh://git@localhost:2222/chess.git ~/chess
cd ~/chess
```

To configure the repository-local `git chess` alias as part of cloning:

```sh
git clone -c alias.chess='!./git-chess' \
  ssh://git@localhost:2222/chess.git ~/chess
cd ~/chess
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
  git clone ssh://git@localhost:2222/chess.git ~/chess
```

Register a key interactively before using it in automated jobs. There is no
password fallback, username rename, key rotation or additional-key enrollment
yet; a different key is a new identity.

## Discover players

With the repository-local command installed, list registered players with:

```sh
git chess players
```

Its underlying Git command lists the same users without downloading their keys:

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

User refs are publicly readable for discovery; key-fingerprint refs are hidden.
The pre-receive hook rejects all client creation, modification and deletion of
identity refs; only server-side registration writes them. The SSH server passes
the authenticated name to Git and its hooks as `GITCHESS_PLAYER`; clients
cannot set it via SSH environment requests. Clients invoke the write-only
`refs/new-game` and `refs/moves` action refs. Direct writes to identity, game,
and normal branch refs are rejected.

Ref advertisements are filtered for each authenticated player. Fetches and
`git ls-remote` expose the user list, `main`, every public branch under
`refs/heads/games`, and the authenticated player's symbolic indexes under
`refs/my-games/<username>`. Key mappings and other players' `my-games` indexes
are hidden. Push advertisements hide all stored refs and permit only the
`refs/new-game` and `refs/moves` action paths. These rules are passed directly
to each Git transport subprocess, so they can vary by player.

Run `npm run setup` after updating the code to install both hooks. The setup
preserves existing users, games and the host key. Run the server yourself with
`npm start`.

The repository's `main` branch is initialized with a player-facing README and
Bash client from `repository/`. A fresh clone contains its own instructions and
can explicitly enable the repository-local command:

```sh
./git-chess install
```

This installs a local `git chess` alias for that clone; cloning a repository
never executes or installs its files automatically.

The underlying Git configuration command is:

```sh
git config --local alias.chess '!./git-chess'
```

### Game refs

Create a game by naming an opponent. You play White by default; pass `--black`
to play Black. The server assigns a random 16-character hexadecimal game ID,
and the command fetches and switches to the resulting branch:

```sh
git chess challenge bob
git chess challenge bob --black
```

The underlying commands for a White challenge are:

```sh
git push -o opponent=bob -o color=white origin HEAD:refs/new-game
git fetch origin \
  refs/heads/games/alice/bob/<generated-id>:refs/remotes/origin/games/alice/bob/<generated-id>
git switch --track -c games/alice/bob/<generated-id> \
  origin/games/alice/bob/<generated-id>
```

Choosing Black changes the push option to `color=black`. The wrapper extracts
the generated ID from the server response before running the fetch and switch.

`refs/new-game` is a pseudo-ref: proc-receive handles the action but never stores
that ref. The pushed `HEAD` merely gives Git an object to send; it does not become
part of the game. The server creates a unique root commit containing the initial
`.gitchess-version`, `position.fen`, `position.svg`, and `position.png`. The
version marker currently contains `0.1` and identifies the game-tree layout.
For Alice choosing Black, the refs look like:

```text
refs/heads/games/bob/alice/0123456789abcdef
refs/my-games/alice/bob/0123456789abcdef -> refs/heads/games/bob/alice/0123456789abcdef
refs/my-games/bob/alice/0123456789abcdef -> refs/heads/games/bob/alice/0123456789abcdef
```

The public branch is authoritative and ordered White then Black. Each player's
symbolic index is ordered self then opponent and follows that public branch.
Everyone can browse every game, while each player sees only their own
`refs/my-games` indexes:

```sh
git ls-remote origin 'refs/heads/games/*'
git ls-remote origin 'refs/my-games/*'
git fetch origin
git switch --track origin/games/bob/alice/0123456789abcdef
```

Make a move using SAN. The command fast-forward pulls before the action,
pushes the move, and pulls the server-generated result:

```sh
git chess move e4
```

The underlying Git commands are:

```sh
git pull --ff-only
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

`HEAD` identifies the exact game and position because the unique public game
ref points to that commit. The server rejects stale positions, wrong turns, and
illegal moves. For a legal move it creates a child position commit whose author
is the authenticated mover and whose committer is gitchess. The client then
downloads that server-created object with an ordinary fast-forward pull. No
client-side proposal commit is needed.

The Bash client is intentionally thin. Underneath, `challenge` pushes
`opponent` and `color` options to `refs/new-game`, while `move` pushes a `move`
option to `refs/moves`. `git chess players` lists the public user refs.

Three registered players are backed by `js-chess-engine`:

```text
_chessbot-easy  level 2
_chessbot       level 3
_chessbot-hard  level 5
```

The bot identity in the game ref selects the level, so no separate difficulty
setting is needed. `proc-receive` commits the human action and returns; the
separate `npm run bot` process discovers game tips where one of the bots is to
move and appends a normal commit authored by that bot. The game refs themselves
are the durable queue, so pending turns survive worker restarts.

The worker updates a game with a compare-and-swap against the tip it examined.
That prevents two workers from answering the same position. `git chess` waits
briefly for the bot ref to advance and fast-forwards when the response arrives;
if the worker is unavailable, it leaves the turn queued and tells the player to
pull later.

To inspect refs directly:

```sh
git for-each-ref      # all local refs
git ls-remote origin  # all refs the server exposes to you
```

Setup advertises push options and routes additions of `refs/new-game` and
`refs/moves` through
[proc-receive](https://git-scm.com/docs/githooks#_proc_receive). Both remain
absent, allowing every action to look like a new pseudo-ref creation. Exactly one
game action is accepted per push, and stored refs cannot be changed by clients.

Optional configuration:

| Environment variable | Default |
| --- | --- |
| `GITCHESS_HOST` | `127.0.0.1` |
| `GITCHESS_PORT` | `2222` |
| `GITCHESS_REPO` | Project's `var/chess.git` directory |
| `GITCHESS_HOST_KEY` | Project's `var/ssh_host_ed25519` |
| `GITCHESS_BOT_INTERVAL_MS` | `1000` |
| `GITCHESS_WEB_HOST` | `127.0.0.1` |
| `GITCHESS_WEB_PORT` | `8080` |

If overriding `GITCHESS_HOST_KEY`, use the same value for setup and start. Keep any
custom key path outside version control.

## Deploying to Fly.io

The Fly deployment runs the SSH server and bot worker as separate processes in
one container. They share `/data`, a persistent Fly Volume containing the bare
repository, SSH host key, and bot keys. Startup runs the idempotent setup scripts
before either process starts.

Install `flyctl`, sign in, and choose a globally unique app name:

```sh
fly auth login
fly launch --name <app-name> --copy-config --no-deploy --ha=false
fly deploy --ha=false
```

Pushes to `main` deploy automatically through GitHub Actions. Create an
app-scoped Fly deploy token and save it as the repository's
`FLY_API_TOKEN` secret:

```sh
fly tokens create deploy --app gitchess
gh secret set FLY_API_TOKEN --repo mveytsman/gitchess
```

The workflow can also be run manually from GitHub's Actions page. Deployments
are serialized and use Fly's remote builder, so the runner does not build the
container locally.

The checked-in configuration uses Toronto (`yyz`), creates a 1 GB volume, maps
public port 22 to the app's port 2222, and serves an HTTP redirect on ports 80
and 443. Every web request redirects to
`https://github.com/mveytsman/gitchess`. The Machine can stop while idle.
Keep this app at one Machine: Fly Volumes are local and gitchess does not yet
replicate Git state between Machines.

Fly's public IPv6 address supports this SSH service without another allocation.
For clients that require IPv4, allocate a dedicated IPv4 address before or after
deployment; raw SSH cannot use Fly's shared IPv4 routing:

```sh
fly ips allocate-v4
```

Clone using the selected Fly app name; port 22 is implicit:

```sh
git clone -c alias.chess='!./git-chess' \
  ssh://git@<app-name>.fly.dev/chess.git chess
cd chess
git chess install
```

The first connection records the persistent Fly host key in the client's
`known_hosts`, and gitchess then runs its normal public-key registration flow.
Later deployments reuse the repository and keys from the volume.

Useful deployment checks:

```sh
fly status
fly volumes list
fly logs
```

## Development

```sh
npm run typecheck
npm run build
npm test
```

TypeScript files in `src/` compile to `dist/`. `npm start` and `npm run bot`
build before starting their respective processes. `npm run setup` builds,
generates the local SSH host key if missing, and installs both hooks into the
local bare repository. Tests use temporary Git repositories and simulated
authentication events; they do not start an SSH server.
