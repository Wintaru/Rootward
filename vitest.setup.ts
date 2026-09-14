/**
 * `@jsquash/*`'s wasm-bindgen glue code loads its `.wasm` binary via
 * `fetch(new URL('<name>_bg.wasm', import.meta.url))` -- a `file:` URL,
 * which is exactly what Deno's `fetch` (used at runtime, in the edge
 * functions) and every browser (used at runtime, in `apps/web`) support
 * natively. Node's `fetch` does not implement the `file:` scheme at all, so
 * under vitest -- Node only, never a real runtime target -- that call
 * throws instead of resolving. Patching `fetch` here, once, for the test
 * run keeps `packages/media`'s own source completely portable (WAYFINDER
 * decision 8): this file is test tooling, not shipped code.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const realFetch = globalThis.fetch;

globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  if (!url.startsWith("file:")) {
    return realFetch(input, init);
  }
  const bytes = await readFile(fileURLToPath(url));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/wasm" },
  });
};
