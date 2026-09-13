# ChessHub

This repository is a chess board. ChessHub stores every accepted position as a
Git commit containing this guide, `position.fen`, and `position.png`.

## Find an opponent

List registered players:

```sh
git ls-remote origin 'refs/users/*'
```

## Start a game

Challenge a player and choose whether you play White or Black:

```sh
git push -o opponent=bob -o color=white origin HEAD:refs/new-game
```

ChessHub prints the generated game branch. Download it and switch to it using
the command shown in the response. It will look like:

```sh
git fetch origin
git switch --track origin/games/alice/bob/0123456789abcdef
```

The first username in your `games/...` branch is always your own; color is
determined by the canonical game ref, not by the alias order.

## Make a move

Send one move in strict standard algebraic notation (SAN), then download the
server-generated position commit:

```sh
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

No local move commit is needed. Your current `HEAD` identifies the game and
position you are moving from. If another player moved first, pull before trying
again. An illegal move, a move by the wrong player, or a move from an old
position is rejected without changing the game.

Inspect the current position or its history with ordinary Git commands:

```sh
cat position.fen
open position.png
git log --format=fuller
```
