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

**Issue #3 — GitHub Actions CI pipeline: done, merged to `main` (b18ffa4),
issue closed.** `.github/workflows/ci.yml` — two parallel jobs on `pull_request`
to `main` and `push` to `main`: `verify` (`pnpm install --frozen-lockfile`,
`typecheck`, `lint`, `format:check`, `test`) and `migrations` (Supabase CLI →
`supabase start` → `supabase db lint --fail-on error`). `build` is deliberately
not in CI (SPEC §10 item 3 / WAYFINDER 32 list it out).

**Issue #4 — Migration: enums + core genealogy tables: done, merged to `main`
(e026870), issue closed.** First schema migration
(`supabase/migrations/20260830162505_core_genealogy.sql`): 6 enums (`sex`,
`person_visibility`, `name_type`, `partner_role`, `union_type`,
`child_relation`) and `person`, `person_name`, `family`, `family_child` exactly
per SPEC §4.2. FK on-delete rules and the `family_child` unique
`(family_id, person_id)` verified against a live reset. No RLS (#9) and no
`updated_at` trigger (#7) yet. `person.created_by / updated_by` are plain `uuid`
— the FK to `account` lands in #7 (see the comment on issue #7). Verify gate +
`supabase db lint` green.

**Issue #5 — Migration: `event`, `fact`, `place` + embedded date columns: done,
merged to `main` (3583826), issue closed.** Second schema migration
(`supabase/migrations/20260830164537_events_facts_places.sql`): 8 enums
(`genealogy_date_kind`, `calendar`, `event_owner`, `fact_owner`, `event_type`,
`fact_type`, `fact_visibility`, `geocode_source`), the flat `date_*` column set
per SPEC §4.1 on `event` and `fact`, and `place`. `date_sort_key` is a stored
generated column via one shared immutable `genealogy_date_sort_key(y,m,d)`
function; `event.sort_key` is a plain `timestamptz` set by a `BEFORE INSERT OR
UPDATE` trigger (date + per-`type` ordinal, undated → null). `fact.is_sensitive`
generated. One-owner CHECK on `event`/`fact`. `place.normalized_name` partial
unique. No RLS (#9), no shared `updated_at` trigger (#7). Behavioural tests +
verify gate + `supabase db lint` green. See `DECISIONS.md` for the flat-columns,
trigger-recompute, and `fact_visibility` calls.

**Issue #6 — Migration: `source`, `repository`, `citation`, `media`,
`media_link`, `note`: done, PR open on `feat/migration-sources-media-notes`.**
Third schema migration
(`supabase/migrations/20260830170126_sources_media_notes.sql`): 3 polymorphic
owner enums (`citation_owner`, `media_owner`, `note_owner`) and the tables
`repository`, `source`, `citation`, `media`, `media_link`, `note` per SPEC
§4.3–§4.5. The flat `date_*` set from §4.1 is embedded on `citation` and `media`,
copied verbatim from #5's comment block — `date_sort_key` calls the same shared
`genealogy_date_sort_key()`. `citation.quality` has a 0–3 CHECK.
`media_link.is_primary` is `not null default false` with a partial unique index
enforcing one primary per `(owner_type, owner_id)`. `note.text` is `not null`.
`gedcom_xref` partial unique on `repository`/`source`/`media`/`note`. FK rules:
`citation→source` and `media_link→media` cascade, `source→repository` sets null,
polymorphic `owner_id` columns carry no FK (§4.9). No RLS (#9), no shared
`updated_at` trigger and no `account` FK for `media.uploaded_by` (#7). Verify
gate + `supabase db lint` green; behavioural checks (double-primary,
quality-range, three cascade paths, `note.text` not null) verified locally — see
`DECISIONS.md`. Filename timestamps are UTC (`date -u`) so they sort after #4/#5.

## Next action

Phase 1, issue **#7 — Migration: `account`, `tree_settings`, `audit_log` +
`updated_at` and audit triggers** (`docs/SPEC.md` §4.6, §10 item 7). Already
`ready`. #7 also adds the deferred `account` FK for `created_by` / `updated_by`
on `person`/`event`/`fact` and `uploaded_by` on `media`, plus the shared
`updated_at` bump trigger across the #4–#8 tables (see the comment on issue #7).

Merge #6's PR (`feat/migration-sources-media-notes`) first. #7 and #8 are
`ready`; #9 (RLS + the pgTAP/SQL test harness) unblocks once #4–#8 are all in.

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date       | Session did                                                                          | Result                               |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| 2026-08-30 | Wayfinder planning — all decisions settled                                           | `docs/WAYFINDER.md` (1–33)           |
| 2026-08-30 | Wrote the build spec                                                                 | `docs/SPEC.md`                       |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol                                | `chore/scaffold`                     |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions              | `docs/WAYFINDER.md` (34–35)          |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies  | GitHub issues #1–#46                 |
| 2026-08-30 | Issue #1 — scaffolded the pnpm monorepo; verify gate green                           | `chore/scaffold-monorepo`            |
| 2026-08-30 | Issue #2 — local Supabase dev stack, `pnpm dev` / `dev:status`, `.env.example`       | `chore/local-supabase-dev-stack`     |
| 2026-08-30 | Issue #3 — GitHub Actions CI (`verify` + `migrations` jobs); build kept out of CI    | `chore/ci-pipeline`                  |
| 2026-08-30 | Issue #4 — first migration: 6 enums + `person`/`person_name`/`family`/`family_child` | `feat/migration-core-genealogy`      |
| 2026-08-30 | Issue #5 — migration: `event`/`fact`/`place` + flat `date_*` set + sort-key trigger  | `feat/migration-events-facts-places` |
| 2026-08-30 | Issue #6 — migration: `source`/`repository`/`citation`/`media`/`media_link`/`note`   | `feat/migration-sources-media-notes` |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- #1–#5 are closed and merged to `main`. #6's PR is on
  `feat/migration-sources-media-notes`. Later issues get `ready` as their
  dependencies close — do this when you finish an issue.
- Migrations live in `supabase/migrations/`. `supabase db reset` replays them
  from an empty database; never hand-edit a merged migration, add a new one.
  Filename timestamps must be UTC (`date -u +%Y%m%d%H%M%S`) or a new migration
  can sort before an earlier one and break the replay.
- `person`/`event`/`fact`.`created_by` / `updated_by` and `media.uploaded_by`
  have no FK to `account` yet — issue #7 adds them (a comment on #7 records this).
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
