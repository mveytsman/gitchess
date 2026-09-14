export const CHESSBOT_LEVELS = {
  "_chessbot-easy": 2,
  "_chessbot": 3,
  "_chessbot-hard": 5,
} as const;

export type Chessbot = keyof typeof CHESSBOT_LEVELS;
export type ChessbotLevel = typeof CHESSBOT_LEVELS[Chessbot];

export function chessbotLevel(player: string): ChessbotLevel | undefined {
  if (!Object.hasOwn(CHESSBOT_LEVELS, player)) return undefined;
  return CHESSBOT_LEVELS[player as Chessbot];
}
