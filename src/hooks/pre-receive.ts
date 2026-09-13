import { createInterface } from "node:readline";
import { authorizeGameAction } from "../games.js";

// Clients may invoke game actions, but may never write stored refs directly.
for await (const line of createInterface({ input: process.stdin })) {
  const [, oid, ref] = line.split(" ");
  try {
    authorizeGameAction(ref ?? "", oid ?? "", process.env.CHESSHUB_PLAYER);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
