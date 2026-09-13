import { deflateSync } from "node:zlib";
import { Chess } from "chess.js";

export const INITIAL_FEN = new Chess().fen();

const glyphs: Record<string, string[]> = {
  p: ["01110", "10001", "10001", "01110", "00100", "01110", "11111"],
  n: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  b: ["00100", "01010", "00100", "01110", "10101", "01110", "11111"],
  r: ["10101", "11111", "01110", "01110", "01110", "01110", "11111"],
  q: ["10101", "10101", "10101", "01110", "00100", "01110", "11111"],
  k: ["00100", "01110", "00100", "01110", "10101", "01110", "11111"],
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  const header = Buffer.alloc(8), trailer = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  name.copy(header, 4);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, data, trailer]);
}

function paintPixel(image: Buffer, width: number, x: number, y: number, color: readonly number[]): void {
  const offset = (y * width + x) * 3;
  image[offset] = color[0]!;
  image[offset + 1] = color[1]!;
  image[offset + 2] = color[2]!;
}

export function renderPosition(fen: string): Buffer {
  const chess = new Chess(fen);
  const size = 512, square = size / 8;
  const pixels = Buffer.alloc(size * size * 3);
  const light = [238, 216, 180], dark = [181, 136, 99];
  const board = chess.board();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const background = (rank + file) % 2 ? dark : light;
      for (let y = rank * square; y < (rank + 1) * square; y++) {
        for (let x = file * square; x < (file + 1) * square; x++) paintPixel(pixels, size, x, y, background);
      }
      const piece = board[rank]![file];
      if (!piece) continue;
      const disc = piece.color === "w" ? [247, 247, 242] : [35, 38, 42];
      const ink = piece.color === "w" ? [35, 38, 42] : [247, 247, 242];
      const centerX = file * square + square / 2, centerY = rank * square + square / 2;
      for (let y = -24; y <= 24; y++) {
        for (let x = -24; x <= 24; x++) {
          if (x * x + y * y <= 24 * 24) paintPixel(pixels, size, centerX + x, centerY + y, disc);
        }
      }
      const glyph = glyphs[piece.type]!;
      for (let row = 0; row < glyph.length; row++) {
        for (let column = 0; column < glyph[row]!.length; column++) {
          if (glyph[row]![column] !== "1") continue;
          for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
            paintPixel(pixels, size, centerX - 12 + column * 5 + x, centerY - 17 + row * 5 + y, ink);
          }
        }
      }
    }
  }
  const scanlines = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const start = y * (size * 3 + 1);
    scanlines[start] = 0;
    pixels.copy(scanlines, start + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
