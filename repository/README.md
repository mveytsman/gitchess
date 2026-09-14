# gitchess

Welcome to [gitchess](https://chess.max.computer/)! 

This repository let's you play chess with other humans or bots, implemented entirely via the git protocol. Each game is on its own [branch](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-branch), with [symbolic refs](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-symref) tracking a particular user's games. The head of each game's branch, is the current game state, with a [tree](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-treeobject) containing the position as [FEN](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation), along with an SVG and PNG. Moves are proposed via [push options](https://git-scm.com/docs/git-push#Documentation/git-push.txt---push-optionoption) to a special [ref](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-ref). Players are tracked with refs pointing to their public keys.

You can see the full implementation on [GitHub](https://github.com/mveytsman/gitchess)

# Quick(est) Start

You can build your own client by asking your agent to execute something like

```
Read the README in this directory, build me a UI for  playing gitchess. Taylor the implementation details and the user experience based on what you know about me.
```

If you want to understand how this actually works, read on.

# Quickstart

## Install the helper
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
git ls-remote origin 'refs/users/*'
```

## Start a game

Challenge a player as White by default, or request Black:

```sh
git chess challenge bob
git chess challenge bob --black
```

The command creates a server-assigned game ID, downloads the generated initial
position, and switches to its local tracking branch.

The underlying Git command is:

```sh
git push -o opponent=bob -o color=white origin HEAD:refs/new-game
```

The server generates a new branch and prints it, `git chess challenge` extracts its ID and performs the fetch and switch

```sh
git fetch origin \
  refs/heads/games/alice/bob/<generated-id>:refs/remotes/origin/games/alice/bob/<generated-id>
git switch --track -c games/alice/bob/<generated-id> \
  origin/games/alice/bob/<generated-id>
```

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

Choose one of the registered bot players:

```sh
git chess challenge _chessbot-easy  
git chess challenge _chessbot       
git chess challenge _chessbot-hard  
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
