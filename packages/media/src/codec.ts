/**
 * The real {@link ImageCodec} (issue #33): decode JPEG / PNG / WebP with
 * `@jsquash` (WASM, no native bindings) and HEIC with `heic-decode`
 * (`libheif-js` WASM). GIF and PDF have no codec here -- callers store the
 * original with no derivatives for those (see `docs/DECISIONS.md`; neither
 * is in the issue's "done when" list). Runs identically in a Deno edge
 * function or a browser tab (issue #104) -- `@jsquash/*` targets both.
 */

import { decode as decodeJpeg } from "@jsquash/jpeg";
import { decode as decodePng } from "@jsquash/png";
import { decode as decodeWebp, encode as encodeWebpBytes } from "@jsquash/webp";
import resizePixels from "@jsquash/resize";
import decodeHeic from "heic-decode";

import type { DecodedImage, ImageCodec } from "./pipeline.ts";
import { computeTargetSize } from "./image-geometry.ts";

/**
 * `@jsquash/*`'s `.d.ts` types every function against the DOM `ImageData`
 * interface, which (in this TS lib version) requires `colorSpace` /
 * `pixelFormat` fields the library never actually reads -- confirmed against
 * the real WASM codecs in `codec.test.ts`, which passes exactly the plain
 * `{width, height, data}` shape these casts assert. Isolating the cast here
 * keeps the rest of the file honestly typed against our own `DecodedImage`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asImageData(image: unknown): any {
  return image;
}

export function createImageCodec(): ImageCodec {
  return {
    async decode(bytes, mimeType) {
      switch (mimeType) {
        case "image/jpeg":
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- see `asImageData` above
          return toDecodedImage(await decodeJpeg(asImageData(bytes)));
        case "image/png":
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- see `asImageData` above
          return toDecodedImage(await decodePng(asImageData(bytes)));
        case "image/webp":
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- see `asImageData` above
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
      const raster = await resizeImage(image, maxDimension);
      const encoded = await encodeWebpBytes(asImageData(raster));
      return new Uint8Array(encoded);
    },
  };
}

/** Scale `image` down so its longer side is at most `maxDimension` (never
 * up -- see `computeTargetSize`). Returns the same object when it already
 * fits. Exported on its own for the rotate/crop editor's preview raster,
 * which needs the pixels, not a WebP. */
export async function resizeImage(
  image: DecodedImage,
  maxDimension: number,
): Promise<DecodedImage> {
  const target = computeTargetSize(image, maxDimension);
  if (target.width === image.width && target.height === image.height) {
    return image;
  }
  return toDecodedImage(
    await resizePixels(asImageData(image), {
      width: target.width,
      height: target.height,
    }),
  );
}

function toDecodedImage(raw: unknown): DecodedImage {
  const img = raw as {
    width: number;
    height: number;
    data: Uint8ClampedArray | ArrayBuffer;
  };
  const data =
    img.data instanceof Uint8ClampedArray
      ? img.data
      : new Uint8ClampedArray(img.data);
  return { width: img.width, height: img.height, data };
}
