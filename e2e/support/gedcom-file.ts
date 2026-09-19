import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The GEDCOM the destructive import test loads.
 *
 * Resolution order, most specific first:
 *   1. `E2E_GEDCOM_PATH` — an explicit override;
 *   2. `~/Downloads/Donner/Donner.ged` — the real 735-person export Josh
 *      tests with locally. Deliberately *not* copied into the repo: it is a
 *      real family's data and this repository is public;
 *   3. `docs/reference/demo-tree.ged` — the small fixture that ships with the
 *      repo, so CI and a fresh clone still have something to import.
 */
export function resolveGedcomPath(): { path: string; label: string } {
  const override = process.env.E2E_GEDCOM_PATH;
  if (override !== undefined && override.trim() !== "") {
    return { path: override, label: "E2E_GEDCOM_PATH" };
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
