# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 0 — Foundation (not started)
**Planning:** complete. 35 decisions in `docs/WAYFINDER.md`, full build spec in
`docs/SPEC.md`. No open questions that block starting.
**Repo:** initialized. First commit (`chore: initialize Rootward…`) is on
`chore/scaffold`. A follow-up commit adds decisions 34–35 and the spec edits.
Branch not yet pushed / merged.

## Next action

Once the scaffold branch is merged:

1. Create the GitHub issue set from `docs/SPEC.md` §10 (one issue per numbered
   item, milestone per phase). This is a session on its own.
2. Then Phase 0, issue 1 — scaffold the pnpm monorepo (`apps/web` Next.js + TS +
   Tailwind + shadcn/ui, `packages/gedcom`, `packages/shared`, root verify
   scripts).

Until issues exist, the ordered list is `docs/SPEC.md` §10.

## Log

| Date | Session did | Result |
| --- | --- | --- |
| 2026-08-30 | Wayfinder planning — all decisions settled | `docs/WAYFINDER.md` (1–33) |
| 2026-08-30 | Wrote the build spec | `docs/SPEC.md` |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol | `chore/scaffold` |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions | `docs/WAYFINDER.md` (34–35) |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. No issues exist yet — creating them from `docs/SPEC.md` §10 is
  the first task (see `CLAUDE.md` step 3).
- `.trillian-repo.json` (gitignored) carries verify commands and conventions —
  these reference scripts that issue 1 creates. Until then the verify gate has
  nothing to run.
- The build spec was reviewed on 2026-08-30; two spec defects were fixed in place
  (`event.sort_key` generated-column rule, RLS coverage of family-owned rows).
- The two open questions from that review are resolved: frontend stack is
  Next.js + TypeScript + Tailwind + shadcn/ui (decision 34); nothing is public
  but the login page (decision 35). `docs/SPEC.md` §11 now holds only
  decide-in-issue items.
