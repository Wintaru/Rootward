import { describe, expect, it } from "vitest";

import { sniffMimeType } from "./mime.ts";

function bytesFrom(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function withAscii(
  prefixHex: string,
  offset: number,
  text: string,
): Uint8Array {
  const bytes = bytesFrom(prefixHex);
  const enc = new TextEncoder().encode(text);
  bytes.set(enc, offset);
  return bytes;
}

describe("sniffMimeType", () => {
  it("recognises JPEG magic bytes", () => {
    expect(sniffMimeType(bytesFrom("FFD8FF E0 0000"))).toBe("image/jpeg");
  });

  it("recognises PNG magic bytes", () => {
    expect(sniffMimeType(bytesFrom("89504E470D0A1A0A"))).toBe("image/png");
  });

  it("recognises GIF87a and GIF89a", () => {
    const gif87 = new TextEncoder().encode("GIF87a");
    const gif89 = new TextEncoder().encode("GIF89a");
    expect(sniffMimeType(gif87)).toBe("image/gif");
    expect(sniffMimeType(gif89)).toBe("image/gif");
  });

  it("recognises WebP (RIFF....WEBP)", () => {
    const bytes = new Uint8Array(12);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    expect(sniffMimeType(bytes)).toBe("image/webp");
  });

  it("recognises the PDF header", () => {
    expect(sniffMimeType(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(
      "application/pdf",
    );
  });

  it("recognises HEIC ftyp brands", () => {
    for (const brand of ["heic", "heix", "mif1", "msf1", "hevc", "hevx"]) {
      const bytes = withAscii("00000000000000000000000000", 4, "ftyp");
      bytes.set(new TextEncoder().encode(brand), 8);
      expect(sniffMimeType(bytes), brand).toBe("image/heic");
    }
  });

  it("does not treat ftyp with an unrecognized brand as HEIC", () => {
    const bytes = withAscii("00000000000000000000000000", 4, "ftyp");
    bytes.set(new TextEncoder().encode("mp41"), 8);
    expect(sniffMimeType(bytes)).toBeNull();
  });

  it("returns null for unrecognized or short input", () => {
    expect(sniffMimeType(new Uint8Array(0))).toBeNull();
    expect(sniffMimeType(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      sniffMimeType(new TextEncoder().encode("not an image, just text")),
    ).toBeNull();
  });
});
