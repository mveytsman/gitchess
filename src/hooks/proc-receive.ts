#!/usr/bin/env node

import { GitRepository } from "../git.js";
import { procReceive } from "../git-protocol.js";
import { createGame, gameMove, MOVE_REF, NEW_GAME_REF } from "../games.js";

const git = new GitRepository(process.env.GIT_DIR ?? ".");

function optionsFor(pushOptions: string[], allowed: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const option of pushOptions) {
    const equals = option.indexOf("=");
    const name = equals < 0 ? option : option.slice(0, equals);
    const value = equals < 0 ? "" : option.slice(equals + 1);
    if (!allowed.includes(name)) throw new Error(`Unsupported push option: ${name}`);
    if (parsed.has(name)) throw new Error(`Push option supplied more than once: ${name}`);
    parsed.set(name, value);
  }
  for (const name of allowed) {
    if (!parsed.has(name)) throw new Error(`Missing push option: ${name}`);
  }
  return parsed;
}

procReceive((updates, pushOptions) => {
  if (updates.length !== 1) throw new Error("Push exactly one game action at a time");
  const update = updates[0]!;
  if (!/^0+$/.test(update.oldOid)) throw new Error("Game action refs must not be stored");

  if (update.ref === NEW_GAME_REF) {
    const options = optionsFor(pushOptions, ["opponent", "color"]);
    const created = createGame(
      git,
      options.get("opponent")!,
      options.get("color")!,
      process.env.GITCHESS_PLAYER,
    );
    git.transaction(created.operations);
    const branch = created.game.publicRef.slice("refs/heads/".length);
    console.error(`gitchess: created ${branch}`);
    if (created.botQueued) console.error(`gitchess: queued _chessbot at ${created.newOid}`);
    console.error(`gitchess: run git fetch origin, then git switch --track origin/${branch}`);
  } else if (update.ref === MOVE_REF) {
    const options = optionsFor(pushOptions, ["move"]);
    const moved = gameMove(git, update.oid, options.get("move")!, process.env.GITCHESS_PLAYER);
    git.transaction(moved.operations);
    console.error(`gitchess: played ${moved.move}`);
    if (moved.botQueued) console.error(`gitchess: queued _chessbot at ${moved.newOid}`);
    console.error("gitchess: run git pull --ff-only");
  } else {
    throw new Error(`Unknown game action: ${update.ref}`);
  }
  return [{ ref: update.ref }];
}).catch((error: unknown) => {
  console.error(`proc-receive: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
