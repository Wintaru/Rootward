# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 0 — Foundation (in progress).
**Planning:** complete. 35 decisions in `docs/WAYFINDER.md`, full build spec in
`docs/SPEC.md`. No open questions that block starting.
**Issues:** created. 46 GitHub issues on `Wintaru/Rootward` — items 1–40 from
`docs/SPEC.md` §10 (one per numbered item) plus 6 Post-MVP issues. Milestones
`Phase 0`–`Phase 8` + `Post-MVP`. Labels: `phase:0`–`phase:8`,
`area:db|gedcom|frontend|auth|edge|infra`, `mvp`, `post-mvp`, `ready`, `blocked`.

**Issue #1 — Scaffold the pnpm monorepo: done, merged to `main` (667956e),
issue closed.** pnpm workspace with `apps/web` (Next.js 16 + React 19 + Tailwind
v4 + shadcn/ui radix-nova), `packages/shared`, `packages/gedcom` (both empty
pure-TS), root Prettier + shared ESLint base, root scripts
`typecheck / lint / format / format:check / build / test`.

**Issue #2 — Local Supabase dev stack + `pnpm dev`: done, merged to `main`
(8b067b8), issue closed.** `supabase init` + `supabase/config.toml` (ports
shifted `+3000` to the 573xx block so the stack does not collide with other
local Supabase projects), root `.env.example`, `pnpm dev` (Supabase + web via
`scripts/dev.mjs`), `pnpm dev:status` / `dev:stop` / `dev:reset`,
`supabase/seed.sql` placeholder.

**Issue #3 — GitHub Actions CI pipeline: done, PR open on `chore/ci-pipeline`.**
`.github/workflows/ci.yml` — two parallel jobs on `pull_request` to `main` and
`push` to `main`: `verify` (`pnpm install --frozen-lockfile`, `typecheck`,
`lint`, `format:check`, `test`) and `migrations` (Supabase CLI → `supabase
start` → `supabase db lint --fail-on error`). `build` is deliberately not in CI
(SPEC §10 item 3 / WAYFINDER 32 list it out). Verify gate green locally. The two
"Done when" checks that need a live run — CI passes on a no-op PR, and a
deliberate lint/type/format error fails it — are verified by Josh after he pushes
`chore/ci-pipeline` and opens the PR. Merge the PR before starting #4.

## Next action

Phase 1, issue **#4 — Migration: enums + `person`, `person_name`, `family`,
`family_child`** (`docs/SPEC.md` §10 item 4, §4.1). Blocked until #3 merges.
After #3 merges, label #4–#10 `ready` (closing #3 unblocks Phase 1).

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date       | Session did                                                                         | Result                           |
| ---------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| 2026-08-30 | Wayfinder planning — all decisions settled                                          | `docs/WAYFINDER.md` (1–33)       |
| 2026-08-30 | Wrote the build spec                                                                | `docs/SPEC.md`                   |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol                               | `chore/scaffold`                 |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions             | `docs/WAYFINDER.md` (34–35)      |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies | GitHub issues #1–#46             |
| 2026-08-30 | Issue #1 — scaffolded the pnpm monorepo; verify gate green                          | `chore/scaffold-monorepo`        |
| 2026-08-30 | Issue #2 — local Supabase dev stack, `pnpm dev` / `dev:status`, `.env.example`      | `chore/local-supabase-dev-stack` |
| 2026-08-30 | Issue #3 — GitHub Actions CI (`verify` + `migrations` jobs); build kept out of CI   | `chore/ci-pipeline`              |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- #1 and #2 are closed. #3's PR is on `chore/ci-pipeline`; after it merges,
  `gh issue close 3` and label #4–#10 `ready`. Later issues get `ready` as their
  dependencies close — do this when you finish an issue.
- CI (`.github/workflows/ci.yml`): `verify` job = install + typecheck + lint +
  format:check + test; `migrations` job = `supabase start` + `supabase db lint`.
  No `build` step — SPEC §10 item 3 and WAYFINDER 32 list it out; add it later if
  wanted. Runs on PRs to `main` and pushes to `main`.
- `.trillian-repo.json` (gitignored) carries verify commands and conventions.
  The scripts it names now exist (issue #1): `pnpm typecheck / lint / format /
format:check / build / test` all run from the repo root.
- `pnpm dev` runs `scripts/dev.mjs`: `supabase start` then `next dev -p 3000`.
  `pnpm dev:status` reports both; `dev:stop` / `dev:reset` wrap the CLI. It loads
  the repo-root `.env` (copy from `.env.example`; `supabase status -o env` prints
  the local keys).
- Local Supabase ports are shifted `+3000` from the defaults (the 573xx block) so
  the stack does not collide with other local Supabase projects. `supabase/config.toml`
  is the source of truth. The Trillian `supabase-local` port-block registry should
  get a `rootward` / n=3 row.
- `apps/web` typecheck runs `next typegen` first — Next 16 generates route and
  layout prop types into `.next/types` that a bare `tsc` needs.
- The build spec was reviewed on 2026-08-30; two spec defects were fixed in place
  (`event.sort_key` generated-column rule, RLS coverage of family-owned rows).
- `docs/SPEC.md` §11 now holds only decide-in-issue items (no blockers).
