/**
 * Stands in for `heic-decode` in the browser bundle only (aliased in
 * `next.config.ts`'s `turbopack.resolveAlias`, `browser` condition). That
 * package always `require`s `libheif-js`'s default Node build, whose
 * Emscripten glue code has a `require("fs")` branch Turbopack cannot
 * resolve for a browser target, no matter how deeply it is nested (issue
 * #104 pt. 2) -- and `libheif-js`'s own dependency-free WASM build exposes
 * only the raw C-style Emscripten bindings, not the `HeifDecoder` class
 * `heic-decode` wraps them in, so swapping to it directly would mean
 * reimplementing that wrapper from scratch.
 *
 * Instead: HEIC photos processed client-side degrade to "stored original,
 * no thumbnail" -- `@rootward/media`'s `processMediaBytes` already treats a
 * `codec.decode` rejection exactly like GIF/PDF's genuine "no codec for
 * this format" case (a warning, not a failure), so this only needs to
 * reject. Deno (`media-process`, still server-side) keeps the real codec
 * and full HEIC support -- this stub is browser-only.
 */
export default function decodeHeic(): Promise<never> {
  return Promise.reject(
    new Error("HEIC decoding is not available in the browser"),
  );
}
