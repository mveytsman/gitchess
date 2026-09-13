# gitchess

This repository is a chess board. gitchess stores every accepted position as a
Git commit containing this guide, the `git-chess` command, `position.fen`, and
`position.png`.

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

The first username in your `games/...` branch is always your own; color is
determined by the canonical game ref, not by the alias order.

## Make a move

Send one move in strict standard algebraic notation (SAN):

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
open position.png
git log --format=fuller
```
