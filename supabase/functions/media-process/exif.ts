/**
 * The real {@link ExifTools} (issue #33, decision 25). `exifr` reads tags for
 * every format it recognizes; GPS stripping edits the JPEG EXIF segment in
 * place with `piexifjs` -- the only format/tool pairing this v1 supports (see
 * `docs/DECISIONS.md`). Any other format's `stripGps` is a passthrough: the
 * original bytes are returned unchanged, `hasGps` still reports what was
 * found so the caller can decide whether to warn.
 */

import exifr from "exifr";
import piexifRaw from "piexifjs";

import type { ExifTools } from "./processor.ts";

// piexifjs ships as a CommonJS default export with no types.
const piexif = piexifRaw as {
  load(binaryJpeg: string): {
    GPS: Record<string, unknown>;
    [key: string]: unknown;
  };
  dump(exifObj: unknown): string;
  insert(exifBytes: string, binaryJpeg: string): string;
};

const GPS_STRIPPABLE_MIME = "image/jpeg";

export function createExifTools(): ExifTools {
  return {
    async read(bytes, _mimeType) {
      try {
        const tags = (await exifr.parse(bytes, {
          pick: [
            "DateTimeOriginal",
            "CreateDate",
            "GPSLatitude",
            "GPSLongitude",
          ],
        })) as
          | {
            DateTimeOriginal?: Date;
            CreateDate?: Date;
            GPSLatitude?: number;
            GPSLongitude?: number;
          }
          | undefined;
        if (tags === undefined) {
          return { dateTaken: null, hasGps: false };
        }
        return {
          dateTaken: formatLocalDate(tags.DateTimeOriginal ?? tags.CreateDate),
          hasGps: tags.GPSLatitude !== undefined &&
            tags.GPSLongitude !== undefined,
        };
      } catch {
        // No EXIF segment, or one exifr can't parse -- not fatal to the upload.
        return { dateTaken: null, hasGps: false };
      }
    },

    stripGps(bytes, mimeType) {
      if (mimeType !== GPS_STRIPPABLE_MIME) {
        return Promise.resolve({ bytes, stripped: false });
      }
      try {
        const binary = bytesToBinaryString(bytes);
        const exifObj = piexif.load(binary);
        exifObj.GPS = {};
        const exifBytes = piexif.dump(exifObj);
        const inserted = piexif.insert(exifBytes, binary);
        return Promise.resolve({
          bytes: binaryStringToBytes(inserted),
          stripped: true,
        });
      } catch {
        // Malformed or absent EXIF segment -- leave the bytes untouched
        // rather than fail the whole upload over a metadata edit. `stripped:
        // false` is honest here: nothing was actually removed.
        return Promise.resolve({ bytes, stripped: false });
      }
    },
  } satisfies ExifTools;
}

/** Local-time components -- EXIF's naive datetime carries no timezone, and
 * `exifr` builds its `Date` from those same local-looking components, so
 * `toISOString()` (UTC) would risk rolling the day. */
function formatLocalDate(date: Date | undefined): string | null {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return null;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const CHUNK = 0x8000;

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return result;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}
