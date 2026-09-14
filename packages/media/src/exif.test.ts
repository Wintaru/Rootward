/**
 * Runs the real `exifr` / `piexifjs` wiring (not fakes). Builds its own tiny
 * JPEG-with-GPS fixture at test time (via the real `@jsquash/jpeg` encoder +
 * `piexifjs` itself, both already dependencies of this package) rather than
 * committing a binary fixture, so the "GPS tag actually removed" branch is
 * exercised by CI, not deferred.
 */

import { encode as encodeJpeg } from "@jsquash/jpeg";
import piexifRaw from "piexifjs";
import { describe, expect, it } from "vitest";

import { createExifTools } from "./exif.ts";

const piexif = piexifRaw as {
  GPSIFD: {
    GPSLatitudeRef: number;
    GPSLatitude: number;
    GPSLongitudeRef: number;
    GPSLongitude: number;
  };
  dump(exifObj: unknown): string;
  insert(exifBytes: string, binaryJpeg: string): string;
  load(binaryJpeg: string): { GPS: Record<string, unknown> };
};

const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

/** A real, valid JPEG with a real GPS IFD embedded via `piexifjs` itself. */
async function jpegWithGps(): Promise<Uint8Array> {
  const raw = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(2 * 2 * 4).fill(180),
  };
  const plainJpeg = new Uint8Array(await encodeJpeg(raw));
  const exifObj = {
    "0th": {},
    Exif: {},
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N",
      [piexif.GPSIFD.GPSLatitude]: [
        [40, 1],
        [0, 1],
        [0, 1],
      ],
      [piexif.GPSIFD.GPSLongitudeRef]: "W",
      [piexif.GPSIFD.GPSLongitude]: [
        [74, 1],
        [0, 1],
        [0, 1],
      ],
    },
    "1st": {},
    thumbnail: null,
  };
  const binary = bytesToBinaryString(plainJpeg);
  const exifBytes = piexif.dump(exifObj);
  return binaryStringToBytes(piexif.insert(exifBytes, binary));
}

describe("createExifTools", () => {
  it("read: a PNG with no EXIF segment reports nothing found", async () => {
    const exif = createExifTools();
    const result = await exif.read(PNG_BYTES, "image/png");
    expect(result).toEqual({ dateTaken: null, hasGps: false });
  });

  it("read: a JPEG with an embedded GPS IFD reports hasGps", async () => {
    const exif = createExifTools();
    const result = await exif.read(await jpegWithGps(), "image/jpeg");
    expect(result.hasGps).toBe(true);
  });

  it("stripGps: actually removes GPS from a JPEG that has it", async () => {
    const exif = createExifTools();
    const withGps = await jpegWithGps();
    expect(
      piexif.load(bytesToBinaryString(withGps)).GPS[
        piexif.GPSIFD.GPSLatitude
      ] !== undefined,
    ).toBe(true);

    const result = await exif.stripGps(withGps, "image/jpeg");
    expect(result.stripped).toBe(true);
    expect(
      Object.keys(piexif.load(bytesToBinaryString(result.bytes)).GPS).length,
    ).toBe(0);

    // The strip is a metadata edit only -- the pixels must still decode.
    const reread = await exif.read(result.bytes, "image/jpeg");
    expect(reread.hasGps).toBe(false);
  });

  it("stripGps: non-JPEG mime types are an untouched passthrough that reports stripped=false", async () => {
    const exif = createExifTools();
    const result = await exif.stripGps(PNG_BYTES, "image/png");
    expect(result).toEqual({ bytes: PNG_BYTES, stripped: false });
  });

  it("stripGps: a JPEG with no EXIF segment is returned untouched and reports stripped=false", async () => {
    const exif = createExifTools();
    const jpegLike = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI + EOI, no APP1
    const result = await exif.stripGps(jpegLike, "image/jpeg");
    expect(result).toEqual({ bytes: jpegLike, stripped: false });
  });
});
