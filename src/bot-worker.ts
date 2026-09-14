#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { chessbotLevel } from "./bots.js";
import { chooseBotMove } from "./chessbot.js";
import { gameMove, queuedBotGame } from "./games.js";
import { GitRepository } from "./git.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const repoPath = resolve(process.env.GITCHESS_REPO ?? `${root}/var/chess.git`);
const interval = Number(process.env.GITCHESS_BOT_INTERVAL_MS ?? 1000);
if (!Number.isInteger(interval) || interval < 10) {
  throw new Error("GITCHESS_BOT_INTERVAL_MS must be an integer of at least 10");
}
if (!existsSync(`${repoPath}/HEAD`)) {
  throw new Error(`Repository missing at ${repoPath}; run npm run setup first`);
}

const git = new GitRepository(repoPath);

function runCycle(): boolean {
  let failed = false;
  for (const candidate of git.listDirectRefs("refs/heads/games")) {
    try {
      const queued = queuedBotGame(git, candidate.ref, candidate.oid);
      if (!queued) continue;
      const chess = new Chess(queued.fen);
      const level = chessbotLevel(queued.bot);
      if (level === undefined) throw new Error(`Unknown bot: ${queued.bot}`);
      const selected = chooseBotMove(queued.fen, level);
      const move = chess.move({ ...selected, promotion: "q" });
      if (!move) throw new Error("Chess engine returned an illegal move");
      const result = gameMove(git, queued.oid, move.san, queued.bot);
      git.transaction(result.operations);
      console.log(`gitchess bot: ${queued.ref} played ${result.move}`);
    } catch (error) {
      if (git.readDirectRef(candidate.ref) !== candidate.oid) continue;
      failed = true;
      console.error(
        `gitchess bot: ${candidate.ref}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failed;
}

if (process.argv.includes("--once")) {
  if (runCycle()) process.exitCode = 1;
} else {
  runCycle();
  const timer = setInterval(runCycle, interval);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      clearInterval(timer);
      process.exitCode = 0;
    });
  }
}
