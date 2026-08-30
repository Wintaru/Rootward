# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 2 — GEDCOM (in progress). Phase 0 complete (#1–#3), Phase 1 complete
(#4–#10 merged). #11 done, PR open.
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
`media_link`, `note`: done, merged to `main` (3705ed4), issue closed.**
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

**Issue #7 — Migration: `account`, `tree_settings`, `audit_log` + `updated_at`
and audit triggers: done, merged to `main` (baee68c), issue closed.**
Fourth schema migration
(`supabase/migrations/20260830171252_accounts_settings_audit.sql`): 4 enums
(`account_role`, `account_status`, `audit_action`, `backup_frequency`), the
`account` table (PK → `auth.users` on delete cascade, `person_id` unique
nullable, defaults `role = viewer` / `status = pending`), the `tree_settings`
singleton (CHECK `id = 1`, all §4.6 defaults, seeded with one row), and
`audit_log` (bigint identity PK). Closes the #4–#6 deferrals: the `account` FK
for `created_by` / `updated_by` on `person`/`event`/`fact` and `uploaded_by` on
`media` (all `on delete set null`). Two shared triggers: `set_updated_at`
(`BEFORE UPDATE`, applied by name to all 15 tables carrying `updated_at`) and
`write_audit_log` (`SECURITY DEFINER`, `search_path = ''`, `AFTER
INSERT/UPDATE/DELETE` on the 14 genealogy tables + `account`; nulls `actor_id`
when no `account` row matches `auth.uid()`). No RLS (#9). Behavioural checks
(singleton reject, one audit row per statement, `updated_at` bump, FK + unique
enforcement, null-actor path) + verify gate + `supabase db lint` green — see
`DECISIONS.md`.

**Issue #8 — Migration: `invitation`, `access_request`, `claim_attempt`,
`notification`, `notification_read`, `import_job`, `export_job`: done, merged to
`main` (e3034c4), issue closed.** Fifth schema migration
(`supabase/migrations/20260830172736_onboarding_and_jobs.sql`): 7 enums
(`invitation_status`, `request_status`, `notification_type`, `import_mode`,
`import_status`, `export_type`, and `export_status` — added because none of the
scoped six fit `export_job.status`), and the seven tables per SPEC §4.7–§4.8.
No `set_updated_at` and no `write_audit_log` trigger on any of them: SPEC §4's
concurrency-token list is the 15 editable tables and excludes these, and they
are high-churn operational rows whose `status` / `resolved_by` / `accepted_by`
columns already record state changes (see `DECISIONS.md`). `invitation.person_id`
is `not null` (cascade on person delete); `account`-referencing FKs all
`on delete set null`, `account_id` / `notification_read` FKs `on delete cascade`.
Moderation-queue + rolling-24h-claim-count + unresolved-notification indexes.
Behavioural checks (every FK rule, composite-PK reject, enum validation, column
defaults) + verify gate + `supabase db lint` green.

**Issue #9 — RLS: helper functions + per-table policies + allow/deny tests:
done, merged to `main` (18621ae), issue closed.** Sixth migration
(`supabase/migrations/20260830174012_rls_policies.sql`): 12 helper functions
(`auth_account`, `is_approved`, `is_moderator`, `is_admin`, `person_is_living`,
`person_is_visible`, `family_is_visible`, `event_is_visible`, `fact_is_visible`,
`citation_is_visible`, `media_link_is_visible`, `note_is_visible` — all
`stable security definer set search_path = ''` so a policy can call them without
recursing into its own table), RLS enabled on all 23 tables, and the full §5
policy set. Genealogy writes are `is_moderator()` (`for all`); `person` DELETE /
`tree_settings` UPDATE / `account` UPDATE / non-`initial` `import_job` DELETE are
`is_admin()`; `access_request` INSERT is own-account-only; `notification` /
`claim_attempt` take no client INSERT. pgTAP harness added:
`supabase/tests/rls_test.sql` (117 allow/deny assertions) and
`supabase/tests/schema_guards_test.sql` (RLS-on-every-table, `set_updated_at` /
`write_audit_log` trigger-set `set_eq` guards, polymorphic-`owner_type`
exhaustiveness guards); `supabase test db` wired into the CI `migrations` job.
Three SPEC §5 deviations, all grounded in WAYFINDER decision 6 and applied to
SPEC in the same PR — see `DECISIONS.md`: `is_moderator`/`is_admin` also require
`status = 'active'`; `is_sensitive` facts hide only while the subject is living;
`media` SELECT = any approved member. Verify gate, `supabase db lint`, and
`supabase test db` (124 tests) green on a clean `supabase db reset`.

**Issue #10 — Generated Supabase types + `lib/db` typed query layer +
`getNeighborhood`: done, merged to `main` (af3eea1), issue closed.** Seventh
migration (`supabase/migrations/20260830191012_get_neighborhood.sql`): the
`get_neighborhood(focus, up, down)` SQL function — one `jsonb` payload with the
focus, ancestors to `up`, descendants to `down`, the focus person's siblings and
partners (decision 28), plus the `family` rows that link them. `SECURITY
INVOKER`, so RLS on person / family / family_child / event decides what the
caller sees; recursion bounded by the `gen` guard (`up` / `down` clamped 0..10),
`union` in both recursive terms so pedigree collapse expands each node once.
`pnpm gen:types` writes `apps/web/lib/db/database.types.ts` (Prettier-ignored,
drift-checked in the CI `migrations` job). Typed layer: `apps/web/lib/db`
(`getNeighborhood` wrapper + boundary parser + `Neighborhood*` types) and
`apps/web/lib/supabase` (browser / server / service-role clients;
`@supabase/ssr`, `@supabase/supabase-js`, `server-only` added). New pgTAP file
`supabase/tests/get_neighborhood_test.sql` (18 assertions: relative set, depth
clamp, per-person generation, family edges, exact jsonb key set, RLS deny).
Verify gate + `supabase db lint` + `supabase test db` (142 tests) + a clean
seven-migration replay all green. Bookkeeping: #9 was already merged (PROGRESS
was stale) — closed it; labelled #11 `ready`. Code review: one correctness fix
applied (`up = 0` no longer orphans siblings) + four should-fixes — see
`DECISIONS.md`.

**Issue #11 — `packages/shared`: `parseGenealogyDate` / `formatGenealogyDate`:
done, PR open on `feat/genealogy-date-module`.** The portable genealogy-date
module (`packages/shared/src/genealogy-date.ts`, SPEC §4.1 / §8.3, WAYFINDER
decision 22). `parseGenealogyDate(raw)` → the flat `date_*` field set (no
`date_sort_key` — generated in Postgres); never throws, unrecognised input →
`date_kind: "phrase"` with the text kept; `date_value_raw` round-trips
byte-for-byte. Handles `abt`/`about`/`cal`/`est`, `bef`/`aft`, `bet … and …`,
`from … to …` (and one-sided `from` / `to`), `int … (…)`, standalone `(phrase)`,
dual dating (`1700/01` → `date_year1 = 1700`, `date_dual_year`, calendar
`julian`), partial dates, GEDCOM 5.5.1 escape (`@#DJULIAN@`) and 7.0 keyword
(`JULIAN 14 FEB 1750`) calendars. Gregorian + Julian fully parsed; Hebrew /
French Republican / Roman kept raw as a `phrase` with the calendar recorded, no
conversion; `BCE` epoch → `phrase`. `formatGenealogyDate(fields)` → display
string ("About 1850", "Between 1850 and 1860", "14 February 1750 (Julian)"), and
the parser also accepts its long-word output so the edit view round-trips.
`GENEALOGY_DATE_KINDS` / `CALENDARS` unions restate the Postgres enums a third
time — coupling flagged in-file, both guarded by compile-time exhaustiveness
checks; a cross-package sync test waits for the edit view (#25). New
`packages/shared/tsconfig.build.json` keeps `*.test.ts` out of `dist/` while
`pnpm typecheck` still checks them. 79 vitest tests (fixture-driven: parse +
format + round-trip per kind). Verify gate green. Code review: one scope fix
(7.0 keyword calendars) + three advisories applied — see `DECISIONS.md`.

## Next action

Phase 2, issue **#12 — `packages/gedcom`: reader (5.5.1 + 7.0)** (`docs/SPEC.md`
§6, §10 item 12). Depends on #11. Merge `feat/genealogy-date-module` first, then
label #12 `ready` and take it. Pure TS, no Deno/Node built-ins (decision 8);
dates parse via `parseGenealogyDate` from `@rootward/shared`.

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date       | Session did                                                                                                                             | Result                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-08-30 | Wayfinder planning — all decisions settled                                                                                              | `docs/WAYFINDER.md` (1–33)              |
| 2026-08-30 | Wrote the build spec                                                                                                                    | `docs/SPEC.md`                          |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol                                                                                   | `chore/scaffold`                        |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions                                                                 | `docs/WAYFINDER.md` (34–35)             |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies                                                     | GitHub issues #1–#46                    |
| 2026-08-30 | Issue #1 — scaffolded the pnpm monorepo; verify gate green                                                                              | `chore/scaffold-monorepo`               |
| 2026-08-30 | Issue #2 — local Supabase dev stack, `pnpm dev` / `dev:status`, `.env.example`                                                          | `chore/local-supabase-dev-stack`        |
| 2026-08-30 | Issue #3 — GitHub Actions CI (`verify` + `migrations` jobs); build kept out of CI                                                       | `chore/ci-pipeline`                     |
| 2026-08-30 | Issue #4 — first migration: 6 enums + `person`/`person_name`/`family`/`family_child`                                                    | `feat/migration-core-genealogy`         |
| 2026-08-30 | Issue #5 — migration: `event`/`fact`/`place` + flat `date_*` set + sort-key trigger                                                     | `feat/migration-events-facts-places`    |
| 2026-08-30 | Issue #6 — migration: `source`/`repository`/`citation`/`media`/`media_link`/`note`                                                      | `feat/migration-sources-media-notes`    |
| 2026-08-30 | Issue #7 — migration: `account`/`tree_settings`/`audit_log` + `updated_at` + audit triggers                                             | `feat/migration-account-settings-audit` |
| 2026-08-30 | Issue #8 — migration: `invitation`/`access_request`/`claim_attempt`/`notification`/`notification_read`/`import_job`/`export_job`        | `feat/migration-onboarding-jobs`        |
| 2026-08-30 | Issue #9 — RLS: 12 `security definer` helpers, policies on all 23 tables, pgTAP allow/deny harness, `supabase test db` in CI            | `feat/rls-policies`                     |
| 2026-08-30 | Issue #10 — `get_neighborhood` SQL function + `pnpm gen:types` + `lib/db` typed layer + `lib/supabase` clients + pgTAP + CI drift check | `feat/db-typed-query-layer`             |
| 2026-08-30 | Issue #11 — `packages/shared` genealogy-date parser + formatter (5.5.1 + 7.0 calendars, dual dating, phrase fallback), 79 vitest tests  | `feat/genealogy-date-module`            |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- #1–#10 are closed and merged to `main`; #11's PR is on
  `feat/genealogy-date-module`. Later issues get `ready` as their dependencies
  close — do this when you finish an issue.
- Phase 1 is complete (#4–#10 merged). Phase 2 (GEDCOM) is in progress: #11 done,
  then #12 (reader) → #13 (writer) → #14/#15 (edge functions) → #16 (import UI).
- The genealogy-date module (#11) lives in `packages/shared`
  (`parseGenealogyDate` / `formatGenealogyDate`, exported from the package root).
  `packages/gedcom` (#12+) parses every `DATE` through it — do not re-implement
  date parsing. `packages/shared/tsconfig.build.json` is the build config that
  excludes `*.test.ts` from `dist/`; `pnpm typecheck` still checks tests via the
  base `tsconfig.json`.
- Migrations live in `supabase/migrations/`. `supabase db reset` replays them
  from an empty database; never hand-edit a merged migration, add a new one.
  Filename timestamps must be UTC (`date -u +%Y%m%d%H%M%S`) or a new migration
  can sort before an earlier one and break the replay.
- `person`/`event`/`fact`.`created_by` / `updated_by` and `media.uploaded_by`
  now have an `on delete set null` FK to `account` — added in #7.
- The shared `set_updated_at` trigger (decision 26 concurrency token) exists as
  of #7 on every #4–#7 table with an `updated_at` column. #8 added no rows to
  this list: none of its seven tables carries `updated_at` (SPEC §4's editable
  list stops at `tree_settings` — the onboarding/job tables run status ladders,
  not the edit-view version check).
- `write_audit_log` (#7) is a `SECURITY DEFINER` trigger on the 14 genealogy
  tables + `account`. #8's onboarding/job tables are deliberately not audited
  (high-churn operational rows; `status` / `resolved_by` / `accepted_by` already
  record state changes) — see `DECISIONS.md`.
- RLS (#9): every table has RLS on and at least one policy. The access boundary
  is the 12 `security definer` helper functions in
  `20260830174012_rls_policies.sql` (`search_path = ''`, so they bypass RLS on
  the tables they read and a policy on `person` can call `person_is_visible`
  without recursing). Add a policy AND an allow/deny pgTAP test for every new
  table in the same PR (`CLAUDE.md`). `person_is_living` is used by exactly one
  MVP policy — the `fact` sensitive-hiding rule. `supabase test db` runs the
  `supabase/tests/` pgTAP suite; `schema_guards_test.sql` will fail CI if a new
  genealogy table skips `set_updated_at` / `write_audit_log` / RLS.
- CI (`.github/workflows/ci.yml`): `verify` job = install + typecheck + lint +
  format:check + test; `migrations` job = `supabase start`, `supabase db lint`,
  `supabase test db` (pgTAP), then a generated-types drift check (regenerate
  `apps/web/lib/db/database.types.ts`, `git diff --exit-code`). No `build` step —
  SPEC §10 item 3 and WAYFINDER 32 list it out; add it later if wanted. Runs on
  PRs to `main` and pushes to `main`.
- The data layer (#10): every Supabase query goes through `apps/web/lib/db` — no
  component builds its own (decision 10). `pnpm gen:types` regenerates the typed
  schema after any migration (run it, commit the result). `apps/web/lib/supabase`
  has three clients: `client` (browser), `server` (RSC / actions / route
  handlers), `service` (service-role, `server-only`, bypasses RLS — for the
  onboarding-match RPC and GEDCOM jobs). `getNeighborhood(client, focusId, up,
down)` calls the `get_neighborhood` SQL function. A returned `family` row may
  name a `partner*_id` not in `persons` (a descendant's spouse) — #24's
  expand-in-place resolves those; it must refuse to resolve a non-visible id
  (see the DECISIONS follow-up note).
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
