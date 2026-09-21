import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

/**
 * The GEDCOM the destructive import test loads.
 *
 * Resolution order, most specific first:
 *   1. `E2E_GEDCOM_PATH` — an explicit override;
 *   2. `docs/reference/rootward-demo/rootward-demo.gdz` — the generated
 *      600-person demo GedZip with a photo per person, when it has been
 *      built (`pnpm demo:build`; the archive is gitignored);
 *   3. `~/Downloads/Donner/Donner.ged` — the real 735-person export Josh
 *      tests with locally. Deliberately *not* copied into the repo: it is a
 *      real family's data and this repository is public;
 *   4. `docs/reference/demo-tree.ged` — the small fixture that ships with the
 *      repo, so CI and a fresh clone still have something to import.
 */
export function resolveGedcomPath(): { path: string; label: string } {
  const override = process.env.E2E_GEDCOM_PATH;
  if (override !== undefined && override.trim() !== "") {
    return { path: override, label: "E2E_GEDCOM_PATH" };
  }

  const demoGedZip = fileURLToPath(
    new URL(
      "../../docs/reference/rootward-demo/rootward-demo.gdz",
      import.meta.url,
    ),
  );
  if (existsSync(demoGedZip)) {
    return { path: demoGedZip, label: "the built demo GedZip" };
  }

  const donner = resolve(homedir(), "Downloads/Donner/Donner.ged");
  if (existsSync(donner)) {
    return { path: donner, label: "the local Donner export" };
  }

  return {
    path: fileURLToPath(
      new URL("../../docs/reference/demo-tree.ged", import.meta.url),
    ),
    label: "the repo's demo tree",
  };
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** What the file under test contains, counted straight off the text so the
 * import test can assert the database got all of it. A GedZip is unzipped
 * here (its first `.ged` entry is the GEDCOM; every other entry is a media
 * file). */
export interface GedcomSummary {
  readonly isArchive: boolean;
  readonly gedcomText: string;
  readonly individuals: number;
  readonly families: number;
  readonly mediaRecords: number;
  /** Archive entries other than the GEDCOM; 0 for a plain `.ged`. */
  readonly archiveFiles: number;
}

export function summarizeGedcom(path: string): GedcomSummary {
  const bytes = readFileSync(path);
  const isArchive = ZIP_SIGNATURE.every((b, i) => bytes[i] === b);
  let gedcomText: string;
  let archiveFiles = 0;
  if (isArchive) {
    // Inflate only the GEDCOM entry (the same rule as `readGedZip` in
    // packages/gedcom); the photos are counted by name, never decompressed.
    let ged: string | undefined;
    const entries = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        if (file.name.endsWith("/")) {
          return false;
        }
        if (ged === undefined && /\.(ged|gedcom)$/i.test(file.name)) {
          ged = file.name;
          return true;
        }
        archiveFiles += 1;
        return false;
      },
    });
    if (ged === undefined) {
      throw new Error(`${path}: zip has no .ged entry`);
    }
    gedcomText = new TextDecoder().decode(entries[ged]);
  } else {
    gedcomText = bytes.toString("utf8");
  }
  const count = (tag: string) =>
    (gedcomText.match(new RegExp(`^0 @[^@]+@ ${tag}\\s*$`, "gm")) ?? []).length;
  return {
    isArchive,
    gedcomText,
    individuals: count("INDI"),
    families: count("FAM"),
    mediaRecords: count("OBJE"),
    archiveFiles,
  };
}
