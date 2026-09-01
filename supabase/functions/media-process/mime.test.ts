import { assertEquals } from "@std/assert";

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

Deno.test("sniffMimeType: JPEG magic bytes", () => {
  assertEquals(sniffMimeType(bytesFrom("FFD8FF E0 0000")), "image/jpeg");
});

Deno.test("sniffMimeType: PNG magic bytes", () => {
  assertEquals(sniffMimeType(bytesFrom("89504E470D0A1A0A")), "image/png");
});

Deno.test("sniffMimeType: GIF87a and GIF89a", () => {
  const gif87 = new TextEncoder().encode("GIF87a");
  const gif89 = new TextEncoder().encode("GIF89a");
  assertEquals(sniffMimeType(gif87), "image/gif");
  assertEquals(sniffMimeType(gif89), "image/gif");
});

Deno.test("sniffMimeType: WebP (RIFF....WEBP)", () => {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  assertEquals(sniffMimeType(bytes), "image/webp");
});

Deno.test("sniffMimeType: PDF header", () => {
  assertEquals(
    sniffMimeType(new TextEncoder().encode("%PDF-1.7\n...")),
    "application/pdf",
  );
});

Deno.test("sniffMimeType: HEIC ftyp brands", () => {
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc", "hevx"]) {
    const bytes = withAscii("00000000000000000000000000", 4, "ftyp");
    bytes.set(new TextEncoder().encode(brand), 8);
    assertEquals(sniffMimeType(bytes), "image/heic", brand);
  }
});

Deno.test("sniffMimeType: ftyp with an unrecognized brand is not HEIC", () => {
  const bytes = withAscii("00000000000000000000000000", 4, "ftyp");
  bytes.set(new TextEncoder().encode("mp41"), 8);
  assertEquals(sniffMimeType(bytes), null);
});

Deno.test("sniffMimeType: unrecognized/short input", () => {
  assertEquals(sniffMimeType(new Uint8Array(0)), null);
  assertEquals(sniffMimeType(new Uint8Array([1, 2, 3])), null);
  assertEquals(
    sniffMimeType(new TextEncoder().encode("not an image, just text")),
    null,
  );
});
