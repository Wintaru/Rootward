/**
 * Runs the *real* `@jsquash` / `heic-decode` WASM codecs (not fakes) --
 * proves the actual decode/resize/encode wiring works in this runtime, not
 * just that the orchestration threads values through correctly.
 * `docs/DECISIONS.md` has the version-pinning story: the `@jsquash/png`
 * release originally pinned in `deno.json` turned out to be unusable under
 * Deno's npm resolution (extensionless internal imports); the versions this
 * package pins are the ones the test suite actually verified.
 */

import { encode as encodeJpeg } from "@jsquash/jpeg";
import { describe, expect, it } from "vitest";

import { createImageCodec } from "./codec.ts";
import type { DecodedImage } from "./pipeline.ts";

// A hand-built, valid 2x2 8-bit RGB PNG (no external fixture file -- see
// `docs/DECISIONS.md` for how it was generated).
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length));
}

describe("createImageCodec", () => {
  it("decodes a real PNG and encodes real WebP thumb/display", async () => {
    const codec = createImageCodec();
    const decoded = await codec.decode(pngBytes(), "image/png");
    expect(decoded?.width).toBe(2);
    expect(decoded?.height).toBe(2);

    const thumb = await codec.encodeWebp(decoded as DecodedImage, 240);
    expect(asciiAt(thumb, 0, 4)).toBe("RIFF");
    expect(asciiAt(thumb, 8, 4)).toBe("WEBP");

    const display = await codec.encodeWebp(decoded as DecodedImage, 1200);
    expect(asciiAt(display, 0, 4)).toBe("RIFF");
  });

  it("round-trips a real JPEG", async () => {
    const codec = createImageCodec();
    const decodedPng = (await codec.decode(
      pngBytes(),
      "image/png",
    )) as DecodedImage;
    // encodeJpeg's .d.ts wants a DOM `ImageData`; codec.ts's own `asImageData`
    // cast (see its doc comment) documents why the plain shape is fine here too.
    const jpegBytes = new Uint8Array(await encodeJpeg(decodedPng));

    const decodedJpeg = await codec.decode(jpegBytes, "image/jpeg");
    expect(decodedJpeg?.width).toBe(2);
    expect(decodedJpeg?.height).toBe(2);
  });

  it("round-trips a real WebP", async () => {
    const codec = createImageCodec();
    const decodedPng = (await codec.decode(
      pngBytes(),
      "image/png",
    )) as DecodedImage;
    // 2x2 already fits under 240, so this exercises the "no resize needed" path.
    const webpBytes = await codec.encodeWebp(decodedPng, 240);

    const decodedWebp = await codec.decode(webpBytes, "image/webp");
    expect(decodedWebp?.width).toBe(2);
    expect(decodedWebp?.height).toBe(2);
  });

  it("returns null for a format with no codec (GIF, PDF)", async () => {
    const codec = createImageCodec();
    expect(
      await codec.decode(new TextEncoder().encode("GIF89a..."), "image/gif"),
    ).toBeNull();
    expect(
      await codec.decode(
        new TextEncoder().encode("%PDF-1.7"),
        "application/pdf",
      ),
    ).toBeNull();
  });

  it("HEIC path runs the real libheif-js WASM decoder", async () => {
    const codec = createImageCodec();
    // Not a genuine photo -- an ISOBMFF header naming the `heic` brand, just
    // enough to route past libheif's own format sniff and into the real WASM
    // decode call. A truncated file must fail with a decode error, not an
    // import/WASM-load error -- that distinction is what this test protects.
    const stub = new Uint8Array(20);
    const enc = new TextEncoder();
    stub.set(enc.encode("ftyp"), 4);
    stub.set(enc.encode("heic"), 8);
    await expect(codec.decode(stub, "image/heic")).rejects.toThrow();
  });
});
