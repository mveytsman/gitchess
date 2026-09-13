import { randomBytes } from "node:crypto";
import { Chess } from "chess.js";
import { GitRepository, type RefOperation } from "./git.js";
import { INITIAL_FEN, renderPosition } from "./position.js";
import { Users } from "./users.js";

const USERNAME = "[a-z_][a-z0-9_-]{0,31}";
const GAME_ID = "[a-f0-9]{16}";

export const NEW_GAME_REF = "refs/new-game";
export const MOVE_REF = "refs/moves";
export const CHESSBOT = "_chessbot";

type Game = {
  white: string;
  black: string;
  id: string;
  publicRef: string;
  indexes: [string, string];
};

function gameRefs(white: string, black: string, id: string): Game {
  return {
    white,
    black,
    id,
    publicRef: `refs/heads/games/${white}/${black}/${id}`,
    indexes: [
      `refs/my-games/${white}/${black}/${id}`,
      `refs/my-games/${black}/${white}/${id}`,
    ],
  };
}

function parseGameRef(ref: string): Game {
  const match = new RegExp(`^refs/heads/games/(${USERNAME})/(${USERNAME})/(${GAME_ID})$`).exec(ref);
  if (!match) throw new Error(`Invalid game ref: ${ref}`);
  return gameRefs(match[1]!, match[2]!, match[3]!);
}

function requirePlayer(player: string | undefined): string {
  if (!player || !new RegExp(`^${USERNAME}$`).test(player)) {
    throw new Error("Authentication is required");
  }
  return player;
}

export function authorizeGameAction(ref: string, oid: string, player: string | undefined): void {
  requirePlayer(player);
  if (ref !== NEW_GAME_REF && ref !== MOVE_REF) {
    throw new Error(`Push game actions to ${NEW_GAME_REF} or ${MOVE_REF}`);
  }
  if (/^0+$/.test(oid)) throw new Error("Game deletion is not supported");
}

type RepositoryFiles = { readme: string; command: string };
export type QueuedBotGame = { ref: string; oid: string; fen: string };

function positionTree(git: GitRepository, fen: string, files: RepositoryFiles): string {
  const position = renderPosition(fen);
  return git.writeTree([
    { name: "README.md", oid: files.readme },
    { name: "git-chess", oid: files.command, mode: "100755" },
    { name: "position.fen", oid: git.writeBlob(`${fen}\n`) },
    { name: "position.svg", oid: git.writeBlob(position.svg) },
    { name: "position.png", oid: git.writeBlob(position.png) },
  ]);
}

function repositoryFiles(git: GitRepository): RepositoryFiles {
  const mainOid = git.readDirectRef("refs/heads/main");
  if (!mainOid) throw new Error("gitchess's main branch has not been initialized");
  return {
    readme: git.writeBlob(git.readFile(mainOid, "README.md")),
    command: git.writeBlob(git.readFile(mainOid, "git-chess")),
  };
}

function position(git: GitRepository, oid: string): Chess {
  return new Chess(git.readFile(oid, "position.fen").toString("utf8").trimEnd());
}

function playerToMove(game: Game, chess: Chess): string {
  return chess.turn() === "w" ? game.white : game.black;
}

export function queuedBotGame(
  git: GitRepository,
  ref: string,
  oid: string,
): QueuedBotGame | undefined {
  let game: Game;
  try {
    game = parseGameRef(ref);
  } catch {
    return undefined;
  }
  if (game.white !== CHESSBOT && game.black !== CHESSBOT) return undefined;
  const chess = position(git, oid);
  if (chess.isGameOver() || playerToMove(game, chess) !== CHESSBOT) return undefined;
  return { ref, oid, fen: chess.fen() };
}

export function createGame(
  git: GitRepository,
  opponent: string,
  color: string,
  player: string | undefined,
): { game: Game; operations: RefOperation[]; newOid: string; botQueued: boolean } {
  const creator = requirePlayer(player);
  if (!new RegExp(`^${USERNAME}$`).test(opponent)) throw new Error(`Invalid opponent: ${opponent}`);
  if (creator === opponent) throw new Error("Choose another player as your opponent");
  const users = new Users(git);
  for (const username of [creator, opponent]) {
    if (!users.exists(username)) throw new Error(`Unknown player: ${username}`);
  }
  if (color !== "white" && color !== "black") {
    throw new Error("Color must be white or black");
  }

  const [white, black] = color === "white" ? [creator, opponent] : [opponent, creator];
  const id = randomBytes(8).toString("hex");
  const game = gameRefs(white, black, id);
  const chosenColor = color === "white" ? "White" : "Black";
  const message = `Start game ${id}\n\n${creator} challenged ${opponent} and chose ${chosenColor}.`;
  const files = repositoryFiles(git);
  const newOid = git.createCommit(
    positionTree(git, INITIAL_FEN, files),
    [],
    message,
    creator,
  );
  return {
    game,
    newOid,
    botQueued: white === CHESSBOT,
    operations: [
      { kind: "create", ref: game.publicRef, oid: newOid },
      ...game.indexes.map((index): RefOperation => (
        { kind: "create-symbolic", ref: index, target: game.publicRef }
      )),
    ],
  };
}

export function gameMove(
  git: GitRepository,
  currentOid: string,
  requestedMove: string,
  player: string | undefined,
): { game: Game; operations: RefOperation[]; newOid: string; move: string; botQueued: boolean } {
  const authenticatedPlayer = requirePlayer(player);
  const matches = git.refsPointingAt(currentOid, "refs/heads/games");
  if (matches.length === 0) throw new Error("No current game has that position; fetch it and retry");
  if (matches.length > 1) throw new Error("That position identifies more than one game");
  const game = parseGameRef(matches[0]!);
  if (authenticatedPlayer !== game.white && authenticatedPlayer !== game.black) {
    throw new Error("You are not a player in that game");
  }

  const chess = position(git, currentOid);
  const expectedPlayer = playerToMove(game, chess);
  if (authenticatedPlayer !== expectedPlayer) throw new Error(`It is ${expectedPlayer}'s turn`);

  const moveText = requestedMove.trim();
  if (!moveText || moveText.length > 32 || moveText.includes("\n")) {
    throw new Error("Provide exactly one SAN move");
  }
  let move;
  try {
    move = chess.move(moveText, { strict: false });
  } catch {
    throw new Error(`Illegal move: ${moveText}`);
  }

  const files = repositoryFiles(git);
  const newOid = git.createCommit(
    positionTree(git, chess.fen(), files),
    [currentOid],
    move.san,
    authenticatedPlayer,
  );
  const nextPlayer = authenticatedPlayer === game.white ? game.black : game.white;
  const botQueued = nextPlayer === CHESSBOT && !chess.isGameOver();
  return {
    game,
    newOid,
    move: move.san,
    botQueued,
    operations: [
      ...game.indexes.map((index): RefOperation => (
        { kind: "verify-symbolic", ref: index, target: game.publicRef }
      )),
      { kind: "update", ref: game.publicRef, oid: newOid, oldOid: currentOid },
    ],
  };
}
