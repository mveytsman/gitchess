import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { Chess, type Color, type PieceSymbol } from "chess.js";

export const INITIAL_FEN = new Chess().fen();

const SIZE = 512;
const SQUARE_SIZE = SIZE / 8;
const PIECES = [
  "wP", "wN", "wB", "wR", "wQ", "wK",
  "bP", "bN", "bB", "bR", "bQ", "bK",
] as const;
type PieceName = typeof PIECES[number];

const pieceImages = Object.fromEntries(PIECES.map((piece) => {
  const svg = readFileSync(new URL(`../assets/chessnut/${piece}.svg`, import.meta.url));
  return [piece, `data:image/svg+xml;base64,${svg.toString("base64")}`];
})) as Record<PieceName, string>;

function pieceName(color: Color, type: PieceSymbol): PieceName {
  return `${color}${type.toUpperCase()}` as PieceName;
}

export function renderPositionSvg(fen: string): string {
  const board = new Chess(fen).board();
  const squares: string[] = [];
  const pieces: string[] = [];

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const x = file * SQUARE_SIZE;
      const y = rank * SQUARE_SIZE;
      const fill = (rank + file) % 2 === 0 ? "#eed8b4" : "#b58863";
      squares.push(
        `<rect x="${x}" y="${y}" width="${SQUARE_SIZE}" height="${SQUARE_SIZE}" fill="${fill}"/>`,
      );

      const piece = board[rank]![file];
      if (!piece) continue;
      const href = pieceImages[pieceName(piece.color, piece.type)];
      pieces.push(
        `<image x="${x}" y="${y}" width="${SQUARE_SIZE}" height="${SQUARE_SIZE}" href="${href}"/>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    "<title>gitchess position</title>",
    "<metadata>Chessnut pieces by Alexis Luengas, licensed under Apache-2.0.</metadata>",
    ...squares,
    ...pieces,
    "</svg>",
    "",
  ].join("\n");
}

export function renderPositionPng(svg: string): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: 2*SIZE },
    font: { loadSystemFonts: false },
  }).render().asPng();
}

export function renderPosition(fen: string): { svg: string; png: Buffer } {
  const svg = renderPositionSvg(fen);
  return { svg, png: renderPositionPng(svg) };
}
