# Supabase Edge Functions

Deno runtime (SPEC §7). This tree is **not** part of the pnpm workspace — `deno`
owns it. `deno.json` holds the import map, the `sloppy-imports` flag (the
portable `packages/*` use extensionless relative imports), lint/format config,
and the task shortcuts.

## Prerequisites

Install Deno once: `brew install deno` (or `mise use -g deno@2`). The local
verify gate and CI both run the Deno checks.

## Commands

Run from `supabase/functions/`:

| Command                         | What it does                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `deno fmt` / `deno fmt --check` | Format (Prettier ignores this tree).                                                    |
| `deno lint`                     | Lint.                                                                                   |
| `deno task check`               | `deno check gedcom-import/` — typecheck, including the imported `@rootward/*` packages. |
| `deno task test`                | Run the `*_test.ts` / `*.test.ts` suites.                                               |

CI runs all four in the `functions` job (`.github/workflows/ci.yml`).

## Serving locally

`supabase start` bakes an edge runtime that mounts only this directory. The
`@rootward/*` entries in `deno.json` point at `../../packages/*/src/`, so that
runtime cannot load `gedcom-import` or `gedcom-export` (its log shows
`Module not found …/packages/gedcom/src/index.ts`). Run the functions with the
import map named explicitly instead — the CLI then binds each mapped directory
into the container:

```sh
supabase functions serve --import-map supabase/functions/deno.json
```

The directory entries (`"@rootward/gedcom/"`, `"@rootward/shared/"`) exist for
that bind. A bare file entry binds only `index.ts`, and its sibling modules do
not resolve.

Known gap: the edge runtime does not honour `sloppy-imports`, so the
extensionless relative imports inside `packages/*` (`from "./reader"`) still
fail to load there. Until those imports carry `.ts` extensions, the two GEDCOM
functions boot only under the Deno CLI (tests) — issue #86.

## Layout of a function

Each function splits the portable engine from the Deno shell so the engine is
testable without the edge runtime:

- `importer.ts` — pure TypeScript. No Deno APIs, no database driver. All I/O
  goes through an injected gateway interface.
- `gateway.ts` — the gateway backed by a service-role `supabase-js` client.
- `index.ts` — the `Deno.serve` shell: auth, the time budget, self-reinvoke.
- `*.test.ts` — drives the engine with an in-memory fake gateway.

## `gedcom-import` (issue #14)

`POST { "jobId": "<uuid>" }`. Auth: a moderator/admin user JWT, or the
service-role key for the self-reinvoke. `initial` mode only.

Resumable by construction: every row id is `uuidv5(<stable key>, jobId)`, so a
timeout that re-runs a batch upserts the same rows. The only cross-invocation
state is `import_job.cursor` (`{ phase, offset }`).

## `gedcom-export` (issue #15)

`POST { "jobId": "<uuid>" }`. Auth: a moderator/admin user JWT, or the
service-role key. `manual_gedcom` type only.

One pass, no cursor — `export_status` is `pending → running → completed/failed`.
`exporter.ts` reads every genealogy table (each paged past the PostgREST
1000-row cap), rebuilds a `GedcomReadResult`, and `writeGedcom` serialises it to
5.5.1. A row keeps its imported `gedcom_xref`; an app-created row gets a
synthesised `@I1@` / `@F1@` / … . The file lands at `exports/<jobId>.ged` in the
private `exports` bucket (migration `20260830231234`); the caller gets a 1-hour
signed URL and `export_job` records `storage_path` / `size_bytes`.
