# Contributing to Rootward

Thank you for your interest in Rootward. This guide explains how to set up
the project, how the codebase is organized, and how to submit a change.

## How this project is built

Rootward's own development runs as a series of focused work sessions, one
GitHub issue at a time. Each session reads three documents in order:

1. [`docs/WAYFINDER.md`](docs/WAYFINDER.md) — the settled design decisions,
   numbered, with the reasoning behind each one.
2. [`docs/SPEC.md`](docs/SPEC.md) — the build contract derived from
   WAYFINDER. Each numbered item in its §10 build list maps to one GitHub
   issue.
3. [`PROGRESS.md`](PROGRESS.md) — where the build stands right now.

If you plan a change larger than a small fix, read the relevant `SPEC.md`
section first. If the spec looks wrong or thin for what you need, open an
issue to discuss it before you write code — `WAYFINDER.md` wins over
`SPEC.md` on any conflict, and both should stay in sync with the database
and the app.

## Prerequisites

See the [README](README.md#local-development) for setup: Node, `pnpm`, the
Supabase CLI, and Docker (or OrbStack). Get the local stack running with
`pnpm dev` before you start.

## Branch and commit conventions

Cut a new branch from an up-to-date `main` for every change:

```sh
git fetch origin main
git switch -c <type>/<slug> origin/main
```

Use one of these prefixes for `<type>`: `feat`, `fix`, `chore`, `refactor`,
`docs`, `test`.

Write commits in the
[Conventional Commits](https://www.conventionalcommits.org/) style: a short
subject line (`type: what changed`, no trailing period), then a body of one
or two sentences that explains _why_, only when the reason is not obvious
from the diff. Keep commits small. A commit that mixes an interface change
with an unrelated fix is two commits, not one.

## The verify gate

Run these checks before you open a pull request. All of them must pass.

```sh
# Type-check
pnpm typecheck
deno check --config supabase/functions/deno.json supabase/functions/gedcom-import/ supabase/functions/gedcom-export/ supabase/functions/onboarding-match/ supabase/functions/media-process/

# Lint
pnpm lint
deno lint --config supabase/functions/deno.json supabase/functions/

# Format
pnpm format:check
deno fmt --check --config supabase/functions/deno.json supabase/functions/

# Build
pnpm build

# Tests
pnpm test
deno test --allow-read --config supabase/functions/deno.json supabase/functions/
```

The Deno commands cover `supabase/functions/` — it sits outside the pnpm
workspace and needs the Deno CLI (`brew install deno`, or see
[deno.land](https://deno.land) for other platforms). See
[`supabase/functions/README.md`](supabase/functions/README.md) for how the
edge functions are structured.

## Migration rules

- **Schema is migrations.** Never edit a migration that has already shipped.
  Add a new migration for every schema change, even a small one.
- **RLS is the access boundary.** Every new table gets row-level security
  enabled, with an allow/deny test in the same pull request. Frontend checks
  are a convenience for users, not a security control — the database enforces
  access on its own.
- **The GEDCOM parser stays portable.** `packages/gedcom` and the date parser
  in `packages/shared` use plain TypeScript only, with no Deno- or
  Node-specific APIs. This keeps a future port to another language possible.

## Opening a pull request

- Target `main`.
- One reviewed, self-contained change per pull request. If your change spans
  more than one concern, split it into separate pull requests.
- Describe _why_ the change is needed, not just what changed — the diff
  already shows what changed.
- Link the GitHub issue the change addresses, if there is one.

## Reporting a bug or requesting a feature

Open a GitHub issue. Include steps to reproduce a bug, or the use case for a
feature request. Check `docs/SPEC.md` §10 and the open issue list first —
your idea may already be tracked there.
