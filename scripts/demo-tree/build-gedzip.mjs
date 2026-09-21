// Build the demo GedZip: fetch the photos the manifest names, write the PDF
// "scans", and zip them next to the GEDCOM the way a MacFamilyTree export's
// media folder zips up (flat, basenames only).
//
//   node scripts/demo-tree/build-gedzip.mjs [--concurrency N] [--force]
//
// Runs after `generate.mjs`. Needs the network once: photos come from
// cataas.com (Cat as a Service — free, ~2000 stable ids, per-id sizing), with
// Lorem Picsum as the fallback when a cat cannot be fetched. Every file is
// cached under `media/` (gitignored), so a re-run only fetches what is
// missing; `--force` refetches everything. Which cat a person gets is a hash
// of the manifest entry's seed, so the same generator output maps to the same
// cats as long as the cached id list is kept.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const CONCURRENCY = Number(argValue("--concurrency", "6"));
const FORCE = args.includes("--force");
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
  console.error("--concurrency must be a positive integer");
  process.exit(1);
}

const DEMO_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/reference/rootward-demo",
);
const MEDIA_DIR = resolve(DEMO_DIR, "media");
const MANIFEST_PATH = resolve(DEMO_DIR, "media-manifest.json");
const IDS_CACHE_PATH = resolve(MEDIA_DIR, "cataas-ids.json");
const OUTPUT_PATH = resolve(DEMO_DIR, "rootward-demo.gdz");

const CATAAS = "https://cataas.com";
const PICSUM = "https://picsum.photos";
const FETCH_TIMEOUT_MS = 30_000;
const RETRIES = 3;

/** Pixel sizes per media kind: square portraits, 4:3 photos. */
const SIZES = {
  portrait: { width: 400, height: 400 },
  photo: { width: 640, height: 480 },
};

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchBytes(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeJpeg(bytes)) {
        throw new Error(`not a JPEG (${res.headers.get("content-type")})`);
      }
      return bytes;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function looksLikeJpeg(bytes) {
  return (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

/** The full cataas id list, cached so cat assignments stay stable locally. */
async function loadCataasIds() {
  if (existsSync(IDS_CACHE_PATH) && !FORCE) {
    return JSON.parse(readFileSync(IDS_CACHE_PATH, "utf8"));
  }
  const res = await fetch(`${CATAAS}/api/cats?limit=5000&skip=0`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`cataas id list: HTTP ${res.status}`);
  }
  const cats = await res.json();
  const ids = cats
    .filter((c) => c.mimetype === "image/jpeg")
    .map((c) => c.id)
    .sort();
  if (ids.length === 0) {
    throw new Error("cataas id list is empty");
  }
  mkdirSync(MEDIA_DIR, { recursive: true });
  writeFileSync(IDS_CACHE_PATH, JSON.stringify(ids) + "\n");
  return ids;
}

function hashIndex(seed, modulo) {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % modulo;
}

function catUrl(entry, ids) {
  const id = ids[hashIndex(entry.seed, ids.length)];
  const { width, height } = SIZES[entry.kind];
  const filter = entry.mono ? "&filter=mono" : "";
  return `${CATAAS}/cat/${id}?width=${width}&height=${height}${filter}`;
}

function picsumUrl(entry) {
  const { width, height } = SIZES[entry.kind];
  const grayscale = entry.mono ? "?grayscale" : "";
  return `${PICSUM}/seed/${encodeURIComponent(entry.seed)}/${width}/${height}.jpg${grayscale}`;
}

async function fetchPhoto(entry, ids, stats) {
  try {
    return await fetchBytes(catUrl(entry, ids));
  } catch (err) {
    stats.fallbacks.push(`${entry.path}: ${err.message}`);
    return fetchBytes(picsumUrl(entry));
  }
}

// ---------------------------------------------------------------------------
// PDF "scans" — a minimal single-page PDF, no library needed
// ---------------------------------------------------------------------------

function pdfEscape(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** WinAnsi covers Latin-1, so an accented letter in that range stays as it
 * is; anything outside it (no font is embedded) is decomposed and reduced
 * to its base letter, or dropped. */
function toWinAnsi(text) {
  return [...text]
    .map((ch) =>
      /[\x20-\x7e\xa0-\xff]/.test(ch)
        ? ch
        : ch.normalize("NFKD").replace(/[^\x20-\x7e\xa0-\xff]/g, ""),
    )
    .join("");
}

function buildPdf(lines) {
  const content = [
    "BT",
    "/F1 18 Tf",
    "72 720 Td",
    "22 TL",
    ...lines.map((line, i) => {
      const size = i === 0 ? 18 : 12;
      return `/F1 ${size} Tf (${pdfEscape(toWinAnsi(line))}) Tj T*`;
    }),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`${MANIFEST_PATH} not found — run generate.mjs first`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  mkdirSync(MEDIA_DIR, { recursive: true });

  const stats = { fetched: 0, cached: 0, written: 0, fallbacks: [] };
  const photos = manifest.files.filter((f) => f.kind !== "document");
  const documents = manifest.files.filter((f) => f.kind === "document");

  for (const entry of documents) {
    writeFileSync(resolve(MEDIA_DIR, entry.path), buildPdf(entry.lines));
    stats.written += 1;
  }

  const pending = photos.filter(
    (f) => FORCE || !existsSync(resolve(MEDIA_DIR, f.path)),
  );
  stats.cached = photos.length - pending.length;
  if (pending.length > 0) {
    const ids = await loadCataasIds();
    console.log(
      `Fetching ${pending.length} photo(s) from ${CATAAS} (${ids.length} cats), ${CONCURRENCY} at a time…`,
    );
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < pending.length) {
        const entry = pending[next++];
        const bytes = await fetchPhoto(entry, ids, stats);
        writeFileSync(resolve(MEDIA_DIR, entry.path), bytes);
        stats.fetched += 1;
        done += 1;
        if (done % 50 === 0 || done === pending.length) {
          console.log(`  ${done}/${pending.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  // Zip: the GEDCOM plus every manifest file, flat. JPEG/PDF bytes are
  // stored (level 0) — they do not compress and the import unzips them
  // client-side anyway.
  const entries = {
    [manifest.gedcom]: readFileSync(resolve(DEMO_DIR, manifest.gedcom)),
  };
  for (const f of manifest.files) {
    entries[f.path] = [readFileSync(resolve(MEDIA_DIR, f.path)), { level: 0 }];
  }
  const zipped = zipSync(entries, { level: 6 });
  writeFileSync(OUTPUT_PATH, zipped);

  const stale = readdirSync(MEDIA_DIR).filter(
    (name) =>
      name !== "cataas-ids.json" &&
      !manifest.files.some((f) => f.path === name),
  );
  const mb = (statSync(OUTPUT_PATH).size / 1_048_576).toFixed(1);
  console.log(
    `Wrote ${OUTPUT_PATH} (${mb} MB): ${manifest.files.length} media files ` +
      `(${stats.fetched} fetched, ${stats.cached} cached, ${stats.written} PDFs written).`,
  );
  if (stats.fallbacks.length > 0) {
    console.log(
      `${stats.fallbacks.length} photo(s) fell back to ${PICSUM}:\n  ` +
        stats.fallbacks.slice(0, 10).join("\n  "),
    );
  }
  if (stale.length > 0) {
    console.log(
      `${stale.length} cached file(s) in media/ are no longer in the manifest (left in place).`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
