// `pnpm check:cli-version` — every pinned Supabase CLI version matches the
// one source, `scripts/supabase-cli-version.mjs`.
//
// That module is the real value, and `scripts/dev-fresh.mjs` imports it. Two
// sites cannot: `package.json` is a shell string inside JSON, and `ci.yml`'s
// `version:` is a GitHub Actions input, which cannot read a repo file without
// an extra step piping into `$GITHUB_OUTPUT`. Those two keep literals, and
// this script fails the build when either one drifts (issue #103).
//
// Different CLI versions emit slightly different generic-type boilerplate for
// the same schema, so a one-sided bump makes CI's type-drift check fail for a
// reason unrelated to the schema. That has happened twice. Comments asking the
// next person to update the others were the only guard, and comments do not
// fail a build.
//
// Three rules keep this from quietly checking less than it claims:
//
//   - A version is captured as a whole token, never as three integers. Reading
//     `2.117.0-beta.1` as `2.117.0` would report a real disagreement as
//     agreement, which is the one failure a guard must never have.
//   - EVERY occurrence in a file is collected, not just the first. A second
//     `supabase/setup-cli` step added to `ci.yml` — which the CD proposal
//     would do — must not be invisible.
//   - A site that matches nothing is a failure, not a skip. Renaming a script
//     must break this loudly rather than silently shrink what is compared.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPABASE_CLI_VERSION } from "./supabase-cli-version.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every `version:` belonging to a `supabase/setup-cli` step, however many
 * steps there are and whatever else sits inside each one's `with:` block.
 *
 * Scanning forward to the next step rather than matching fixed line order:
 * another input above `version:`, a comment between `uses:` and `with:`, or a
 * bump to `@v2` would all defeat a rigid pattern, and none of them changes the
 * fact being checked.
 */
function setupCliVersions(source) {
  const versions = [];
  const step = /uses:\s*supabase\/setup-cli@v\d+/g;
  let match;
  while ((match = step.exec(source)) !== null) {
    const rest = source.slice(match.index + match[0].length);
    // The step ends where the next list item begins.
    const end = rest.search(/\n\s*- /);
    const body = end === -1 ? rest : rest.slice(0, end);
    const version = /\n\s*version:\s*["']?([^\s"']+)/.exec(body);
    if (version?.[1] !== undefined) {
      versions.push(version[1]);
    }
  }
  return versions;
}

/** The sites that hold a literal, and how to read every version out of each. */
const SITES = [
  {
    file: "package.json",
    what: "the `gen:types` script",
    read: (source) =>
      [...source.matchAll(/"gen:types":\s*"npx -y supabase@([^\s"]+)/g)].map(
        (m) => m[1],
      ),
  },
  {
    file: ".github/workflows/ci.yml",
    what: "a `supabase/setup-cli` step",
    read: setupCliVersions,
  },
];

const problems = [];
const pins = [];

for (const site of SITES) {
  let source;
  try {
    source = readFileSync(join(repoRoot, site.file), "utf8");
  } catch (error) {
    problems.push(
      `${site.file}: could not be read (${error.code ?? error.message}). If ` +
        `it moved, update this script — a site that stops being checked is ` +
        `how the drift returns.`,
    );
    continue;
  }

  const versions = site.read(source);
  if (versions.length === 0) {
    problems.push(
      `${site.file}: found no version in ${site.what}. If it moved or was ` +
        `renamed, update this script — a site that stops being checked is ` +
        `how the drift returns.`,
    );
    continue;
  }
  for (const version of versions) {
    pins.push({ file: site.file, version });
  }
}

const wrong = pins.filter((p) => p.version !== SUPABASE_CLI_VERSION);
if (wrong.length > 0) {
  problems.push(
    `These pins do not match scripts/supabase-cli-version.mjs ` +
      `(${SUPABASE_CLI_VERSION}):\n` +
      wrong.map((p) => `  ${p.version}  ${p.file}`).join("\n") +
      `\nChange them to ${SUPABASE_CLI_VERSION}, or change the source module ` +
      `and then all of them. They must agree, or the generated types differ ` +
      `between a developer's machine and CI.`,
  );
}

if (problems.length > 0) {
  console.error(`check-supabase-cli-version: ${problems.join("\n\n")}`);
  process.exit(1);
}

console.log(
  `check-supabase-cli-version: ${pins.length} pinned site(s) match ` +
    `${SUPABASE_CLI_VERSION}.`,
);
