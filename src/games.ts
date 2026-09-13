import { randomBytes } from "node:crypto";
import { Chess } from "chess.js";
import { GitRepository, type RefOperation } from "./git.js";
import { INITIAL_FEN, renderPosition } from "./position.js";
import { Users } from "./users.js";

const USERNAME = "[a-z_][a-z0-9_-]{0,31}";
const GAME_ID = "[a-f0-9]{16}";

export const NEW_GAME_REF = "refs/new-game";
export const MOVE_REF = "refs/moves";

type Game = {
  white: string;
  black: string;
  id: string;
  canonical: string;
  aliases: [string, string];
};

function gameRefs(white: string, black: string, id: string): Game {
  return {
    white,
    black,
    id,
    canonical: `refs/heads/canonical/${white}/${black}/${id}`,
    aliases: [
      `refs/heads/games/${white}/${black}/${id}`,
      `refs/heads/games/${black}/${white}/${id}`,
    ],
  };
}

function parseCanonicalRef(ref: string): Game {
  const match = new RegExp(`^refs/heads/canonical/(${USERNAME})/(${USERNAME})/(${GAME_ID})$`).exec(ref);
  if (!match) throw new Error(`Invalid canonical game ref: ${ref}`);
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

export function createGame(
  git: GitRepository,
  opponent: string,
  color: string,
  player: string | undefined,
): { game: Game; operations: RefOperation[]; newOid: string } {
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
  const newOid = git.createCommit(
    positionTree(git, INITIAL_FEN, repositoryFiles(git)),
    [],
    message,
    creator,
  );
  return {
    game,
    newOid,
    operations: [
      { kind: "create", ref: game.canonical, oid: newOid },
      ...game.aliases.map((alias): RefOperation => (
        { kind: "create-symbolic", ref: alias, target: game.canonical }
      )),
    ],
  };
}

export function gameMove(
  git: GitRepository,
  currentOid: string,
  requestedMove: string,
  player: string | undefined,
): { game: Game; operations: RefOperation[]; newOid: string; move: string } {
  const authenticatedPlayer = requirePlayer(player);
  const matches = git.refsPointingAt(currentOid, "refs/heads/canonical");
  if (matches.length === 0) throw new Error("No current game has that position; fetch it and retry");
  if (matches.length > 1) throw new Error("That position identifies more than one game");
  const game = parseCanonicalRef(matches[0]!);
  if (authenticatedPlayer !== game.white && authenticatedPlayer !== game.black) {
    throw new Error("You are not a player in that game");
  }

  const current = git.readCommit(currentOid);
  let expectedPlayer: string;
  if (current.parents.length === 0) expectedPlayer = game.white;
  else if (current.author === game.white) expectedPlayer = game.black;
  else if (current.author === game.black) expectedPlayer = game.white;
  else throw new Error("The current position was not authored by either player");
  if (authenticatedPlayer !== expectedPlayer) throw new Error(`It is ${expectedPlayer}'s turn`);

  const moveText = requestedMove.trim();
  if (!moveText || moveText.length > 32 || moveText.includes("\n")) {
    throw new Error("Provide exactly one SAN move");
  }
  const fen = git.readFile(currentOid, "position.fen").toString("utf8").trimEnd();
  const chess = new Chess(fen);
  let move;
  try {
    move = chess.move(moveText, { strict: true });
  } catch {
    throw new Error(`Illegal move: ${moveText}`);
  }

  const newOid = git.createCommit(
    positionTree(git, chess.fen(), repositoryFiles(git)),
    [currentOid],
    move.san,
    authenticatedPlayer,
  );
  return {
    game,
    newOid,
    move: move.san,
    operations: [
      ...game.aliases.map((alias): RefOperation => (
        { kind: "verify-symbolic", ref: alias, target: game.canonical }
      )),
      { kind: "update", ref: game.canonical, oid: newOid, oldOid: currentOid },
    ],
  };
}
