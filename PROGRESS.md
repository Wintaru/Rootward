# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file, then
the relevant `docs/SPEC.md` section.

## Current state

**Phase:** 3 — Auth & onboarding. Phase 0 complete (#1–#3), Phase 1 complete
(#4–#10 merged), Phase 2 complete (#11–#16 merged). #15 / #16 landed as commits
`dddefba` / `cfc0388` — PROGRESS was stale (said "staged on a branch"); the
branches were already merged and deleted, issues now closed. #17 merged
(`d6ee22f`). **#38 (Phase 8 seed data) pulled forward** — it blocks #18's
`pg_trgm` threshold tuning and #21's pedigree-collapse work, so it was built
out of phase order. #38 done — see below. #18 is next.
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

## Next action

**Back to Phase 3.** Issue **#18 — `onboarding-match` edge function**
(`docs/SPEC.md` §7 `onboarding-match`, §9.3, §10 item 18): `pg_trgm` name
search, challenge question(s), rate limit, link + moderator notify. Needs the
`pg_trgm` extension enabled in a migration (§2 tech stack). Then #19 (`/onboarding`
UI) and #20 (invite flow).

- **The demo tree now exists** (#38), so the §11 threshold can be tuned for real
  — `docker exec supabase_db_rootward psql -U postgres -d postgres` then
  `select p.given_name, p.surname, similarity(p.given_name, '<query>') from
person p order by 3 desc` against the seeded Ashby names (the
  `Catherine`/`Katherine` and double-`John` collisions are deliberate).
- **Challenge policy is already decided** (Josh, this session — see
  `DECISIONS.md`): link on **one correct answer** among those posed. Do not
  re-litigate; the 5/24h cap + `self_claim_linked` notification are the guards.
- Architecture: edge function with the #14/#15 engine + gateway + `Deno.serve`
  shell split. Auth is a **pending** user's JWT (not moderator — the caller is
  not approved yet). Trigram search must be a SQL function (supabase-js can only
  `.rpc()`); `claim_attempt` / `notification` writes are service-role
  (`20260830174012_rls_policies.sql` line 633 — "written only by the
  onboarding-match edge function under the service role").

Still pending across #14–#17: a deployed-function run (`supabase functions
serve`) plus a real signed-in browser session driving `/login` → `/import` end
to end. `/login` now exists — do this as a dedicated integration pass, and
restart the local stack first so the `config.toml` Google + redirect-URL change
loads.

`gh issue list --label ready` is the queue. Take the lowest-numbered `ready`
issue unless this file says otherwise. When an issue merges, label the issues it
unblocks `ready`.

## Log

| Date       | Session did                                                                                                                                                                                                                                                                                                                                  | Result                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-08-30 | Wayfinder planning — all decisions settled                                                                                                                                                                                                                                                                                                   | `docs/WAYFINDER.md` (1–33)              |
| 2026-08-30 | Wrote the build spec                                                                                                                                                                                                                                                                                                                         | `docs/SPEC.md`                          |
| 2026-08-30 | Repo init, MIT license, project meta, resume protocol                                                                                                                                                                                                                                                                                        | `chore/scaffold`                        |
| 2026-08-30 | Spec review + fixes; settled frontend stack and public-access questions                                                                                                                                                                                                                                                                      | `docs/WAYFINDER.md` (34–35)             |
| 2026-08-30 | Created the 46-issue set from `docs/SPEC.md` §10 — milestones, labels, dependencies                                                                                                                                                                                                                                                          | GitHub issues #1–#46                    |
| 2026-08-30 | Issue #1 — scaffolded the pnpm monorepo; verify gate green                                                                                                                                                                                                                                                                                   | `chore/scaffold-monorepo`               |
| 2026-08-30 | Issue #2 — local Supabase dev stack, `pnpm dev` / `dev:status`, `.env.example`                                                                                                                                                                                                                                                               | `chore/local-supabase-dev-stack`        |
| 2026-08-30 | Issue #3 — GitHub Actions CI (`verify` + `migrations` jobs); build kept out of CI                                                                                                                                                                                                                                                            | `chore/ci-pipeline`                     |
| 2026-08-30 | Issue #4 — first migration: 6 enums + `person`/`person_name`/`family`/`family_child`                                                                                                                                                                                                                                                         | `feat/migration-core-genealogy`         |
| 2026-08-30 | Issue #5 — migration: `event`/`fact`/`place` + flat `date_*` set + sort-key trigger                                                                                                                                                                                                                                                          | `feat/migration-events-facts-places`    |
| 2026-08-30 | Issue #6 — migration: `source`/`repository`/`citation`/`media`/`media_link`/`note`                                                                                                                                                                                                                                                           | `feat/migration-sources-media-notes`    |
| 2026-08-30 | Issue #7 — migration: `account`/`tree_settings`/`audit_log` + `updated_at` + audit triggers                                                                                                                                                                                                                                                  | `feat/migration-account-settings-audit` |
| 2026-08-30 | Issue #8 — migration: `invitation`/`access_request`/`claim_attempt`/`notification`/`notification_read`/`import_job`/`export_job`                                                                                                                                                                                                             | `feat/migration-onboarding-jobs`        |
| 2026-08-30 | Issue #9 — RLS: 12 `security definer` helpers, policies on all 23 tables, pgTAP allow/deny harness, `supabase test db` in CI                                                                                                                                                                                                                 | `feat/rls-policies`                     |
| 2026-08-30 | Issue #10 — `get_neighborhood` SQL function + `pnpm gen:types` + `lib/db` typed layer + `lib/supabase` clients + pgTAP + CI drift check                                                                                                                                                                                                      | `feat/db-typed-query-layer`             |
| 2026-08-30 | Issue #11 — `packages/shared` genealogy-date parser + formatter (5.5.1 + 7.0 calendars, dual dating, phrase fallback), 79 vitest tests                                                                                                                                                                                                       | `feat/genealogy-date-module`            |
| 2026-08-30 | Issue #12 — `packages/gedcom` reader: `nodes.ts` line grammar + `mapping.ts` tag tables + `readGedcom` (5.5.1 + 7.0, xref links, `raw_gedcom`), 29 vitest tests                                                                                                                                                                              | `feat/gedcom-reader`                    |
| 2026-08-30 | Issue #13 — `packages/gedcom` writer: `writeGedcom` + reverse enum tables in `mapping.ts`, header/xref/raw preserved, `version` option, 26 round-trip vitest tests                                                                                                                                                                           | `feat/gedcom-writer`                    |
| 2026-08-30 | Issue #14 — `gedcom-import` edge function: Deno-native `supabase/functions/` + `deno.json`/`deno.lock` + CI `functions` job; resumable `initial`-mode importer (deterministic UUIDv5, cursor phases), 11 Deno tests, schema-validated in a rollback txn                                                                                      | `feat/gedcom-import`                    |
| 2026-08-30 | Issue #15 — `gedcom-export` edge function: private `exports` bucket migration + pgTAP, `exporter.ts` DB→`GedcomReadResult` rebuild (xref reuse/synthesis, synth HEAD), engine/shell split, 6 Deno tests via the real #14 engine, live-stack verified                                                                                         | `feat/gedcom-export`                    |
| 2026-08-30 | Issue #16 — `/import` UI: `imports` bucket migration + pgTAP, moderator-guarded route, upload → `gedcom-import` invoke → stall-driven resume poll, pure reducer + first `apps/web` vitest harness, 24 tests                                                                                                                                  | `feat/import-ui`                        |
| 2026-08-31 | Reconciled #15/#16 (already merged `dddefba`/`cfc0388`, issues closed). Issue #17 — Supabase Auth: `on_auth_user_created` trigger, `/login` + magic-link/Google, Next 16 `proxy.ts` session gate, `/auth/callback` + web-tier ADMIN_EMAIL bootstrap, §8.1 `/` router, pgTAP + 13 vitest tests                                                | `feat/auth-supabase`                    |
| 2026-08-31 | Issue #38 (pulled forward from Phase 8, blocks #18/#21) — `supabase/seed.sql` demo admin + 28-person Ashby tree w/ pedigree collapse; `docs/reference/demo-tree.ged` Marsh family; `seed_smoke_test.sql` (12); `rls_test.sql` truncate-first for seed independence; `exporter.test.ts` demo round-trip. `supabase test db` 174, gates green. | `feat/seed-demo-data`                   |

## Notes for the next session

- GitHub issues are the task queue. `PROGRESS.md` tracks position; the issues
  hold the detail. Each issue body cites its `docs/SPEC.md` section and lists
  `Depends on:` issue numbers and a `### Done when` checklist.
- Issue numbers match `docs/SPEC.md` §10 item numbers for 1–40. Issues 41–46 are
  the Post-MVP bullets.
- #1–#17 are merged to `main`. #38's work is on `feat/seed-demo-data` (issue
  open until it merges). Later issues get `ready` as their dependencies close —
  do this when you finish an issue.
- Phase 1 complete (#4–#10). Phase 2 (GEDCOM) complete (#11–#16). Phase 3 (auth)
  in progress: #17 done, #38 done (pulled forward), #18–#20 next.
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
  up.** `/onboarding` and `/tree/*` are still 404 (issues #19 / #21); `/` and
  the proxy already route to them.
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
