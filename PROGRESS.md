# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 5 — Phase 0 (#1–#3), Phase 1 (#4–#10), Phase 2 (#11–#16), Phase 3
(#17, #38, #18, #19, #20), and Phase 4 (#21–#25) all merged, including #24
(merged `767cc3d`, closed by hand this session — same stale-issue pattern as
#17 / #20–#23 / #25 before it). **#26 done, staged on `feat/edit-shell`** — see
below. Next: #27, #28, or #32 (all now `ready`, all depend only on #26).
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
done, merged to `main` (bc21c85), issue closed.** The portable genealogy-date
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

**Issue #12 — `packages/gedcom`: reader (5.5.1 + 7.0): done, merged to `main`
(6a1104f), issue closed.** (PROGRESS was stale — said "PR open"; reconciled
2026-08-30.) The portable GEDCOM reader (`docs/SPEC.md` §6, §10 item
12). Three layers: `nodes.ts` (line grammar — `tokenizeGedcom` +
`buildForest`, `CONC`/`CONT` merged, malformed lines warn not throw), `mapping.ts`
(GEDCOM-tag → Postgres-enum tables per §6), `reader.ts`
(`readGedcom(text): GedcomReadResult` — never throws). Maps `INDI`→person (+
additional names, events, facts, notes, citations, media links), `FAM`→family (+
`family_child`, family events), typed `BIRT/DEAT/MARR/...`→`event`,
`DSCR/OCCU/RELI/...`→`fact`, `SOUR`/`REPO`→source/repository, `OBJE`→media,
shared `NOTE`→note, `PLAC`→deduped places. Cross-record links stay as GEDCOM
xref strings (`@I1@`) — the `gedcom-import` edge function (#14) resolves them to
UUIDs. Every unmapped sub-tag is kept verbatim on the parent's `raw_gedcom`
(`RawGedcomNode[]`, decision 4), including repeated occurrences of a mapped tag
and the children of a mapped tag; the `HEAD` block and `SUBM`/`SUBN` records
land on `result.header` / `result.submitters`. Dates parse through
`parseGenealogyDate` from
`@rootward/shared` — `packages/gedcom` now depends on it (`workspace:*`); the
cross-package import resolves from source for typecheck (`tsconfig.json` `paths`)
and vitest (root `vitest.config.ts` alias), and from `dist/` for `pnpm build`
(`tsconfig.build.json`, topological order). Fixtures are TS string constants in
`src/fixtures.ts` (the lint bans Node built-ins, so tests cannot read `.ged`
files). 29 vitest tests (`nodes.test.ts` 9, `reader.test.ts` 20); verify gate
green. Code review: one class of silent data loss fixed (repeated / child
sub-tags were dropped; `HEAD` / `SUBM` were discarded) — see `DECISIONS.md`,
which also records the deferred enum-parity guard and the resolution-seam and
cross-package-config calls.

**Issue #13 — `packages/gedcom`: writer (5.5.1) + round-trip tests: done,
staged on `feat/gedcom-writer`.** The portable GEDCOM writer (`docs/SPEC.md` §6,
§10 item 13). `writeGedcom(result, options?)` — the inverse of `readGedcom` for
round-trip purposes, not byte-for-byte. Emits every mapped field first, then the
record's stored `raw_gedcom` verbatim, so nothing the reader kept is lost. The
`HEAD` block and `SUBM`/`SUBN` records are re-emitted verbatim from
`result.header` / `result.submitters` (not regenerated — that would fail the
round trip). `DATE` lines re-emit `date_value_raw` (round-trips through
`parseGenealogyDate`; no reverse date formatter). Reverse enum tables
(`EVENT_TAG_FOR`, `FACT_TAG_FOR`, `NAME_TYPE_KEYWORD`, `SEX_KEYWORD`,
`CHILD_RELATION_KEYWORD`) live beside the forward tables in `mapping.ts`, each
`satisfies Record<Enum, …>` so a new enum value fails typecheck.
`GedcomWriteOptions.version` ("5.5.1" | "7.0") overrides only `HEAD.GEDC.VERS`
(deep 5.5.1↔7.0 conversion is out of scope — dates are verbatim). `CONC` splits
a value past 200 chars, `CONT` carries an embedded newline. Known limitation: a
non-pointer value with a leading `@` is emitted unescaped (the reader does not
un-escape either — consistent). 37 vitest tests (`writer.test.ts`): round-trip
structural equality + no-warnings + fixed-point + determinism + no-mutation for
four fixtures, xref preservation, a reverse-enum-table round-trip guard, the
`version` option. Code review fixed two round-trip bugs in the #12 reader —
`SUBM` record xref was dropped (`RawGedcomNode` gained an optional `xref`), and
primary-`NAME` sub-tags leaked into `person.raw_gedcom`
(`ParsedPerson.primary_name_raw_gedcom` added, new `GEDCOM_NAME_SUBTAGS`
fixture). Verify gate green (147 tests total). See `DECISIONS.md`.

**Issue #14 — `gedcom-import` edge function: done, staged on
`feat/gedcom-import`.** The `initial`-mode importer (`docs/SPEC.md` §7, §10 item
14). `supabase/functions/` is now Deno-native — not a pnpm workspace member;
`deno.json` holds the import map + `sloppy-imports` (the portable packages use
extensionless imports) + a pinned `deno.lock`. New parallel `functions` job in
`ci.yml` runs `deno fmt --check` / `lint` / `check` / `test`; Prettier cedes the
tree (`.prettierignore`). The function splits into `importer.ts` (portable
engine, injected `ImportGateway`), `gateway.ts` (service-role supabase-js impl),
`index.ts` (`Deno.serve` shell — moderator-JWT auth, 20s budget, self-reinvoke),
`uuid.ts` (deterministic UUIDv5 via `crypto.subtle`). Resumable by construction:
every row id is `uuidv5(<stable key>, jobId)`, so re-running a batch upserts the
same rows; the only cross-invocation state is `import_job.cursor` (`{ phase,
offset }`). FK-safe phase order places → repositories → sources → shared_notes →
media → persons → families. On finish: `status = completed`, `stats`,
`import_finished` notification. 9 Deno tests (`importer.test.ts` /
`uuid.test.ts`): completion + notify, mid-kill resume with no duplicate rows,
`gedcom_xref` on every record, place dedup, non-initial → failed, empty tree,
the RFC-4122 v5 vector. Row shapes validated against the live schema in a
rollback transaction (every column / enum / CHECK / the `event.sort_key`
trigger). `packages/gedcom` exports `normalizePlaceName` for the importer. Full
pnpm gate green (147). Code review applied: dangling pointers / junk places no
longer fail the whole import (drop the ref or synthesise a stub + warn), shared
`NOTE` inlined per owner, `runImport` failure path hardened, a
`schema_parity.test.ts` enum-drift guard. 11 Deno tests. See `DECISIONS.md`.
One-time for Josh: `brew install deno`.

**Issue #15 — `gedcom-export` edge function: done, staged on
`feat/gedcom-export`.** The `manual_gedcom` exporter (`docs/SPEC.md` §7, §10 item
15). New migration `20260830231234_exports_bucket.sql` creates the private
`exports` storage bucket + an `is_moderator()`-only `storage.objects` policy;
pgTAP `supabase/tests/exports_bucket_test.sql` (6 allow/deny assertions, wired
into `supabase test db`). The function mirrors the #14 engine/shell split:
`exporter.ts` (portable engine, injected `ExportGateway`), `gateway.ts`
(service-role supabase-js, every table read paged past the PostgREST 1000-row
cap), `index.ts` (`Deno.serve` shell — moderator-or-service-role auth). One pass,
no cursor — `export_status` is `pending → running → completed/failed`.
`buildResult` rebuilds a `GedcomReadResult` from the row set: a row keeps its
imported `gedcom_xref`, an app-created row gets a synthesised `@I1@` / `@F1@` /
`@S1@` / `@R1@` / `@O1@` (past every xref already claimed); the synthetic
top-level `NAME` node the importer stashes in `person.raw_gedcom` is pulled back
under the primary `NAME` line; the `HEAD` block is synthesised (5.5.1, `CHAR
UTF-8`); all notes inline (the importer stores none as shared). `writeGedcom`
serialises it. The file lands at `exports/<jobId>.ged`; the caller gets a 1-hour
signed URL and `export_job` records `storage_path` / `size_bytes` /
`completed_at`. 6 Deno tests (`exporter.test.ts`) drive the **real** #14 import
engine: import a fixture → adapt rows → export → re-import, asserting a valid
5.5.1 file with no warnings and unchanged record counts, plus determinism,
synthesised-xref, empty-tree, and wrong-type-fails. Also verified end to end
against the live local stack (real gateway + storage upload + signed URL +
`export_job` ladder) — see `DECISIONS.md`. Full pnpm + Deno gates green;
`supabase db lint` + `supabase test db` (148) green.

**Issue #16 — `/import` UI: done, staged on `feat/import-ui`.** The upload →
progress → result page (`docs/SPEC.md` §8.1, §10 item 16). New migration
`20260830235147_imports_bucket.sql` — the private `imports` bucket + an
`is_moderator()` `storage.objects` policy, same shape as the #15 exports bucket
(#14 assumed it existed); pgTAP `supabase/tests/imports_bucket_test.sql` (6
allow/deny assertions). First frontend route and first `apps/web` test harness:
`apps/web/**/*.{test,spec}.ts` folded into the root `vitest.config.ts` with a
`@/` alias, `vitest` added to `apps/web` devDeps. Layers:
`app/import/page.tsx` (server component — `resolveImportAccess()` in
`lib/auth/require-moderator.ts` does `auth.getUser()` + an `account` role read;
unauthenticated → `redirect("/login")`, non-moderator → `<ImportForbidden />`),
`app/import/ImportWorkspace.tsx` (client, exhaustive switch on the flow state),
`lib/import/useGedcomImport.ts` (the container hook — create job, upload to
`imports/<jobId>.ged`, invoke `gedcom-import` with the moderator JWT, then poll),
`lib/import/orchestrator.ts` (pure reducer + `isStalled()` — no timers, no
client), `lib/db/import-jobs.ts` (typed queries, decision 10). Resume: the hook
re-invokes the function when `processed_records` stalls past `STALL_MS` (30s);
the engine picks up from `import_job.cursor`. 24 vitest tests (reducer, progress,
access predicate, a scripted timeout-then-resume-to-completion run). No auth
scaffolding pulled forward from #17 — no middleware, `/login` still 404s. Full
pnpm + Deno gates green; `supabase db lint` + `supabase test db` (154) green on
the shared local stack (`supabase migration up`, additive). See `DECISIONS.md`.

**Issue #17 — Supabase Auth: done, on `feat/auth-supabase`.** Magic link +
Google sign-in, `/login`, the session proxy, and the `account`-creation trigger
(`docs/SPEC.md` §9.1 / §8.1, §10 item 17). Migration
`20260831110459_auth_account_trigger.sql` adds `on_auth_user_created` — a
`SECURITY DEFINER` `AFTER INSERT` trigger on `auth.users` that mirrors every new
user into `public.account` (`role = viewer`, `status = pending`, `display_name`
from `raw_user_meta_data`). ADMIN_EMAIL promotion is **web-tier, not the
trigger** (a trigger can't read deployment env — see `DECISIONS.md`):
`/auth/callback` runs `maybeBootstrapAdmin`, a service-role UPDATE to
`admin`/`active` when `user.email` matches `process.env.ADMIN_EMAIL`
(`isAdminEmail` pure + unit-tested; the `.env.example` placeholder is ignored).
Frontend: `proxy.ts` (Next 16 rename of `middleware.ts`, `nodejs` runtime) →
`lib/supabase/proxy.ts` `updateSession` refreshes the session with
`getClaims()` and redirects unauth → `/login` for every route but `/login` and
`/auth/*` (decision 35); pure `decideProxyRedirect` / `resolveHomeDestination`
hold the decisions (frontend-arch reducer pattern). `app/login` (server guard →
`LoginForm` client: `signInWithOtp` + `signInWithOAuth('google')`, both through
the PKCE `/auth/callback`), `app/auth/callback/route.ts`,
`app/auth/auth-code-error`, and `app/page.tsx` rewritten to the §8.1 router
(approved → `/tree/<root>`, pending → `/onboarding`, else `/login` — the first
two 404 until #19 / #21, same deliberate pattern as #16's `/login`).
`lib/auth/{admin-email,bootstrap-admin,current-account}.ts`,
`lib/db/tree-settings.ts` (`getDefaultRootPersonId`, decision 10). The 4 pgTAP
suites that seed `auth.users` + `account` now `on conflict (id) do update` (the
trigger creates the account row first). `config.toml`:
`[auth.external.google] enabled = true` (env-substituted secrets,
`skip_nonce_check = true`) + `additional_redirect_urls` → `/auth/callback` —
**needs `supabase stop && supabase start` to take effect; not done this session
(shared stack).** New pgTAP `auth_account_trigger_test.sql` (6 assertions).
Full pnpm + Deno gates green; `supabase db lint` + `supabase test db` (162)
green; migration applied additively (`supabase migration up`). 13 new vitest
tests (184 total).

**Issue #38 — Seed data + demo GEDCOM + `supabase/seed.sql`: done, on
`feat/seed-demo-data`.** Pulled forward from Phase 8 because it blocks #18 / #21
(SPEC §10 item 38, §11). Two independent fictional families (see `DECISIONS.md`):

- **`supabase/seed.sql`** — replaces the placeholder. A confirmed demo admin
  (`admin@rootward.test` / `rootward-admin`, promoted to `admin`/`active` after
  the #17 trigger makes the `account` row), `tree_settings` named with
  `default_root_person_id` → Samuel Ashby, and **the Ashby family**: 28 people
  over 9 generations, 11 families, 47 events (birth/death/marriage, `date_kind`
  spanning `exact`/`about`/`before`/`between`/`from_to`), 3 places, a
  source + repository + citation + note. A first-cousin marriage (family F4) so
  Samuel's line folds back onto Cornelius + Temperance through both parents
  (pedigree collapse for #21). One `moderators_only` and one `hidden` person, a
  living/deceased mix for RLS. Near-collision names (`Catherine`/`Katherine`,
  two `John`s, an unrelated `Ashby` line) as false-positive fodder for #18's
  threshold tuning. All ids in the `d…` range, clear of the pgTAP `a/b/c`
  fixtures.
- **`docs/reference/demo-tree.ged`** — the Marsh family, GEDCOM 5.5.1: 11
  people, 5 families, a repeated ancestor, `SOUR`/`REPO`, an `OBJE` media ref,
  dual dating (`1739/40`), `BEF`/`BET…AND…`/`FROM…TO…`, a `(phrase)` date, a
  `_CUSTOM` tag. Single file, no fixture copy.
- **`supabase/tests/seed_smoke_test.sql`** — 12 pgTAP assertions that the seed
  loaded (row counts, admin is `admin`/`active`, root person resolves, living +
  deceased present, the two collapse lines share the F1 parents). Depends on
  seed having run — CI's `supabase start` seeds before `supabase test db`.
- **`supabase/tests/rls_test.sql`** — added a `truncate … restart identity
cascade` + `tree_settings` re-insert right after `begin;`. That suite asserts
  absolute row counts, and `supabase start` loads `seed.sql` before the tests;
  without the truncate the seed broke ~40 assertions. `rollback` restores the
  seed. Only `rls_test.sql` needed it.
- **`supabase/functions/gedcom-export/exporter.test.ts`** — new case reads
  `demo-tree.ged` and round-trips it through the real #14/#15 engines (11
  persons / 5 families survive, no warnings, `@I1@` still appears once).

Verified: `pnpm typecheck / lint / format:check / build / test` (184) green;
`deno fmt --check / lint / task check / task test` (18) green; `supabase db
lint` + full `supabase test db` (**174**, seed loaded) green; `seed.sql` replays
cleanly (47 events, 28 persons, every FK/enum/trigger). **Not done this session:**
a live `supabase functions serve` import of `demo-tree.ged` — the Deno
`exporter.test.ts` round-trip covers the same engines deterministically; the
live run joins the deferred `/login → /import` integration pass. The shared
local stack was not reset — Josh runs `supabase db reset` when it is free (see
below).

**Issue #18 — `onboarding-match` edge function: done, staged on
`feat/onboarding-match`.** The self-claim flow (`docs/SPEC.md` §7, §9.3, §10
item 18, decision 24). New migration
`20260831154954_onboarding_match.sql`: `pg_trgm` + four trigram GIN indexes on
`person`/`person_name` (given + surname) + `onboarding_match_search(given,
surname, year, month?, threshold?)` — a `security definer`, `search_path = ''`
SQL function returning only `person_id` + `score`. Fuzzy name over the primary
name **and** every `person_name` variant, birth year exact, month ±1, combined
score (mean of given + surname similarity) ≥ `0.3` (`pg_trgm` default; tuned
against the seed — see `DECISIONS.md`). `revoke ... from anon` is explicit
(Supabase default-privileges grant EXECUTE straight to `anon`). The function is
Deno-native, same engine/gateway/shell split as #14/#15:
`matcher.ts` (portable engine — `runSearch` / `runVerify`, pure
`selectChallenges` / answer checks), `gateway.ts` (service-role reads +
`claim_attempt` / `account` / `notification` / `access_request` writes),
`index.ts` (`Deno.serve` — any signed-in caller, the account is still
`pending`; discriminated `{ action: "search" | "verify" }` body). `search` →
`{ candidates: [{ personId, challenges }] }` — challenges are the answerable
subset of `spouse_first_name` / `parent_first_name` / `birth_place` /
`birth_day`, priority order, capped at 2 (WAYFINDER 24); already-claimed and
no-answerable-fact candidates dropped; nothing identifying returned. `verify` →
`{ status }` — `linked` (one posed challenge correct → `account.person_id` +
`status = 'active'`, `claim_attempt(true)`, `self_claim_linked` notification),
`no_match`, `already_claimed`, `already_linked` (no attempt row), `rate_limited`
(6th verify / 24h → `access_request` + `claim_attempt_cap` notification, deduped;
no attempt row — the refusal must not roll the window). Every other verify
outcome writes exactly one `claim_attempt`. `deno.json` + `ci.yml` gained
`onboarding-match/`. New `supabase/tests/onboarding_match_test.sql` (13 pgTAP:
shape, `security definer`, grants, fuzzy match, year/month filter, `person_name`
variant, threshold). New `schema_parity.test.ts` (notification-type + enum-literal
drift guard). 18 engine tests. Full pnpm gate (184) + deno gate (36) + `supabase
db lint` + `supabase test db` (**187**) green. **Not done:** a live `supabase
functions serve` run — joins the deferred integration pass. Migration applied
with `supabase migration up`; `seed.sql` loaded by hand to tune (shared stack
not reset).

**Issue #19 — `/onboarding` UI: done, staged on `feat/onboarding-ui`.** The
self-claim + request-access flow (`docs/SPEC.md` §8.1 / §9.3, §10 item 19).
New migration `20260831162624_access_request_notify.sql`: `notify_access_requested`,
a `security definer` `search_path = ''` `AFTER INSERT` trigger on `access_request`
that raises one `access_requested` notification per account (deduped against an
open one — SPEC §5, a client cannot INSERT `notification`). It fires for the #18
attempt-cap path too; that path's own `claim_attempt_cap` notification and this
`access_requested` row coexist by design. Frontend (mirrors #16's server-guard →
client-workspace → pure-reducer → hook → `lib/db` shape):
`app/onboarding/page.tsx` (server — `getCurrentAccount()` + `resolveOnboardingStage`
in `lib/auth/access.ts`; no session → `/login`, `active` → `/`, `suspended` →
`<OnboardingSuspended />`, else the workspace + `getAllowSelfSignup`),
`app/onboarding/OnboardingWorkspace.tsx` (client, exhaustive switch),
`lib/onboarding/orchestrator.ts` (pure state machine — `identify → searching →
challenge → verifying → linked | no_match | request_access → requesting →
requested`; `resolveVerify` folds `already_claimed` / `unknown` to `no_match`,
`rate_limited` is terminal), `lib/onboarding/useOnboarding.ts` (container hook —
the `onboarding-match` calls + `access_request` insert + `router.replace("/")`
on link), `lib/db/onboarding.ts` (`searchOnboardingMatch` / `verifyOnboardingMatch`
/ `submitAccessRequest` + `challengeLabel` fallback map). Challenges the top
candidate only (see `DECISIONS.md` — the multi-candidate collision routes to a
moderator). New tests: `supabase/tests/access_request_notify_test.sql` (9 pgTAP:
security-definer, trigger wired, payload, dedup, per-account independence),
`apps/web/lib/onboarding/orchestrator.test.ts` (21), `lib/db/onboarding-parity.test.ts`
(2 — reads `matcher.ts`, guards the challenge-key + verify-status copies),
`lib/auth/access.test.ts` (+5). `rls_test.sql` fixture reordered (pre-seed the
notification before the `access_request` insert so the trigger dedups). Full pnpm
gate (212) + deno gate (38) + `supabase db lint` + `supabase test db` (**196**)
green. Code review: 4 fixes applied (birth-year range check, forms stay mounted
while submitting, `restart` from the request form, dropped unused `isTerminal`) —
see `DECISIONS.md`. **Not done:** the live `supabase functions serve` +
signed-in-browser integration pass (still deferred, now covers `/onboarding` too).

**Issue #20 — Invite flow + `/moderation` stub: done, staged on
`feat/invite-flow`.** The invite path (`docs/SPEC.md` §9.2 / §8.1, §10 item 20,
decision 12). **No migration** — the `invitation` table, its RLS (moderator
SELECT, admin-only non-`viewer` role INSERT), and the enums all exist from #8 /
#9, and #9's `rls_test.sql` already covers them. All new logic is web-tier.

- **`app/moderation/`** — the moderator+ route stub. `resolveModerationAccess`
  in `lib/auth/require-moderator.ts` shares `loadSessionAccount` with
  `resolveImportAccess` and returns `isAdmin` to gate the role selector.
  `page.tsx` (server) renders `InviteToClaimForm` (client, discriminated submit
  state), `PendingInvitations` (server list), and `ModerationForbidden`. The
  full queue is issue #36. Until the person page (#25) exists the form takes a
  person UUID, prefilled from `?personId=`.
- **`app/moderation/actions.ts`** — the `inviteToClaim` server action (first
  server action in the app): re-checks moderator access, `validateInviteInput`
  (pure, `lib/moderation/invite.ts`), `personExists`, writes the `invitation`
  row **first** (as the moderator, so `invitation_insert` RLS re-checks the
  admin-only role rule), then `auth.admin.inviteUserByEmail` (service role); a
  send failure rolls the row back. `callbackUrl()` prefers `NEXT_PUBLIC_SITE_URL`.
- **`lib/auth/accept-invitation.ts`** and **`invitation-decision.ts`** —
  `maybeAcceptInvitation` runs in `/auth/callback` after `maybeBootstrapAdmin`
  in its own try/catch (non-fatal — a failure never blocks sign-in). It links a
  still-`pending`, unlinked account to the invitation's `person_id` / `role` and
  sets `status = active`. The `UPDATE` is guarded on `status = 'pending'` and a
  null `person_id`, so a concurrent self-claim or a `23505` unique violation
  returns `conflict` — never an overwrite. It then marks the invitation
  `accepted` and expires siblings. The pure decision is split out and
  unit-tested, mirroring `admin-email.ts` / `bootstrap-admin.ts`.
- **`lib/db/invitations.ts`** — the typed layer: `listPendingInvitations` (with
  an embedded person-name select), `findPendingInvitationByEmail`,
  `createInvitation`, `deletePendingInvitation`, `markInvitationAccepted`,
  `personExists`. Email match is `.eq` on a lower-cased address, never `ilike`.
- **`lib/db/types.ts`** — `AccountRole` / `AccountStatus` moved here (canonical,
  beside the other enum aliases); `lib/auth/access.ts` re-exports them.
- Tests: `lib/moderation/invite.test.ts` (6 — normalisation, role escalation),
  `lib/auth/invitation-decision.test.ts` (5 — link vs. skip). Full pnpm gate
  (**223**) + deno gate (38) + `pnpm build` green. Code review: 1 must-fix
  (`ilike` wildcard email match) + 4 should-fix (stuck form, insert-before-send,
  non-fatal callback, `status = 'pending'` in the link filter) applied — see
  `DECISIONS.md`.
- **Not done:** an integration test for `maybeAcceptInvitation`'s IO paths (the
  `conflict` / `23505` branches) and the live `supabase functions serve` +
  browser pass — both join the deferred integration pass below.

**Issue #21 — `family-chart` integration + custom PersonCard: done, staged on
`feat/tree-family-chart`.** The hourglass tree view (`docs/SPEC.md` §8.2, §10
item 21, WAYFINDER decisions 23 / 28). No migration — read-only over
`get_neighborhood` (#10). New dependency `family-chart@0.9.0` (`apps/web`).

- **`app/tree/[personId]/page.tsx`** — server component. `getCurrentAccount()`
  - `isApproved()` (new pure predicate in `lib/auth/access.ts`, any `active`
    account): no session → `/login`, not approved → `/onboarding`. A non-UUID
    `personId` or an empty `get_neighborhood` payload → `notFound()` (never leak
    "hidden" vs. "absent"). One `getNeighborhood` fetch at the `DEFAULT_GENERATIONS_*`
    constants.
- **`lib/tree/to-family-chart.ts`** — pure `toFamilyChartData(neighborhood)` →
  `{ data, mainId }`. Walks the `family` edges once into per-person
  parent/spouse/child sets (only people in the payload — bounds the chart to the
  visible neighbourhood). De-dups ids and rel arrays; never makes a person their
  own parent. `sex` `male` → `gender: "M"`, everything else → `"F"` for
  `family-chart` layout, with the real value kept on `sex` for the tint.
- **`lib/tree/person-card.ts`** — pure `personCardHtml(person, duplicateCount?)`
  → an escaped HTML string (`family-chart` injects a string, not a component).
  Silhouette or `<img>`, name (given+surname → nickname → "Unknown"), lifespan
  (`1806–1874` / `b. 1958` / `d. 1874`), `×N` badge for a repeated ancestor.
  Gender tint and focus ring are CSS on `family-chart`'s own `card-*` classes.
- **`components/tree/FamilyTree.tsx`** — `"use client"` shell: a ref + one
  effect that builds the chart (`createChart` → `setCardHtml` +
  `setCardInnerHtmlCreator`, vertical, `setSingleParentEmptyCard(false)` — a
  missing partner is "outside the window", not "unknown"), then clears the
  container on cleanup. `setDuplicateBranchToggle` is **not** used (it throws on
  a fully custom card — see `DECISIONS.md`). `cardDataOf` reads the node
  defensively so a library-synthesised node can never blank the render.
- **`components/tree/family-tree.css`** — dark canvas, blue/orange card tint,
  focus ring (`.card-main .rw-card`), duplicate badge. Imported with
  `family-chart/styles/family-chart.css`.
- Tests: `to-family-chart.test.ts` (9 — links, out-of-window drop, sex map,
  pedigree-collapse diamond, self-loop, multi-family child), `person-card.test.ts`
  (15 — name/lifespan/escaping/badge/silhouette), `access.test.ts` (+5 for
  `isApproved`). Full pnpm gate (**252**) + `pnpm build` green. Deno gate not
  run (no `supabase/functions/` change). Code review: no must-fix; applied
  `isUuid` extraction (`lib/db/uuid.ts`, rule of three — `getNeighborhood`,
  `invite.ts`, this route), aligned the `cardDataOf` gender fallback, added a
  teardown comment.
- **Verified in a browser** against the live seed (`get_neighborhood(Samuel, 3,
2)` via a scratch HTML harness reproducing the exact `createChart` calls):
  hourglass centres on Samuel, blue/orange tint, focus ring, Cornelius +
  Temperance drawn once per path with a `×2` badge (pedigree collapse, no crash),
  Samuel's spouse Katherine renders. Screenshot matched reference screenshot 2.
- **Not done (deferred to #23):** the `tree_settings` depth read, click →
  `router.push` re-centre, URL-as-focus history, in-session depth override. Card
  clicks keep `family-chart`'s built-in in-window re-centre.

**Issue #22 — Generation bands overlay: done, staged on
`feat/tree-generation-bands`.** The band layer behind the hourglass chart
(`docs/SPEC.md` §8.2, §10 item 22). No migration — pure client work over the
#21 render.

- **`apps/web/lib/tree/generation-bands.ts`** — pure. `computeGenerationBands`
  clusters the laid-out `family-chart` node `y` values (card _centres_ —
  `translate(-50%, -50%)`) into generation rows within a 1px tolerance, indexes
  each row against the focus row (`focusRowIndex - rowIndex`: up positive =
  ancestors, down negative), and returns `{ generation, label, yearRange, top,
bottom }` per band. Labels are `Root Generation` / `Generation N` /
  `Generation −N` (U+2212); year range is the birth-year span of the row
  (U+2013 en dash). Bands tile — adjacent edges are the midpoint of the two card
  centres, outer edges half a row gap past the card. `readLaidOutTree` is the
  defensive parse of `chart.store.getTree().data` (extracted from `FamilyTree`
  on review): non-array / `exiting` / non-numeric-`y` nodes dropped.
- **`apps/web/components/tree/generation-bands-overlay.ts`** — imperative. Owns
  an SVG `<g class="rw-gen-bands">` inserted as the **first child** of
  `family-chart`'s `svg .view` (the zoom-transformed group) so it paints behind
  the links/cards and tracks pan/zoom with no sync code. One `<g>` per band,
  `transform: translate(0, top)` + a full-bleed `<rect>` + label/range `<text>`.
  CSS transitions on the `<g>` transform and rect height (duration set inline =
  `transition_time`) carry the bands alongside the card animation on a
  re-centre. `pointer-events: none`; the HTML cards sit in the separate
  `#htmlSvg` layer above, so clicks are unaffected.
- **`apps/web/components/tree/FamilyTree.tsx`** — `chart.setAfterUpdate(...)`
  (set before the first `updateTree`) recomputes + repaints the bands every
  layout. `CARD_WIDTH` / `CARD_HEIGHT` / `CARD_*_SPACING` are now shared
  constants feeding both `setCardDim` / `setCard*Spacing` and the band geometry.
- **`family-tree.css`** — `.rw-gen-band__fill` (3% white, 7% on `--alt`, parity
  keyed on the generation so a row keeps its shade across a re-centre), label
  (13px/700) and range (11px) text, right-aligned in the left gutter.
- Tests: `generation-bands.test.ts` (15 vitest — row indexing, minus/en-dash
  glyphs, tiling geometry, year ranges, spouse-cluster tolerance, and
  `readLaidOutTree` shape guards). No jsdom render project (same defer as #21).
- **Browser-verified** against the seed via a scratch harness reproducing the
  exact `createChart` calls: six bands `Generation 3` … `Generation −2` centred
  on the Ashby rows, correct per-row birth-year ranges, the pedigree-collapse
  row (Cornelius + Temperance ×2) folded into one band, and a click re-centre
  re-indexed and re-aligned every band. Full pnpm gate (**267**) + `pnpm build`
  green. Deno gate not run (no `supabase/functions/` change).

**Issue #23 — `getNeighborhood` wiring + re-center + deep links: done, staged on
`feat/tree-recenter-deeplinks`.** Click-to-re-centre and URL-as-focus for the
tree view (`docs/SPEC.md` §8.2 / §8.1, §10 item 23, WAYFINDER decision 28). No
migration — SQL untouched.

- **`apps/web/lib/tree/tree-view-params.ts`** (new, pure) — `resolveTreeDepth`
  reads `?up` / `?down` off the route (falls back to the `tree_settings`
  defaults, clamps `0..MAX_GENERATIONS`); `treeHref` builds `/tree/<id>` and
  adds `up` / `down` only when they differ from the default, so the common URL
  stays bare. Re-exports `clampGenerations` / `MAX_GENERATIONS` /
  `MIN_GENERATIONS`.
- **`apps/web/lib/db/neighborhood.ts`** — the old private `clampDepth` is now the
  exported `clampGenerations` (one clamp for the fetch depth, the settings
  defaults, and the stepper) and `MAX_GENERATIONS = 10` is a named constant
  mirroring the `get_neighborhood` `least(…, 10)`.
- **`apps/web/lib/db/tree-settings.ts`** — `getDefaultGenerations(client)` reads
  `default_generations_up` / `_down` from the singleton, clamped, column
  defaults as the fallback.
- **`apps/web/app/tree/[personId]/page.tsx`** — reads `searchParams`, fetches
  the depth defaults in parallel with the auth check, resolves the requested
  depth, one `getNeighborhood` at that depth. Passes `depth` + `depthDefaults`
  to `FamilyTree`.
- **`apps/web/components/tree/FamilyTree.tsx`** — the chart is now **built once**
  and kept mounted across navigations (React reconciles it — the segment and
  component position do not change), so each new server-fetched `tree` prop is
  fed to the live chart with `updateData` / `updateMainId` / `updateTree` and
  `family-chart` animates the diff. `setOnCardClick` → `router.push(treeHref(…))`
  (was the library's in-window re-centre). A depth-stepper overlay
  (`TreeDepthControls`) does `router.replace` per step so a depth tweak does not
  pile up in the focus back-history. `useTransition` drives a pending dim
  (`[data-navigating]` on the viewport wrapper).
- **`family-tree.css`** — `.rw-tree-viewport` wrapper (React-owned, survives a
  chart rebuild), the depth control, the navigating dim.
- Tests: `tree-view-params.test.ts` (10 — depth parse / clamp / href),
  `tree-depth-parity.test.ts` (3 — greps the two migrations, asserts the `10`
  and the `2`s match the TS constants, same pattern as `onboarding-parity`). No
  jsdom render project (same defer as #21 / #22).
- Full pnpm gate (**280**) + `pnpm build` green. Deno gate not run (no
  `supabase/functions/` change); no `supabase db lint` / `test db` (no SQL).
- Code review: no must-fix. Applied — parallelised the settings read with auth,
  added the migration parity guard, narrowed the client imports off the
  `@/lib/db` barrel, made the first-sync skip StrictMode-safe. Deferred (see
  `DECISIONS.md`): caching the invariant `tree_settings` read (revisit with
  #37's settings-edit revalidation); the optimistic pre-fetch re-centre.
- **Not done:** the live signed-in browser pass driving a real re-centre +
  back-button + depth override. Joins the deferred `/login → … → /tree`
  integration pass — the web app is down and `/tree` needs an approved session.

**Issue #25 — `/person/[personId]` read-only profile: done, staged on
`feat/person-profile`.** The read-only profile (`docs/SPEC.md` §8.1, §10 item
25). No migration — RLS from #9 is the whole boundary; the route reads under
the caller's identity and a non-visible or absent person both come back `null`
→ `notFound()` (never leak which).

- **`apps/web/lib/db/person.ts`** — `getPersonProfile(client, id)`. Six
  parallel queries (`person`, `person_name`, `event`, `fact`, `media_link` →
  `media`, `citation` → `source` → `repository`, `note` — all explicit column
  lists, each polymorphic table filtered on `owner_type = 'person'` since it
  carries no FK to `person`, SPEC §4.9) plus one `getNeighborhood(id, 1, 1)` for
  the relationship strip (parents/siblings/partners/children — exactly
  WAYFINDER decision 28's relative set, reused rather than re-queried). Every
  ordered query pins its order explicitly (`sort_key`/`id`/`sort_order`) so
  display order is deterministic, not incidental row order. Every sibling
  query's error is checked before the "person not found" branch, so a real
  query failure on `event`/`fact`/etc. is never swallowed into a false 404.
- **`apps/web/lib/db/genealogy-date.ts`** — bridges a row's flat `date_*`
  columns to `@rootward/shared`'s `GenealogyDateFields` / `formatGenealogyDate`.
  First `apps/web` consumer of the shared package: added as a real dependency
  (`workspace:*`), a `tsconfig.json` `paths` entry resolving it from
  `packages/shared/src` (the package ships no build output in CI), and
  `next.config.ts` `transpilePackages` so `next build` compiles it the same way.
  New `genealogy-date-parity.test.ts` asserts `GENEALOGY_DATE_KINDS` / `CALENDARS`
  match the generated schema `Constants` — closes #11's deferred cross-package
  sync guard.
- **`apps/web/lib/person/view-model.ts`** — pure `buildPersonProfileView` (the
  container/presentational split via a pure builder, same pattern as
  `to-family-chart.ts` / `generation-bands.ts`): assembles display names, sorts
  the timeline by `sort_key` (undated last, stable), labels facts and flags a
  restricted/sensitive one, and `resolveRelationships` splits the one-generation
  `Neighborhood` into parents/siblings/partners/children (sorted by birth year).
  The timeline is person-owned events only — a family's union events (marriage,
  divorce) surface as the union-type label next to each partner instead; see
  `DECISIONS.md` for why merging them in was deferred.
- **`apps/web/lib/person/labels.ts`** — enum → display label: a
  humanise-by-rule function (`bar_mitzvah` → "Bar mitzvah") plus a short
  override table for acronyms/proper nouns (`ssn`, `national_id`,
  `bar_mitzvah`/`bat_mitzvah`), not a full hand-maintained 46-entry map that can
  drift from the enum.
- **`app/person/[personId]/page.tsx`** + **`components/person/PersonProfile.tsx`**
  — server-guard route (same `isApproved` gate as `/tree`) → pure view-model →
  presentational component. "Edit" link shown to moderator+ only (that route
  404s until Phase 5).
- Tests: `labels.test.ts` (10), `view-model.test.ts` (9, covering name
  assembly, timeline ordering, fact restriction badges, relationship-group
  splitting, media/source/note mapping), `genealogy-date-parity.test.ts` (2).
  Full pnpm gate (**301**) + `pnpm build` green. Deno gate green (untouched,
  part of the standing verify command). No `supabase db lint` / `test db` (no
  SQL). Code review: 2 should-fix applied (missing `.order()` on
  `event`/`fact`/`citation` made timeline order non-deterministic; error checks
  moved ahead of the not-found branch so a real failure can't read as 404) + 3
  advisories applied (trimmed unused `*Row`/enum-alias exports added ahead of
  need, a comment on the same-partner-twice simplification).
- **Not done:** the live signed-in browser pass (joins the same deferred
  integration pass as #21–#23 — the web app is down).

**Issue #24 — Expand-in-place for collapsed branches: done, staged on
`feat/tree-expand-in-place`.** The last Phase 4 issue (`docs/SPEC.md` §8.2,
§10 item 24, WAYFINDER decision 28). Eighth schema migration
(`supabase/migrations/20260831201221_expand_relatives.sql`):
`create or replace function public.get_neighborhood(...)` (same recursion as
#10, additive) now reports two more per-person booleans, `can_expand_up` /
`can_expand_down` — true only for a person at the exact ancestor/descendant
frontier generation (`gen = up` / `gen = -down`) with a recorded relative the
window did not fetch, via new `ancestor_frontier` / `descendant_frontier`
CTEs; guarded on `bp.gen` matching the frontier generation too, not just
frontier-CTE reachability, so a pedigree-collapse person `base_persons` chose
to display at a nearer tier never shows a spurious affordance. A new
`expand_relatives(person, relation)` function (`'parents' | 'children' |
'self'`) is the scoped one-branch fetch behind the affordance: `'parents'`
returns the family a person is a child in plus its partners with `child_ids`
narrowed to just that person (no sibling leak); `'children'` returns every
family a person partners in plus every child, unfiltered (wider than
`get_neighborhood`'s window-scoped set, by design); `'self'` resolves one
off-window partner id a family already named (§8.4's documented case) with no
relations. Both functions `security invoker`. New pgTAP
`supabase/tests/expand_relatives_test.sql` (18 assertions: all three
relations, `child_ids` scoping, the continue-same-direction-only rule on the
returned persons' own flags, RLS deny) + `get_neighborhood_test.sql` additions
(5 assertions + a widened key-set check, new great-grandparent fixture to
exercise a genuine `can_expand_up = true`).

Frontend: `apps/web/lib/db/neighborhood.ts` gained `expandRelatives()` (typed
RPC wrapper); `NeighborhoodPerson` gained `can_expand_up` / `can_expand_down`;
new `NeighborhoodFragment` / `ExpandRelation` types. New pure module
`apps/web/lib/tree/expand-tree.ts`: `expandedGeneration` (parents → `+1`,
children → `-1`, self → same tier, relative to the person the click started
from), `mergeNeighborhoodFragment` (dedup-by-id merge into the current
`Neighborhood`; widens an already-known family's `child_ids` rather than
duplicating it — `expand_relatives("children")` can return a fuller set than
`get_neighborhood` already returned for that family), `findUnresolvedPartners`
(family edges already in view whose other partner never got fetched — one per
known partner; a second marriage's second off-window spouse is left for the
post-MVP extended-family pass, same v1-scope call as the rest of this issue).
`to-family-chart.ts` / `person-card.ts` thread the three signals through to
three `<button data-expand-target=… data-expand-anchor=… data-expand-relation=…>`
affordances on the card (▲ / ▼ / +).

`FamilyTree.tsx` is the biggest behavioural change: it now receives the raw
`Neighborhood` (not a pre-converted `FamilyChartTree` — `page.tsx` no longer
calls `toFamilyChartData` server-side) and holds local state that starts from
the prop and gets merged into on an expand click; `toFamilyChartData` now runs
client-side via `useMemo`. A capture-phase click listener on the chart
container (`AbortController`-scoped, so a StrictMode remount can't double-bind
it) intercepts an expand-button click before `family-chart`'s own card-click
handler — bound in the bubble phase on the card element itself — can treat it
as a re-centre. The prop-change reset uses React's documented render-time
"adjusting state when a prop changes" pattern, not a `useEffect` (the
`react-hooks/set-state-in-effect` and, for a ref version of the same idea,
`react-hooks/refs` lint rules both reject the effect forms). A
`navigationTokenRef`, bumped in a `useEffect` keyed on the neighbourhood prop,
guards the one real race in this design: an in-flight `expandRelatives` fetch
that resolves _after_ a navigation or depth change has already reset the
local state would otherwise graft its fragment onto a neighbourhood it no
longer belongs to; the token makes that merge a no-op instead. (`family-chart`
sets its own cards' `pointer-events: auto` inline, which wins over the
existing dim-while-busy CSS rule, so clicks reach the chart throughout a
pending fetch regardless — the token is what actually keeps the merge
correct, disabling the depth stepper during an expand is only a courtesy on
top of it.)

Tests: `expand-tree.test.ts` (11), `to-family-chart.test.ts` (+5, the
`canExpandUp`/`canExpandDown`/`hiddenPartnerId` passthrough),
`person-card.test.ts` (+6, the three affordance buttons + id escaping).
`view-model.test.ts`'s fixtures gained the two new required
`NeighborhoodPerson` fields (unrelated to this issue — the type is shared).
Full pnpm gate (**320**) + `pnpm build` green. Deno gate green (untouched). `supabase
db lint` + `supabase test db` (**219**) green. Code review: 1 must-fix applied
(the navigation-token race above) + 2 should-fix applied (the SQL
pedigree-collapse false positive above; `ExpandRelation` was re-declared by
hand in three places with nothing tying them together — `person-card.ts` now
imports the shared type, and `FamilyTree.tsx`'s relation-set check is a
`satisfies Record<ExpandRelation, true>` object so a new relation added to the
type fails to compile there until acknowledged). See `DECISIONS.md`.

**Issue #26 — Edit shell: full-screen layout, section nav, relatives strip,
Done: done, staged on `feat/edit-shell`.** The first Phase 5 issue
(`docs/SPEC.md` §8.3, §10 item 26, WAYFINDER decisions 10 / 21 / 26). Shell
only — the eight sections themselves (Name & Gender, Additional Names,
Events, Facts, Media, Sources, Notes, Reference Numbers) are #27–#32 and
render a "not built yet" placeholder here. No migration — RLS from #9 is the
whole boundary, same never-leak-hidden-vs-absent contract as #25.

- **`apps/web/lib/person/relatives.ts`** (new) — `assembleName` /
  `personName` / `formatLifespan` / `resolveRelationships` pulled out of
  `lib/person/view-model.ts` (behavior-preserving move, confirmed by the
  unchanged `view-model.test.ts` still passing) so the edit shell's relatives
  strip reuses the exact same family-walk logic as the read-only profile
  instead of a second copy that can drift from it.
- **`apps/web/lib/db/person.ts`** — `PERSON_CORE_COLUMNS` + `mapPersonCore`
  extracted (previously inlined only in `getPersonProfile`) and reused by a
  new lean `getPersonEditShell(client, personId)`: just the person core row
  plus one `getNeighborhood(id, 1, 1)`, sequential so a 404 never pays for the
  neighbourhood query — deliberately not `getPersonProfile`'s full fan-out
  (events/facts/media/citations/notes), since the shell doesn't render any of
  that yet (fetch only what you need).
- **`apps/web/lib/edit/sections.ts`** (new, pure) — the eight-section
  registry, `resolveEditSection` (`?section=` → slug, unknown/missing →
  `name-gender`), `editSectionHref` (bare URL for the default section,
  `?section=` otherwise — mirrors `lib/tree/tree-view-params.ts`'s
  `treeHref` convention).
- **`apps/web/lib/edit/view-model.ts`** (new, pure) — `buildEditShellView`
  builds the header (name + sex/lifespan subtitle), the section nav list with
  an active flag, and the two relative strips: parents on top, partners then
  children combined on the bottom (no siblings row — SPEC §8.3 only lists
  parents and partners+children, unlike the profile page's four-way split).
- **`apps/web/app/person/[personId]/edit/page.tsx`** + **`EditForbidden.tsx`**
  — server-guard route: unauthenticated → `/login`, not approved →
  `/onboarding`, approved-but-not-moderator → `EditForbidden` (mirrors
  `ModerationForbidden` / `ImportForbidden`), absent/hidden person →
  `notFound()`. `isActiveModerator` already documented itself as gating "the
  edit view" (`lib/auth/access.ts`) — no new access resolver needed.
- **`apps/web/components/person/EditShell.tsx`** (new) — presentational,
  plain server component (no `"use client"`, no hooks): header + parents
  strip, left nav + active-section placeholder, footer partners/children
  strip. Section switching and relative navigation are plain `<Link>`s (the
  URL is the state, same convention as the tree view's `?up`/`?down`) — no
  client-side machinery built ahead of the sections that will actually need
  it.
- Tests: `lib/edit/sections.test.ts` (9), `lib/edit/view-model.test.ts` (8).
  Full pnpm gate (**337**) + `pnpm build` green. Deno gate green (untouched —
  no `supabase/functions/` change). No `supabase db lint` / `test db` (no
  SQL). Code review: 1 should-fix applied (a doc comment on
  `/person/[personId]/page.tsx` claiming `/edit` "404s until Phase 5" was now
  false — this PR ships that route).
- **Not done:** the live signed-in browser pass (joins the same deferred
  integration pass as #21–#25 — the web app is down).

## Next action

**Phase 5 is under way.** #27 (Sections: Name & Gender, Additional Names,
Reference Numbers), #28 (DateInput component + Events section), and #32
(Presence indicators on the edit view) are all `ready` — each depends only on
#26. `docs/SPEC.md` §8.3 / WAYFINDER decision 22 is the `DateInput` contract
#28 needs; decision 26 is the version-check + `ConflictDialog` contract #31
needs once #27 lands.

Nothing depends on #26 being merged specifically — the three issues above were
labelled `ready` this session on the strength of #26 being done, ahead of the
merge itself (same bookkeeping-ahead-of-merge pattern as prior sessions).

Still pending across #14–#26: a deployed-function run (`supabase functions
serve`) plus a real signed-in browser session driving `/login` → `/import` →
`/onboarding` → `/moderation` → `/tree/<root>` → `/person/<id>` →
`/person/<id>/edit` end to end. Do this as a dedicated integration pass, and
restart the local stack first so the `config.toml` Google + redirect-URL
change loads.

**Shared local stack:** migrations through `20260831201221` (this session's
`expand_relatives`) were applied additively with `supabase migration up`, and
the `get_neighborhood` fix from code review was re-applied directly (a
`create or replace`, not a new migration file, so no separate `migration up`
step exists for it — the file on disk and the live function already match).
`supabase db reset` is safe (all Phase 3/4 branches merged or, for #24,
additive-safe). #21–#25 add no other migration.

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date       | Session did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Result                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-08-30 | Wayfinder planning — all decisions settled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `docs/WAYFINDER.md` (1–33)              |
| 2026-08-30 | Wrote the build spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `docs/SPEC.md`                          |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `chore/scaffold`                        |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docs/WAYFINDER.md` (34–35)             |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | GitHub issues #1–#46                    |
| 2026-08-30 | Issue #1 — scaffolded the pnpm monorepo; verify gate green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `chore/scaffold-monorepo`               |
| 2026-08-30 | Issue #2 — local Supabase dev stack, `pnpm dev` / `dev:status`, `.env.example`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `chore/local-supabase-dev-stack`        |
| 2026-08-30 | Issue #3 — GitHub Actions CI (`verify` + `migrations` jobs); build kept out of CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `chore/ci-pipeline`                     |
| 2026-08-30 | Issue #4 — first migration: 6 enums + `person`/`person_name`/`family`/`family_child`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `feat/migration-core-genealogy`         |
| 2026-08-30 | Issue #5 — migration: `event`/`fact`/`place` + flat `date_*` set + sort-key trigger                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `feat/migration-events-facts-places`    |
| 2026-08-30 | Issue #6 — migration: `source`/`repository`/`citation`/`media`/`media_link`/`note`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `feat/migration-sources-media-notes`    |
| 2026-08-30 | Issue #7 — migration: `account`/`tree_settings`/`audit_log` + `updated_at` + audit triggers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `feat/migration-account-settings-audit` |
| 2026-08-30 | Issue #8 — migration: `invitation`/`access_request`/`claim_attempt`/`notification`/`notification_read`/`import_job`/`export_job`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `feat/migration-onboarding-jobs`        |
| 2026-08-30 | Issue #9 — RLS: 12 `security definer` helpers, policies on all 23 tables, pgTAP allow/deny harness, `supabase test db` in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `feat/rls-policies`                     |
| 2026-08-30 | Issue #10 — `get_neighborhood` SQL function + `pnpm gen:types` + `lib/db` typed layer + `lib/supabase` clients + pgTAP + CI drift check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `feat/db-typed-query-layer`             |
| 2026-08-30 | Issue #11 — `packages/shared` genealogy-date parser + formatter (5.5.1 + 7.0 calendars, dual dating, phrase fallback), 79 vitest tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `feat/genealogy-date-module`            |
| 2026-08-30 | Issue #12 — `packages/gedcom` reader: `nodes.ts` line grammar + `mapping.ts` tag tables + `readGedcom` (5.5.1 + 7.0, xref links, `raw_gedcom`), 29 vitest tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `feat/gedcom-reader`                    |
| 2026-08-30 | Issue #13 — `packages/gedcom` writer: `writeGedcom` + reverse enum tables in `mapping.ts`, header/xref/raw preserved, `version` option, 26 round-trip vitest tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `feat/gedcom-writer`                    |
| 2026-08-30 | Issue #14 — `gedcom-import` edge function: Deno-native `supabase/functions/` + `deno.json`/`deno.lock` + CI `functions` job; resumable `initial`-mode importer (deterministic UUIDv5, cursor phases), 11 Deno tests, schema-validated in a rollback txn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `feat/gedcom-import`                    |
| 2026-08-30 | Issue #15 — `gedcom-export` edge function: private `exports` bucket migration + pgTAP, `exporter.ts` DB→`GedcomReadResult` rebuild (xref reuse/synthesis, synth HEAD), engine/shell split, 6 Deno tests via the real #14 engine, live-stack verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `feat/gedcom-export`                    |
| 2026-08-30 | Issue #16 — `/import` UI: `imports` bucket migration + pgTAP, moderator-guarded route, upload → `gedcom-import` invoke → stall-driven resume poll, pure reducer + first `apps/web` vitest harness, 24 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `feat/import-ui`                        |
| 2026-08-31 | Reconciled #15/#16 (already merged `dddefba`/`cfc0388`, issues closed). Issue #17 — Supabase Auth: `on_auth_user_created` trigger, `/login` + magic-link/Google, Next 16 `proxy.ts` session gate, `/auth/callback` + web-tier ADMIN_EMAIL bootstrap, §8.1 `/` router, pgTAP + 13 vitest tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `feat/auth-supabase`                    |
| 2026-08-31 | Issue #38 (pulled forward from Phase 8, blocks #18/#21) — `supabase/seed.sql` demo admin + 28-person Ashby tree w/ pedigree collapse; `docs/reference/demo-tree.ged` Marsh family; `seed_smoke_test.sql` (12); `rls_test.sql` truncate-first for seed independence; `exporter.test.ts` demo round-trip. `supabase test db` 174, gates green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `feat/seed-demo-data`                   |
| 2026-08-31 | Issue #18 — `onboarding-match` edge function: `20260831154954` migration (`pg_trgm` + trigram GIN indexes + `onboarding_match_search` `security definer` SQL fn, threshold 0.3 tuned vs seed); Deno engine/gateway/shell (`search` → candidates + challenge keys, `verify` → link/no_match/already_claimed/already_linked/rate_limited); 18 engine tests + 13 pgTAP + drift guard. pnpm 184 / deno 36 / `supabase test db` 187 green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `feat/onboarding-match`                 |
| 2026-08-31 | Issue #19 — `/onboarding` UI: `20260831162624` migration (`notify_access_requested` `security definer` AFTER INSERT trigger on `access_request` → deduped `access_requested` notification); server-guard page → `OnboardingWorkspace` → pure `orchestrator.ts` reducer → `useOnboarding` hook → `lib/db/onboarding.ts` (`search`/`verify`/`submitAccessRequest`); challenges top candidate only; 9 pgTAP + 23 vitest + parity guard; `rls_test.sql` fixture reordered. pnpm 212 / deno 38 / `supabase test db` 196 green. 4 review fixes applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `feat/onboarding-ui`                    |
| 2026-08-31 | Issue #20 — Invite flow + `/moderation` stub (no migration): `inviteToClaim` server action (write `invitation` row → `auth.admin.inviteUserByEmail` → roll back on send failure); `maybeAcceptInvitation` in `/auth/callback` links a pending/unlinked account to `invitation.person_id`/`role`/`active` (`WHERE status='pending' AND person_id IS NULL` + `23505` → `conflict`); `lib/db/invitations.ts` typed layer; `resolveModerationAccess` shares `loadSessionAccount`; `AccountRole`/`AccountStatus` moved to `lib/db/types.ts`. 11 vitest (pnpm 223) + deno 38 + build green. Closed stale-open issue #17. 1 must-fix + 4 should-fix review fixes applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `feat/invite-flow`                      |
| 2026-08-31 | Issue #22 — generation bands overlay (no migration): pure `computeGenerationBands` (cluster laid-out `family-chart` node `y` centres into rows, index vs focus row, `Root Generation` / `Generation ±N` labels + birth-year span, tiling edges) + `readLaidOutTree` defensive parse; imperative `generation-bands-overlay.ts` owns an SVG `<g>` first-child of `svg .view` (zoom layer) — per-band `<g>` translate + full-bleed rect + gutter labels, CSS transitions match the card animation; `FamilyTree` `setAfterUpdate` repaint; shared card-box constants. 20 vitest added (pnpm 267) + build green. Browser-verified vs. seed: 6 bands centred on rows, pedigree-collapse row folded, re-centre re-aligns. Closed stale-open issue #21; labelled #22/#23 `ready`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `feat/tree-generation-bands`            |
| 2026-08-31 | Issue #21 — `family-chart` hourglass tree view (no migration, adds `family-chart@0.9.0`): `/tree/[personId]` server route (`isApproved` gate, `getNeighborhood` at default depths, `notFound` on non-UUID / empty); pure `toFamilyChartData` (family edges → rel sets, dedup, self-loop guard, sex→gender-for-layout) + `personCardHtml` (escaped string, silhouette/photo, lifespan, `×N` dup badge); `FamilyTree` client shell (`createChart` + `setCardInnerHtmlCreator`, `setSingleParentEmptyCard(false)`, no `setDuplicateBranchToggle` — throws on custom card); scoped CSS (blue/orange tint, `.card-main` focus ring); `isUuid` extracted to `lib/db/uuid.ts`. 29 vitest added (pnpm 252) + build green. Browser-verified vs. the seed: hourglass on Samuel, pedigree collapse renders `×2` no crash. Closed stale-open issue #20. Deferred to #23: depth read, click-recentre, URL history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `feat/tree-family-chart`                |
| 2026-08-31 | Issue #23 — re-centre + deep links (no migration): focus person is the `[personId]` segment, depth override is `?up`/`?down` (pure `tree-view-params.ts` — `resolveTreeDepth` / `treeHref`); `getDefaultGenerations` reads the `tree_settings` singleton (parallel with auth); `FamilyTree` built once and kept mounted across navigations, each new `tree` prop fed to the live chart via `updateData`/`updateMainId`/`updateTree` so `family-chart` animates the diff; `setOnCardClick` → `router.push(treeHref)`, depth stepper → `router.replace`, `useTransition` pending dim; `clampDepth`→exported `clampGenerations` + `MAX_GENERATIONS` constant; `tree-depth-parity.test.ts` guards the constants vs. the migrations. 13 vitest added (pnpm 280) + build green. Closed stale-open issue #22; labelled #25 `ready`. Review: no must-fix, 4 advisories applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `feat/tree-recenter-deeplinks`          |
| 2026-08-31 | Issue #25 — `/person/[personId]` read-only profile (no migration, RLS from #9 is the whole boundary): `getPersonProfile` fans out 6 parallel explicit-column queries (polymorphic tables filtered on `owner_type`) + one `getNeighborhood(id,1,1)` reused for parents/siblings/partners/children; wired `@rootward/shared` into `apps/web` for the first time (`tsconfig` `paths` + `transpilePackages`, no build-output dependency) so the timeline formats dates with `formatGenealogyDate`, closing #11's deferred enum-parity guard; pure `buildPersonProfileView` (sort_key timeline, fact restriction badges, relationship-group split) → presentational `PersonProfile`; `labels.ts` humanises enums by rule + a short override table. 21 vitest added (pnpm 301) + build green. Closed stale-open issue #23; labelled #24 `ready`. Review: 2 should-fix applied (missing query `.order()`, error-check ordering) + 3 advisories applied.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `feat/person-profile`                   |
| 2026-08-31 | Issue #24 — expand-in-place for collapsed branches (`20260831201221_expand_relatives.sql`): `get_neighborhood` gains `can_expand_up`/`can_expand_down` per person (frontier CTEs, guarded on the `base_persons`-chosen generation so pedigree collapse can't false-positive); new `expand_relatives(person, relation)` — `parents`/`children`/`self` — the scoped one-branch fetch behind the affordance. Frontend: `expandRelatives()` RPC wrapper, pure `lib/tree/expand-tree.ts` (`expandedGeneration`, `mergeNeighborhoodFragment`, `findUnresolvedPartners`); `FamilyTree.tsx` now takes the raw `Neighborhood` (conversion moved client-side), holds mergeable local state via React's render-time prop-sync pattern (not an effect — two hook-lint rules reject that), capture-phase click delegation for the three `▲`/`▼`/`+` card buttons, and a `navigationTokenRef` (bumped in an effect, not during render) that discards a stale expand fetch's result if a navigation lands first. 18 pgTAP + 5 pgTAP + 22 vitest added (pnpm 320, supabase test db 219) + build green. Review: 1 must-fix applied (the navigation-token race) + 2 should-fix applied (the SQL false positive; `ExpandRelation` hand-duplicated in three places, now one shared type + a `satisfies Record<...>` compile-time check). Labelled #26 `ready` (Phase 4 complete, #26's only dependency has long been merged). | `feat/tree-expand-in-place`             |
| 2026-08-31 | Closed stale-open issue #24 (merged `767cc3d`, left open). Issue #26 — Edit shell (no migration): `lib/person/relatives.ts` extracted from `view-model.ts` (`resolveRelationships`/`assembleName`/`personName`/`formatLifespan`, behavior-preserving) so the edit shell reuses the profile's relationship-resolution logic; `getPersonEditShell` (lean — person core + one `getNeighborhood(id,1,1)`, no events/facts/media fan-out) built on a shared `PERSON_CORE_COLUMNS`/`mapPersonCore` also now used by `getPersonProfile`; pure `lib/edit/sections.ts` (8-section registry, `?section=` URL state, `editSectionHref` mirrors `treeHref`) + `lib/edit/view-model.ts` (`buildEditShellView` — header, section nav, parents-top / partners+children-bottom strips, no siblings row); server-guard `/person/[personId]/edit` route (unauth → `/login`, pending → `/onboarding`, non-moderator → `EditForbidden`, absent/hidden → `notFound()`) + presentational `EditShell` (plain server component, `<Link>`-driven nav, no client machinery ahead of #27–#32's real section content). 17 vitest added (pnpm 337) + build green. Review: 1 should-fix applied (a stale "404s until Phase 5" doc comment on the profile route, now false since this PR ships `/edit`). Labelled #27/#28/#32 `ready` (each depends only on #26).                                                                        | `feat/edit-shell`                       |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- #1–#25 and #38 are merged to `main`. #26 is on `feat/edit-shell` (issue open
  until it merges). Later issues get `ready` as their dependencies close — do
  this when you finish an issue. #17 / #20 / #21 / #22 / #23 / #24 / #25 / #38
  were each closed by hand after their work merged but the issue stayed open
  (`d6ee22f` / `536c920` / `4c92f5e` / `00da1e6` / `5be36e5` / this session /
  `70c2c73` / `31e4bf3`).
- Phase 1 complete (#4–#10). Phase 2 (GEDCOM) complete (#11–#16). Phase 3 (auth
  & onboarding) complete (#17, #38, #18, #19, #20). Phase 4 (tree view,
  #21–#25) complete. Phase 5 (edit view, #26–#37) under way — #26 staged, the
  rest not started.
- **Seed data (#38).** `supabase/seed.sql` now loads a demo admin
  (`admin@rootward.test` / `rootward-admin`) + the 28-person Ashby tree on every
  `supabase db reset` / first `supabase start`. **After merging `feat/seed-demo-data`,
  run `supabase db reset`** to pick it up (not done this session — shared local
  stack). `supabase test db` loads the seed, so any new pgTAP suite that asserts
  absolute table counts must truncate first the way `rls_test.sql` now does, or
  scope every assertion. The demo GEDCOM is `docs/reference/demo-tree.ged` (the
  Marsh family — a _different_ family from the seed; each has one job).
- **Auth (#17).** Sign-in is magic link + Google, PKCE, both returning through
  `apps/web/app/auth/callback/route.ts`. `on_auth_user_created`
  (`20260831110459`) creates the `account` row on every `auth.users` insert —
  any pgTAP or seed that inserts `auth.users` now also gets an `account` row, so
  insert into `account` with `on conflict (id) do update`. `ADMIN_EMAIL` is a
  **web env var**, not known to Postgres: `/auth/callback` →
  `maybeBootstrapAdmin` (service role) promotes the match to `admin`/`active`.
  Session gating is `apps/web/proxy.ts` (Next 16 renamed `middleware.ts` →
  `proxy.ts`; both-files is a build error, `middleware.ts` warns). Decisions
  live in pure `lib/auth/auth-redirect.ts`. `config.toml` gained
  `[auth.external.google]` + `/auth/callback` redirect URLs — **a running local
  stack must be restarted (`supabase stop && supabase start`) to pick these
  up.** `/tree/[personId]` now exists (#21); `/` and the proxy route to it.
- **Invite flow (#20).** `/auth/callback` now runs `maybeAcceptInvitation`
  (`lib/auth/accept-invitation.ts`) after `maybeBootstrapAdmin`, in its own
  try/catch — an invite-link failure never blocks sign-in. It links a still-
  `pending`, unlinked account to a pending `invitation` matched by exact
  lower-cased email. `/moderation` (moderator+) holds the "Invite to claim" form
  (`inviteToClaim` server action — the app's first) + the pending-invitation
  list; the full moderation queue is #36. No migration — the `invitation` table
  and its RLS are from #8 / #9. `AccountRole` / `AccountStatus` now live in
  `lib/db/types.ts`; `lib/auth/access.ts` re-exports them. Deferred: an
  integration test for the `conflict` / `23505` branches of
  `maybeAcceptInvitation`.
- **Frontend (#16 is the first route).** `apps/web` now has tests: the root
  `pnpm test` (`vitest.config.ts`) globs `apps/web/**/*.{test,spec}.ts` with a
  `@/` alias (trailing slash — must not swallow `@rootward/*` / `@supabase/*`);
  `vitest` is an `apps/web` devDep so `tsc` / eslint resolve it. Node env only —
  no jsdom yet; add a vitest project when a component needs rendering tests.
  Pattern: server component guards access, a client `use*` hook is the container
  (effects + queries), a pure reducer holds the state machine, `lib/db/*`
  holds every query (decision 10). `/import` = `app/import/` +
  `lib/import/{orchestrator,useGedcomImport}.ts` + `lib/db/import-jobs.ts` +
  `lib/auth/{access,require-moderator}.ts`.
- **Auth is built (#17).** `/login`, the `proxy.ts` session gate, and the
  `on_auth_user_created` trigger all exist. `resolveImportAccess()` (#16) still
  uses `auth.getUser()` and is unchanged — the new `getCurrentAccount()` in
  `lib/auth/current-account.ts` mirrors it with `getClaims()`-parity intent for
  `/` and `/login`; a future tidy could fold `resolveImportAccess` onto it. No
  route has been exercised in a real browser yet — needs `supabase functions
serve` + a stack restart for the `config.toml` change (see "Next action").
- **Tree view (#21).** `/tree/[personId]` = `app/tree/[personId]/page.tsx`
  (server: `isApproved` gate + one `getNeighborhood`) + `components/tree/`
  (`FamilyTree.tsx` client shell, `family-tree.css`) + `lib/tree/`
  (`to-family-chart.ts` pure transform, `person-card.ts` pure HTML-string
  builder). `family-chart@0.9.0` is an `apps/web` dep; its published `Datum`
  type is a structural superset of `FamilyChartDatum` so no cast is needed at
  `createChart`. The card is an injected HTML string, not a component — visual
  state (gender tint, focus ring) is CSS on `family-chart`'s `card-male` /
  `card-female` / `card-main` classes. `setDuplicateBranchToggle` throws on a
  fully custom card (`DECISIONS.md`); `setSingleParentEmptyCard(false)` because a
  missing partner means "outside the neighbourhood window", not "unknown".
  Component-render tests still need a jsdom vitest project (not added).
- **Generation bands (#22).** `lib/tree/generation-bands.ts` (pure —
  `computeGenerationBands` + `readLaidOutTree`) and
  `components/tree/generation-bands-overlay.ts` (imperative SVG `<g>` first-child
  of `svg .view`, the zoom layer). `FamilyTree` calls `chart.setAfterUpdate` to
  repaint. Bands are derived from rendered geometry (row `y` clusters vs. the
  focus row), **not** `NeighborhoodPerson.generation` — the band must line up
  with the pixels `family-chart` produced. `family-chart` positions a card by its
  centre, so `LaidOutNode.y` is the card centre. Card-box dimensions are now
  shared TS constants in `FamilyTree.tsx` and must match `.rw-card` in the CSS.
  No jsdom render test (same defer as #21).
- **Re-centre + deep links (#23).** The focus person is the `[personId]`
  segment; the depth override is `?up` / `?down` (pure
  `lib/tree/tree-view-params.ts` — `resolveTreeDepth` reads them, `treeHref`
  writes them only when they differ from the `tree_settings` default).
  `FamilyTree` is now **built once and stays mounted across navigations** — do
  not re-key it on `personId`; each new `tree` prop is fed to the live chart
  (`updateData` → `updateMainId` → `updateTree`) so `family-chart` animates the
  diff. A card click is `router.push(treeHref)`, a depth step is
  `router.replace` (keeps depth out of the focus back-history). One
  `get_neighborhood` per navigation, server-side. `lib/db/neighborhood.ts`
  exports `clampGenerations` / `MAX_GENERATIONS` (mirrors the SQL
  `least(…, 10)`); `getDefaultGenerations` (in `tree-settings.ts`) reads the
  singleton. `lib/db/tree-depth-parity.test.ts` greps the two migrations and
  fails if the `10` or the `2`s drift from the TS constants. Deferred
  (`DECISIONS.md`): caching the invariant settings read — revisit with #37's
  settings-edit revalidation.
- **`/person/[personId]` read-only profile (#25).** `lib/db/person.ts`
  (`getPersonProfile`, RLS is the whole boundary — a hidden/absent person both
  return `null`) → pure `lib/person/view-model.ts` (`buildPersonProfileView`,
  `resolveRelationships`) → presentational `components/person/PersonProfile.tsx`.
  `@rootward/shared` is now a real `apps/web` dependency (first consumer) — its
  `tsconfig.json` `paths` entry resolves it from `packages/shared/src` (no build
  step in CI) and `next.config.ts` `transpilePackages` keeps `next build`
  consistent with that. `lib/db/genealogy-date.ts` bridges a row's flat
  `date_*` columns to `formatGenealogyDate` — reuse it for any future date
  display in `apps/web`, never hand-format one. The relationship strip is
  `getNeighborhood(id, 1, 1)`, split into parents/siblings/partners/children by
  `resolveRelationships` — the same relative set as the tree view (WAYFINDER
  decision 28), not a bespoke `family` query. The timeline is person-owned
  events only; a family's union events (marriage, divorce) are not merged in —
  see `DECISIONS.md` if extending this. `lib/person/labels.ts` humanises enum
  values by rule plus a short override table (`ssn`, `bar_mitzvah`, …) instead
  of a full hand-maintained map.
- **Expand-in-place (#24).** `get_neighborhood`'s `can_expand_up` /
  `can_expand_down` (migration `20260831201221`, a `create or replace` on the
  #10 function) are only ever true for a person at the exact frontier
  generation whose _displayed_ `base_persons` generation matches it too — do
  not drop the `bp.gen = …` guard if this function is touched again, it is
  what stops a pedigree-collapse duplicate from showing a spurious affordance.
  `expand_relatives(person, relation)` is the scoped fetch: `'children'`'s
  `child_ids` is deliberately unfiltered (wider than `get_neighborhood`'s
  window-scoped set for the same family) — `mergeNeighborhoodFragment`
  (`lib/tree/expand-tree.ts`) is what has to reconcile the two, by widening
  rather than replacing. `FamilyTree.tsx` now owns the `Neighborhood` →
  `FamilyChartTree` conversion (moved off `page.tsx`) and merges expand
  fragments into local state; the `navigationTokenRef` guarding a stale
  in-flight fetch is written in a `useEffect`, never during render (`eslint`'s
  `react-hooks/refs` rule forbids a ref write in the render body, which is
  also why the prop-reset above it uses two `useState`s instead of a ref for
  the "have we already synced this prop" check). `findUnresolvedPartners`
  surfaces only one off-window spouse per known partner — a second marriage's
  second gap is left for the post-MVP extended-family pass.
- **Edit shell (#26).** `/person/[personId]/edit` is the shell only — section
  content is #27–#32. `lib/edit/sections.ts` is the URL/slug contract every
  section issue builds against: `?section=<slug>` off the eight-entry
  `EDIT_SECTIONS` registry (`name-gender` is the default and the bare-URL
  case, mirroring `treeHref`). `lib/person/relatives.ts` now holds
  `resolveRelationships` / `assembleName` / `personName` / `formatLifespan` —
  moved out of `lib/person/view-model.ts` (the profile page) so the edit
  shell's relatives strip and the profile's relationship groups share one
  implementation; any future person-display helper needed by both belongs
  there, not duplicated. `getPersonEditShell` (`lib/db/person.ts`) is
  deliberately lean (person core + one `getNeighborhood(id,1,1)`, no
  events/facts/media fan-out) — a section issue that needs its own data should
  add its own typed query, not widen this one, since sections do not all need
  the same rows. `EditShell.tsx` is a plain server component with no client
  state; a section issue that needs interactivity (the `DateInput` live parse
  in #28, say) introduces its own client component scoped to that section
  rather than promoting the whole shell to `"use client"`.
- The `imports` bucket + its `is_moderator()` `storage.objects` policy live in
  migration `20260830235147` (mirror of the #15 `exports` bucket). Both were
  applied to the shared local stack with `supabase migration up` (additive) —
  a session that runs `supabase db reset` needs this branch merged first.
- The genealogy-date module (#11) lives in `packages/shared`
  (`parseGenealogyDate` / `formatGenealogyDate`, exported from the package root).
  `packages/gedcom` parses every `DATE` through it — do not re-implement date
  parsing. `packages/shared/tsconfig.build.json` excludes `*.test.ts` from
  `dist/`; `pnpm typecheck` still checks tests via the base `tsconfig.json`.
- The GEDCOM reader (#12) is `packages/gedcom`: `readGedcom(text)` →
  `GedcomReadResult`. Layers: `nodes.ts` (line grammar), `mapping.ts` (tag →
  enum tables, SPEC §6), `reader.ts` (the walk). Cross-record links are GEDCOM
  xref strings, not UUIDs — #14 resolves them. Unmapped sub-tags land in each
  record's `raw_gedcom` (`RawGedcomNode[]`); the writer (#13) re-emits them.
  `packages/gedcom` now depends on `@rootward/shared` (`workspace:*`). That
  cross-package import needs three resolution paths kept in step: `paths` in
  `packages/gedcom/tsconfig.json` (typecheck, from source), a `resolve.alias` in
  the root `vitest.config.ts` (tests, from source), and `pnpm -r`'s topological
  order + `tsconfig.build.json` `paths: {}` (build, from `shared/dist`). Add a
  new cross-package dep → update all three.
- Fixtures for the GEDCOM tests are TS string constants in
  `packages/gedcom/src/fixtures.ts` (the package lint bans Node built-ins, so a
  test cannot read a `.ged` file from disk). `fixtures.ts` is excluded from
  `dist/`. No real MacFamilyTree export exists in `docs/reference` yet — drop one
  in and add a fixture when one is available. When one lands, add a `writeGedcom`
  round-trip case for it too.
- The GEDCOM writer (#13) is `writeGedcom(result, options?)` in
  `packages/gedcom/src/writer.ts` (exported from the package root). It is the
  inverse of `readGedcom` for **structural** round trips, not byte-for-byte:
  `read(write(read(text)))` deep-equals `read(text)`. It re-emits mapped fields
  first, then each record's stored `raw_gedcom` verbatim. `HEAD` / `SUBM` come
  straight from `result.header` / `result.submitters`. `DATE` = `date_value_raw`
  (no reverse date formatter). Reverse enum tables are in `mapping.ts`
  (`EVENT_TAG_FOR` etc., `satisfies Record<Enum, …>`). `#14`'s re-export path
  calls this — every imported record must keep its `gedcom_xref` for it to work.
- **Edge functions (#14+) live in `supabase/functions/`, Deno-native.** Not a
  pnpm workspace member. `deno.json` = import map (`@rootward/*` → package
  source, `@supabase/supabase-js` pinned, `@std/assert`) + `sloppy-imports`
  (packages use extensionless imports) + `deno.lock`. `deno` must be installed
  (`brew install deno`). Run the Deno gate from the repo root with
  `--config supabase/functions/deno.json` (see `.trillian-repo.json` verify) or
  from `supabase/functions/` directly; CI has a parallel `functions` job.
  Pattern per function: a portable engine (`importer.ts` / `exporter.ts`) with an
  injected gateway interface (vitest-free, `Deno.test` unit tests), `gateway.ts`
  the supabase-js impl, `index.ts` the `Deno.serve` shell. `packages/*` stay pure
  — the ban still applies there, only the `supabase/functions/` shell may touch
  Deno. `deno.json` `lint.include` + the `check` / `test` tasks list each
  function dir; CI's `functions` job runs `deno check gedcom-import/
gedcom-export/`.
- The `gedcom-import` engine (#14) is `runImport(deps)` in
  `supabase/functions/gedcom-import/importer.ts`. Row ids are
  `uuidv5(<stable key>, jobId)` (deterministic → resume re-runs a batch as an
  upsert, no dupes). `import_job.cursor` = `{ phase, offset }` is the only
  resume state. Phase order is FK-safe: places → repositories → sources →
  shared_notes → media → persons → families. Dangling pointers (`HUSB @I9@`
  with no `@I9@`, a missing `SOUR` / `OBJE` / `REPO`) and junk `PLAC` values do
  not fail the import — the reference is dropped or a stub row synthesised, with
  a `stats.warnings` entry. Shared `NOTE` records are inlined per owner
  (`note.gedcom_xref` is unique — SPEC §4.5 — so one shared row would drop every
  link but the last); #15 revisits the `@N1@` provenance for export.
  `schema_parity.test.ts` guards the gedcom TS unions against the migration
  enums (the deferred #12 guard — now load-bearing, this is the first writer).
- The `gedcom-export` engine (#15) is `runExport(deps)` in
  `supabase/functions/gedcom-export/exporter.ts`. `buildResult(rows, now)` is the
  inverse of the importer's row-building: it walks the whole row set and rebuilds
  a `GedcomReadResult`, then `writeGedcom` serialises it. xrefs: a row keeps its
  stored `gedcom_xref` when valid, else `XrefPool` synthesises `@<I|F|S|R|O><n>@`
  past every xref already claimed. The importer stashes the primary name's
  sub-tags as a synthetic top-level `NAME` node in `person.raw_gedcom` —
  `splitPrimaryName` pulls it back out. The `HEAD` block is synthesised (no table
  stores it); all notes are emitted inline (the importer stores none as shared,
  so `@N1@` provenance is lost across a round trip — acceptable, decision in
  `DECISIONS.md`). Family-owned facts are dropped with a warning (`ParsedFamily`
  has no facts field). The `gateway.ts` pages every table read by 1000 (PostgREST
  cap). Private `exports` bucket + `is_moderator()` object policy live in
  migration `20260830231234`; `imports` (for #14/#16) still needs the same.
- The `onboarding-match` engine (#18) is `runSearch` / `runVerify` in
  `supabase/functions/onboarding-match/matcher.ts`. Only `onboarding_match_search`
  (migration `20260831154954`) is SQL — a `security definer` trigram fn returning
  `person_id` + `score` only. Everything else is service-role table access in
  `gateway.ts`; the decision logic is pure and in `matcher.ts` (18 fake-gateway
  tests). `selectChallenges` = answerable subset of `spouse_first_name` /
  `parent_first_name` / `birth_place` / `birth_day`, priority order, cap 2;
  `verify` recomputes the posed set server-side and ignores non-posed answers.
  Auth is any signed-in user (the account is `pending`), not a moderator. Every
  `verify` writes exactly one `claim_attempt` **except** the `rate_limited`
  refusal (writes none — so a retry loop can't roll the 24h window). The
  `SEARCH_THRESHOLD` / `p_threshold` default is `0.3`, tuned against the seed —
  `DECISIONS.md` has the score table.
- **`/onboarding` (#19)** is `apps/web/app/onboarding/` + `lib/onboarding/`
  (`orchestrator.ts` pure reducer, `useOnboarding.ts` hook) + `lib/db/onboarding.ts`
  (`searchOnboardingMatch` / `verifyOnboardingMatch` / `submitAccessRequest`;
  `challengeLabel` has a fallback so a new server challenge key does not break the
  form). `resolveOnboardingStage` in `lib/auth/access.ts` gates the page. The
  flow challenges `candidates[0]` only (multi-candidate collision → request-access
  → moderator; see `DECISIONS.md`). Challenge keys + verify statuses are restated
  from `matcher.ts` — `lib/db/onboarding-parity.test.ts` reads that file and
  guards the copies. **#19 closed the #18 owe:** migration `20260831162624`'s
  `notify_access_requested` trigger (`security definer`, `AFTER INSERT` on
  `access_request`, deduped per account) raises the `access_requested`
  notification. It fires for the #18 attempt-cap path too — that path's own
  `claim_attempt_cap` notification and the `access_requested` row coexist by
  design. Any new pgTAP suite that inserts an `access_request` now also gets a
  `notification` row — `rls_test.sql` pre-seeds the notification first so the
  trigger's dedup keeps its counts stable.
- **Deferred from #12's review — enum-parity guard.**
  `packages/gedcom/src/types.ts` hand-copies the seven Postgres enums
  (`event_type`, `fact_type`, `sex`, `name_type`, `partner_role`, `union_type`,
  `child_relation`). They match the migrations today. Add a guard test that
  parses `supabase/migrations/*.sql` for each `create type … as enum (...)` and
  asserts the union covers it — but the package lint bans Node built-ins, so
  either add an eslint carve-out for `**/*.test.ts` in
  `eslint.config.base.mjs` first, or put the guard in `apps/web` (which already
  imports the generated DB types) when the edit view (#25) lands. Same class as
  #11's deferred cross-package sync test.
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
