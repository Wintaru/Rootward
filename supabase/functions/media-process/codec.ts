/**
 * The real {@link ImageCodec} (issue #33): decode JPEG / PNG / WebP with
 * `@jsquash` (WASM, no native bindings -- Supabase Edge Functions only
 * support WASM image libraries) and HEIC with `heic-decode` (`libheif-js`
 * WASM). GIF and PDF have no codec here -- `processor.ts` stores the
 * original with no derivatives for those (see `docs/DECISIONS.md`; neither
 * is in the issue's "done when" list).
 */

import { decode as decodeJpeg } from "@jsquash/jpeg";
import { decode as decodePng } from "@jsquash/png";
import { decode as decodeWebp, encode as encodeWebpBytes } from "@jsquash/webp";
import resizePixels from "@jsquash/resize";
import decodeHeic from "heic-decode";

import type { DecodedImage, ImageCodec } from "./processor.ts";
import { computeTargetSize } from "./image-geometry.ts";

/**
 * `@jsquash/*`'s `.d.ts` types every function against the DOM `ImageData`
 * interface, which doesn't exist in Deno and (in this TS lib version) also
 * requires `colorSpace` / `pixelFormat` fields the library never actually
 * reads -- confirmed against the real WASM codecs in `codec.test.ts`, which
 * passes exactly the plain `{width, height, data}` shape these casts assert.
 * Isolating the cast here keeps the rest of the file honestly typed against
 * our own `DecodedImage`.
 */
// deno-lint-ignore no-explicit-any
function asImageData(image: unknown): any {
  return image;
}

export function createImageCodec(): ImageCodec {
  return {
    async decode(bytes, mimeType) {
      switch (mimeType) {
        case "image/jpeg":
          return toDecodedImage(await decodeJpeg(asImageData(bytes)));
        case "image/png":
          return toDecodedImage(await decodePng(asImageData(bytes)));
        case "image/webp":
          return toDecodedImage(await decodeWebp(asImageData(bytes)));
        case "image/heic": {
          const heic = await decodeHeic({ buffer: bytes, all: false });
          return {
            width: heic.width,
            height: heic.height,
            data: new Uint8ClampedArray(heic.data),
          };
        }
        default:
          return null;
      }
    },

    async encodeWebp(image, maxDimension) {
      const target = computeTargetSize(image, maxDimension);
      const raster: DecodedImage =
        target.width === image.width && target.height === image.height
          ? image
          : toDecodedImage(
            await resizePixels(asImageData(image), {
              width: target.width,
              height: target.height,
            }),
          );
      const encoded = await encodeWebpBytes(asImageData(raster));
      return new Uint8Array(encoded);
    },
  };
}

function toDecodedImage(raw: unknown): DecodedImage {
  const img = raw as {
    width: number;
    height: number;
    data: Uint8ClampedArray | ArrayBuffer;
  };
  const data = img.data instanceof Uint8ClampedArray
    ? img.data
    : new Uint8ClampedArray(img.data);
  return { width: img.width, height: img.height, data };
}
