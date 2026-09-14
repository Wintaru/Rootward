/**
 * `TextDecoder` is a standard Encoding API global available natively in every
 * runtime this package targets (browser, Node >= 11, Deno) -- but the `dom`
 * lib is the only place TypeScript declares it, and pulling that whole lib in
 * would also expose browser-only globals (`window`, `document`, `fetch`, …)
 * this portable package must not depend on (WAYFINDER decision 8). Declared
 * ambiently here instead, with only the members `gedzip.ts` actually uses.
 */
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  decode(input?: Uint8Array): string;
}
