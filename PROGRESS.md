# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 0 — Foundation (not started)
**Planning:** complete. 35 decisions in `docs/WAYFINDER.md`, full build spec in
`docs/SPEC.md`. No open questions that block starting.
**Issues:** created. 46 GitHub issues on `Wintaru/Rootward` — items 1–40 from
`docs/SPEC.md` §10 (one per numbered item) plus 6 Post-MVP issues. Milestones
`Phase 0`–`Phase 8` + `Post-MVP`. Labels: `phase:0`–`phase:8`,
`area:db|gedcom|frontend|auth|edge|infra`, `mvp`, `post-mvp`, `ready`, `blocked`.
Issues 1–3 (all of Phase 0) carry `ready`.

## Next action

Phase 0, issue **#1 — Scaffold the pnpm monorepo**. It is the lowest-numbered
`ready` issue and unblocks everything else.

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date | Session did | Result |
| --- | --- | --- |
| 2026-08-30 | Wayfinder planning — all decisions settled | `docs/WAYFINDER.md` (1–33) |
| 2026-08-30 | Wrote the build spec | `docs/SPEC.md` |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol | `chore/scaffold` |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions | `docs/WAYFINDER.md` (34–35) |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies | GitHub issues #1–#46 |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- Only Phase 0 (#1–#3) is labelled `ready`. Later issues get `ready` as their
  dependencies close — do this when you finish an issue.
- `.trillian-repo.json` (gitignored) carries verify commands and conventions —
  these reference scripts that issue #1 creates. Until then the verify gate has
  nothing to run.
- The build spec was reviewed on 2026-08-30; two spec defects were fixed in place
  (`event.sort_key` generated-column rule, RLS coverage of family-owned rows).
- `docs/SPEC.md` §11 now holds only decide-in-issue items (no blockers).
