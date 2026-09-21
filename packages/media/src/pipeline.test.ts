/**
 * `processMediaBytes` end to end on the *real* codecs and the real `exifr`
 * (issue #108): a landscape-stored JPEG tagged `Orientation` 6 -- what a
 * phone writes for a portrait shot -- must come out of the pipeline as
 * portrait derivatives. The fake-codec orchestration tests live with the
 * `media-process` function; this one proves the WASM decode → turn → WebP
 * encode chain in this runtime.
 */

import { encode as encodeJpeg } from "@jsquash/jpeg";
import piexifRaw from "piexifjs";
import { describe, expect, it } from "vitest";

import { createImageCodec } from "./codec.ts";
import { createExifTools } from "./exif.ts";
import { processMediaBytes, type TreeMediaSettings } from "./pipeline.ts";

const piexif = piexifRaw as {
  ImageIFD: { Orientation: number };
  dump(exifObj: unknown): string;
  insert(exifBytes: string, binaryJpeg: string): string;
};

const SETTINGS: TreeMediaSettings = {
  mediaMaxBytes: 10 * 1024 * 1024,
  mediaAllowedMime: ["image/jpeg", "image/webp"],
  stripExifGps: true,
};

const WIDTH = 40;
const HEIGHT = 20;

/** A real `WIDTH`×`HEIGHT` JPEG carrying `Orientation` `orientation`. */
async function landscapeJpeg(orientation: number): Promise<Uint8Array> {
  const raw = {
    width: WIDTH,
    height: HEIGHT,
    data: new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(128),
  };
  const plain = new Uint8Array(await encodeJpeg(raw));
  let binary = "";
  for (const byte of plain) binary += String.fromCharCode(byte);
  const exifBytes = piexif.dump({
    "0th": { [piexif.ImageIFD.Orientation]: orientation },
    Exif: {},
    GPS: {},
    "1st": {},
    thumbnail: null,
  });
  const inserted = piexif.insert(exifBytes, binary);
  return Uint8Array.from(inserted, (c) => c.charCodeAt(0) & 0xff);
}

describe("processMediaBytes with the real codecs", () => {
  it("turns an Orientation-6 JPEG upright before encoding the derivatives", async () => {
    const codec = createImageCodec();
    const outcome = await processMediaBytes(
      await landscapeJpeg(6),
      SETTINGS,
      codec,
      createExifTools(),
    );
    expect(outcome.status).toBe("processed");
    if (outcome.status !== "processed") return;

    expect(outcome.result.exif.orientationApplied).toBe(6);
    expect(outcome.result.warnings).toEqual([]);
    expect(outcome.result.derivatives).not.toBeNull();
    const thumb = await codec.decode(
      outcome.result.derivatives?.thumb ?? new Uint8Array(),
      "image/webp",
    );
    // Stored 40×20; a 90 CW turn makes the derivative 20×40.
    expect([thumb?.width, thumb?.height]).toEqual([HEIGHT, WIDTH]);
  });

  it("leaves an Orientation-1 JPEG alone and records nothing applied", async () => {
    const codec = createImageCodec();
    const outcome = await processMediaBytes(
      await landscapeJpeg(1),
      SETTINGS,
      codec,
      createExifTools(),
    );
    expect(outcome.status).toBe("processed");
    if (outcome.status !== "processed") return;

    expect(outcome.result.exif.orientationApplied).toBeNull();
    const thumb = await codec.decode(
      outcome.result.derivatives?.thumb ?? new Uint8Array(),
      "image/webp",
    );
    expect([thumb?.width, thumb?.height]).toEqual([WIDTH, HEIGHT]);
  });
});
