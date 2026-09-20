import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder, so tests that need a real image of a chosen size
 * carry no binary fixture file.
 *
 * The rotate/crop editor measures the rendered `<canvas>` to place a crop
 * box, so a 1×1 pixel — fine everywhere else in the suite — leaves nothing
 * to drag on. This writes a plain opaque RGBA image at whatever size the
 * test asks for.
 */
/**
 * A 1×1 transparent PNG — the smallest thing the `media` bucket will hold.
 * Nothing under test decodes it; a viewer only needs the object to exist so
 * a signed URL resolves.
 */
export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export function solidPng(
  width: number,
  height: number,
  colour: readonly [number, number, number] = [120, 90, 60],
): Buffer {
  const [red, green, blue] = colour;

  // One filter byte (0 = None) in front of each row of RGBA pixels: the
  // scanline layout PNG's IDAT stream expects before compression.
  const raw = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < width; x += 1) {
      raw[at] = red;
      raw[at + 1] = green;
      raw[at + 2] = blue;
      raw[at + 3] = 255;
      at += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** length + type + data + CRC32 of (type + data) — the PNG chunk frame. */
function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    // The index is masked to 0..255, so the table always has an entry; the
    // `?? 0` keeps `noUncheckedIndexedAccess` satisfied without an assertion.
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
