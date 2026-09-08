import { createInterface } from "node:readline";
import { gameRefs } from "../games.js";

// Only non-deleting writes to the authenticated player's game aliases are allowed.
for await (const line of createInterface({ input: process.stdin })) {
  const [, oid, ref] = line.split(" ");
  try {
    gameRefs(ref ?? "", process.env.CHESSHUB_PLAYER);
    if (/^0+$/.test(oid ?? "")) throw new Error("Game deletion is not supported");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
