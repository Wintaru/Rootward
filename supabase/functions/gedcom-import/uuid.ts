/**
 * Deterministic RFC 4122 version-5 (namespace + SHA-1) UUIDs.
 *
 * The importer derives every row id from `uuidv5(<stable key>, jobId)` so that
 * re-processing a half-written batch after a timeout upserts the same rows
 * instead of inserting duplicates (see `importer.ts`). SHA-1 comes from Web
 * Crypto (`crypto.subtle`), a global available in Deno, Node, and the test
 * runner — no import, no Node/Deno built-in.
 */

const HEX: readonly string[] = Array.from(
  { length: 256 },
  (_, i) => i.toString(16).padStart(2, "0"),
);

/** Parse a canonical UUID string into its 16 bytes. */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`not a UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Format 16 bytes as a canonical lowercase UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => HEX[b]);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${
    h
      .slice(6, 8)
      .join("")
  }-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

/**
 * `uuidv5(name, namespace)` — stable for a given `(name, namespace)` pair.
 * `namespace` is any canonical UUID string (the importer passes the job id).
 */
export async function uuidv5(name: string, namespace: string): Promise<string> {
  const ns = uuidToBytes(namespace);
  const label = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + label.length);
  input.set(ns, 0);
  input.set(label, ns.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const out = digest.slice(0, 16);
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(out);
}
