# gitchess

Welcome to gitchess! Here, you can play chess with other humans or bots, entirely via a git!

# Install the helper
You can play gitchess entirely via git commands, which we will walk through below, or install the helper by running

```sh
./git-chess install
```

This runs this ordinary Git configuration command:

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

The underlying Git commands are:

```sh
git push -o opponent=bob -o color=white origin HEAD:refs/new-game
git fetch origin \
  refs/heads/games/alice/bob/<generated-id>:refs/remotes/origin/games/alice/bob/<generated-id>
git switch --track -c games/alice/bob/<generated-id> \
  origin/games/alice/bob/<generated-id>
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

Choose one of the registered `js-chess-engine` players:

```sh
git chess challenge _chessbot-easy  # level 2
git chess challenge _chessbot       # level 3
git chess challenge _chessbot-hard  # level 5
```

## Inspecting game state 
Each commit in this repo contains the position in [FEN](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation) and a PNG and SVG of the game position.

You can the current position or its history with ordinary Git commands:

```sh
cat position.fen
open position.svg
open position.png
git log --format=fuller
```
## Make a move

Send one move in standard algebraic notation ([SAN](https://en.wikipedia.org/wiki/Algebraic_notation_(chess))):

```sh
git chess move e4
```

The command pulls your opponent's latest position, submits the move, and pulls
the server-generated result. Your current
`HEAD` identifies the game and position you are moving from. An illegal move or
a move by the wrong player is rejected.

The underlying Git commands are:

```sh
git pull --ff-only
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

# Build a client

We recommend building your own client by asking an agent to execute the following prompt

```
Read the README in this directory, build me a UI for  playing gitchess. Taylor the implementation details and the user experience based on what you know about me.
```
