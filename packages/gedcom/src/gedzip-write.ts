/**
 * GedZip writing (issue #124) — the mirror of `gedzip.ts`: the `.ged` text
 * plus every media original, as one zip stream. The layout is the flat one
 * MacFamilyTree exports and `matchMediaFile` already resolves: `gedcom.ged`
 * at the root, each media file at the root under the name the `.ged`'s
 * `FILE` value carries. Media bytes are stored, not deflated — a JPEG, WebP,
 * or PDF does not compress, and inflating it on import would cost the same
 * CPU twice for nothing.
 *
 * The output is a `ReadableStream` driven by `pull`, so one entry's bytes
 * are in memory at a time and the next is read only when the consumer asks
 * — an edge worker with a 256 MB cap can build an archive far larger than
 * that (the storage upload streams too). fflate's streaming `Zip` has no
 * ZIP64, so a single archive stays under 4 GiB — Supabase Storage's own
 * per-object cap is lower. Portable: `fflate` and `ReadableStream` are
 * available unchanged in Deno, browsers, and Node (WAYFINDER decision 8).
 * fflate's streaming writer always uses data descriptors (flag bit 3), even
 * for stored entries — every central-directory reader (unzip, 7-Zip, macOS,
 * Python, `unzipSync` here) is fine with that; Java's streaming
 * `ZipInputStream` is the known exception.
 */

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

/** The archive path of the GEDCOM text — the name GEDCOM 7's GedZip
 * convention uses. */
export const GEDZIP_GEDCOM_ENTRY = "gedcom.ged";

export interface GedZipEntry {
  /** Archive path — flat, the value the `.ged`'s `FILE` tag carries. */
  readonly name: string;
  /** Called once, when the stream reaches this entry. */
  readonly read: () => Promise<Uint8Array>;
}

export interface CreateGedZipOptions {
  /** Entry timestamp — fixed by a test for a byte-stable archive. */
  readonly mtime?: Date;
}

/**
 * Stream a GedZip: {@link GEDZIP_GEDCOM_ENTRY} (deflated) first, then each
 * entry in order (stored). An entry whose `read` rejects errors the stream
 * — a partial archive is worse than none for a backup.
 */
export function createGedZipStream(
  gedcomText: string,
  entries: readonly GedZipEntry[],
  options: CreateGedZipOptions = {},
): ReadableStream<Uint8Array> {
  const zip = new Zip();
  const produced: Uint8Array[] = [];
  let zipError: Error | null = null;
  zip.ondata = (err, chunk) => {
    if (err) {
      zipError = err;
      return;
    }
    produced.push(chunk);
  };

  // -1: the .ged is still to be written; then the entry index; entries.length:
  // everything is in, the central directory is next.
  let cursor = -1;

  const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (zipError !== null) {
      throw zipError;
    }
    for (const chunk of produced) {
      controller.enqueue(chunk);
    }
    produced.length = 0;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (cursor === -1) {
          const file = new ZipDeflate(GEDZIP_GEDCOM_ENTRY);
          if (options.mtime !== undefined) {
            file.mtime = options.mtime;
          }
          zip.add(file);
          file.push(new TextEncoder().encode(gedcomText), true);
          cursor = 0;
        } else if (cursor < entries.length) {
          const entry = entries[cursor];
          if (entry === undefined) {
            throw new Error(`createGedZipStream: no entry at ${cursor}`);
          }
          const bytes = await entry.read();
          const file = new ZipPassThrough(entry.name);
          if (options.mtime !== undefined) {
            file.mtime = options.mtime;
          }
          zip.add(file);
          file.push(bytes, true);
          cursor++;
        } else {
          zip.end();
          flush(controller);
          controller.close();
          return;
        }
        flush(controller);
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

/** Collect a whole stream — for a test, or a caller that wants the bytes. */
export async function readStreamToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// --- entry names -------------------------------------------------------

export interface ArchiveNameSource {
  readonly id: string;
  readonly original_filename: string | null;
  readonly mime_type: string | null;
}

const FORBIDDEN_NAME_CHARS = '<>:"|?*';

/** The last path segment, whichever separator the exporting OS used, with
 * anything a zip or a filesystem would choke on replaced. */
function archiveBasename(path: string): string {
  const tail = path.split(/[\\/]/).pop() ?? "";
  // Control characters and the few bytes no common filesystem allows in a
  // name; the separators are already gone.
  let out = "";
  for (const ch of tail) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || FORBIDDEN_NAME_CHARS.includes(ch) ? "_" : ch;
  }
  return out.trim();
}

/**
 * One archive path per media row, unique across the archive: the stored
 * original's basename, or `<id>.<ext>` when there is none (`.`/`..` count
 * as none — an importer must never see a path step); a basename a second
 * row also claims gets `-<first 8 of its id>` before the extension, and the
 * whole id if even that is taken. Deterministic in row order, so two
 * exports of the same tree name the same files. `extensionForMime` is
 * injected — `@rootward/media` owns that table, and this package must not
 * depend on it.
 */
export function archiveEntryNames(
  media: readonly ArchiveNameSource[],
  extensionForMime: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>([GEDZIP_GEDCOM_ENTRY.toLowerCase()]);
  for (const row of media) {
    const extension =
      row.mime_type !== null ? extensionForMime[row.mime_type] : undefined;
    let base =
      row.original_filename !== null
        ? archiveBasename(row.original_filename)
        : "";
    if (base === "" || base === "." || base === "..") {
      base = extension !== undefined ? `${row.id}.${extension}` : row.id;
    }
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    const candidates = [
      base,
      `${stem}-${row.id.slice(0, 8)}${ext}`,
      `${stem}-${row.id}${ext}`,
    ];
    const name = candidates.find((c) => !taken.has(c.toLowerCase()));
    if (name === undefined) {
      // Three rows with this basename *and* this id — ids are unique, so
      // this cannot happen; a throw beats a silent duplicate in a backup.
      throw new Error(`archiveEntryNames: no unique name for ${row.id}`);
    }
    taken.add(name.toLowerCase());
    names.set(row.id, name);
  }
  return names;
}
