import { ai } from "js-chess-engine";

const LEVEL = 2;

export type BotMove = { from: string; to: string };

export function chooseBotMove(fen: string): BotMove {
  const entries = Object.entries(ai(fen, {
    level: LEVEL,
    play: false,
  }).move);
  if (entries.length !== 1) throw new Error("Chess engine did not return exactly one move");
  const [from, to] = entries[0]!;
  return { from: from.toLowerCase(), to: to.toLowerCase() };
}
