# gitchess

This repository is a chess board. gitchess stores every accepted position as a
Git commit containing this guide, the `git-chess` command, `position.fen`,
`position.svg`, and `position.png`. The SVG and PNG are two renderings of the
same FEN position; the SVG uses the
[Chessnut pieces](https://github.com/LexLuengas/chessnut-pieces) by Alexis
Luengas, licensed under Apache 2.0.

Clone and enable the repository-local command in one step:

```sh
git clone -c alias.chess='!./git-chess' \
  ssh://git@localhost:2222/chess.git chess
cd chess
```

The equivalent two-step setup is:

```sh
git clone ssh://git@localhost:2222/chess.git chess
cd chess
./git-chess install
```

`./git-chess install` runs this ordinary Git configuration command:

```sh
git config --local alias.chess '!./git-chess'
```

## Find an opponent

List registered players:

```sh
git chess players
```

The underlying Git command is:

```sh
git ls-remote origin 'refs/users/*' | sed 's|.*refs/users/||'
```

## Start a game

Challenge a player as White by default, or request Black:

```sh
git chess challenge bob
git chess challenge bob --black
```

The command creates a server-assigned game ID, downloads the generated initial
position, and switches to its local tracking branch.

The underlying Git commands for a White challenge are:

```sh
git push -o opponent=bob -o color=white origin HEAD:refs/new-game
git fetch origin \
  refs/heads/games/alice/bob/<generated-id>:refs/remotes/origin/games/alice/bob/<generated-id>
git switch --track -c games/alice/bob/<generated-id> \
  origin/games/alice/bob/<generated-id>
```

To request Black, the first command instead uses:

```sh
git push -o opponent=bob -o color=black origin HEAD:refs/new-game
```

The server prints the generated branch; `git chess challenge` extracts its ID
and performs the fetch and switch automatically.

Public game branches are ordered White then Black. For example:

```text
refs/heads/games/alice/bob/0123456789abcdef
```

Browse every public game, or just the personalized indexes visible to your
authenticated key:

```sh
git ls-remote origin 'refs/heads/games/*'
git ls-remote origin 'refs/my-games/*'
```

Your entries under `refs/my-games/<you>/...` are symbolic refs to the public
game branches. Other players' personalized indexes are hidden, but their public
games remain visible.

## Play the bot

`_chessbot` is a registered player backed by `js-chess-engine`:

```sh
git chess challenge _chessbot
git chess move e4
```

When the bot is next to move, the game ref becomes work for a separate bot
process. Its reply is a normal Git commit authored by `_chessbot`, so the
history shows the human move followed by the bot move. `git chess` waits briefly
for that commit. If the worker is unavailable, the move remains queued in Git
and the command tells you to pull again later.

## Make a move

Send one move in standard algebraic notation (SAN):

```sh
git chess move e4
```

The command pulls your opponent's latest position, submits the move, and pulls
the server-generated result. No local move commit is needed. Your current
`HEAD` identifies the game and position you are moving from. An illegal move or
a move by the wrong player is rejected without changing the game.

The underlying Git commands are:

```sh
git pull --ff-only
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

Inspect the current position or its history with ordinary Git commands:

```sh
cat position.fen
open position.svg
open position.png
git log --format=fuller
```
