/**
 * `heic-decode` and `piexifjs` ship as plain CommonJS with no `.d.ts` (no
 * `@types/*` package exists for either). Declared ambiently here, typed only
 * to what `codec.ts` / `exif.ts` actually call -- both already narrow the
 * import with their own local cast (see their doc comments) for anything
 * beyond this.
 */

declare module "heic-decode" {
  interface HeicDecodeInput {
    readonly buffer: Uint8Array;
    readonly all?: boolean;
  }
  interface HeicDecodeResult {
    readonly width: number;
    readonly height: number;
    readonly data: ArrayBuffer;
  }
  export default function decodeHeic(
    input: HeicDecodeInput,
  ): Promise<HeicDecodeResult>;
}

declare module "piexifjs" {
  const piexif: unknown;
  export default piexif;
}
