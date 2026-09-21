/**
 * `TextDecoder` is a standard Encoding API global available natively in every
 * runtime this package targets (browser, Node >= 11, Deno) -- but the `dom`
 * lib is the only place TypeScript declares it, and pulling that whole lib in
 * would also expose browser-only globals (`window`, `document`, `fetch`, …)
 * this portable package must not depend on (WAYFINDER decision 8). Declared
 * ambiently here instead, with only the members `gedzip.ts` actually uses.
 * Never add this file to a consumer's `include`: these `declare class`
 * forms collide with the real `dom` lib.
 */
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  decode(input?: Uint8Array): string;
}

/** Same story for the Encoding API's encoder and the WHATWG Streams globals
 * `gedzip-write.ts` builds on (`ReadableStream` is native in Deno, browsers,
 * and Node >= 18): the `dom` lib is where TypeScript declares them, so the
 * members used here are declared ambiently instead. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

interface ReadableStreamDefaultController<R> {
  enqueue(chunk: R): void;
  close(): void;
  error(reason?: unknown): void;
}

interface ReadableStreamReadResult<R> {
  readonly done: boolean;
  readonly value: R | undefined;
}

interface ReadableStreamDefaultReader<R> {
  read(): Promise<ReadableStreamReadResult<R>>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

interface UnderlyingSource<R> {
  start?(controller: ReadableStreamDefaultController<R>): void | Promise<void>;
  pull?(controller: ReadableStreamDefaultController<R>): void | Promise<void>;
  cancel?(reason?: unknown): void | Promise<void>;
}

interface ReadableWritablePair<R, W> {
  readonly readable: ReadableStream<R>;
  readonly writable: WritableStream<W>;
}

declare class WritableStream<W = unknown> {
  private readonly __brand: W;
}

declare class ReadableStream<R = unknown> {
  constructor(
    underlyingSource?: UnderlyingSource<R>,
    strategy?: { highWaterMark?: number },
  );
  getReader(): ReadableStreamDefaultReader<R>;
  pipeThrough<T>(transform: ReadableWritablePair<T, R>): ReadableStream<T>;
}
