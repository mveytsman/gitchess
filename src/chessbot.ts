import { ai } from "js-chess-engine";
import type { ChessbotLevel } from "./bots.js";

export type BotMove = { from: string; to: string };

export function chooseBotMove(fen: string, level: ChessbotLevel): BotMove {
  const entries = Object.entries(ai(fen, {
    level,
    play: false,
  }).move);
  if (entries.length !== 1) throw new Error("Chess engine did not return exactly one move");
  const [from, to] = entries[0]!;
  return { from: from.toLowerCase(), to: to.toLowerCase() };
}
