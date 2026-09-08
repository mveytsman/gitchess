#!/usr/bin/env node

import { GitRepository } from "../git.js";
import { procReceive } from "../git-protocol.js";
import { gameUpdate } from "../games.js";

const git = new GitRepository(process.env.GIT_DIR ?? ".");

procReceive((updates) => {
  git.transaction(updates.flatMap(({ oldOid, oid, ref }) =>
    gameUpdate(git, ref, oldOid, oid, process.env.CHESSHUB_PLAYER)));
}).catch((error: unknown) => {
  console.error(`proc-receive: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
