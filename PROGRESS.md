# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 0 — Foundation (not started)
**Planning:** complete. 33 decisions in `docs/WAYFINDER.md`, full build spec in
`docs/SPEC.md`.
**Repo:** initialized. `chore/scaffold` branch holds the planning docs and
project meta files, not yet committed by Josh.

## Next action

Once the scaffold branch is merged and GitHub issues exist:

- Phase 0, issue 1 — scaffold the pnpm monorepo (`apps/web` Next.js + TS +
  Tailwind, `packages/gedcom`, `packages/shared`, root verify scripts).

Until issues exist, the ordered list is `docs/SPEC.md` §10.

## Log

| Date | Session did | Result |
| --- | --- | --- |
| 2026-08-30 | Wayfinder planning — all 33 decisions settled | `docs/WAYFINDER.md` |
| 2026-08-30 | Wrote the build spec | `docs/SPEC.md` |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol | `chore/scaffold` |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. No issues exist yet — creating them from `docs/SPEC.md` §10 is
  the first task (see `CLAUDE.md` step 3).
- `.trillian-repo.json` (gitignored) carries verify commands and conventions —
  these reference scripts that issue 1 creates. Until then the verify gate has
  nothing to run.
- **Two open questions in `docs/SPEC.md` §11 need Josh before the issues they
  touch can start:** the frontend framework (blocks issue 1) and what the
  `public_visibility` setting exposes (blocks the public-visitor part of issue 9).
- The build spec was reviewed on 2026-08-30; two spec defects were fixed in place
  (`event.sort_key` generated-column rule, RLS coverage of family-owned rows).
