# gitchess

Play chess entirely through the Git protocol.

Each game lives on its own branch. The tip of that branch is the current
position, stored as [FEN](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation)
SVG, and PNG. Every legal move adds a new commit, so ordinary Git history is also the history of the game.

Players are identified by their SSH public keys. Moves are submitted through
push options. You can use the included helper, work directly with Git, or
build a client of your own.

## Get the repository

```sh
git clone ssh://git.max.computer/chess.git chess
cd chess
```

You’ll need Git and an SSH key. Your first connection asks you to choose a
username.

## Use the helper

Install the repository-local `git chess` alias, find an opponent, and start a game:

```sh
./git-chess install
git chess players
git chess challenge bob
```

You play White by default; add `--black` to play Black. You can also challenge
`_chessbot-easy`, `_chessbot`, or `_chessbot-hard`.

Submit a move in standard algebraic notation:

```sh
git chess move e4
```

The helper pulls the latest position, submits your move, and pulls the result.
The server checks whose turn it is and whether the move is legal.

## Underneath, it’s Git

Here’s what submitting a move looks like without the helper:

```sh
git pull --ff-only
git push -o move=e4 origin HEAD:refs/moves
git pull --ff-only
```

Your current `HEAD` identifies the game and position you’re moving from.
If the move is accepted, the server creates the next position commit.

Look at the board or explore its history:

```sh
cat position.fen
open position.svg
git log --format=fuller
```

Every game branch is public. Each player also has a personalized index of
symbolic refs pointing to their games:

```sh
git ls-remote origin 'refs/heads/games/*'
git ls-remote origin 'refs/my-games/*'
```

For the full protocol walkthrough, read the
[player README](https://github.com/mveytsman/gitchess/blob/main/repository/README.md).
The [implementation is on GitHub](https://github.com/mveytsman/gitchess).

## Or build your own client

The repository includes a README explaining the protocol. Once you’ve cloned
it, try giving your coding agent this prompt:

> Read the README in this directory and build me a UI for playing gitchess.
> Tailor the implementation and experience to what you know about me.
