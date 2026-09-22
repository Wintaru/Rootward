# Rootward — Progress

Resume pointer for a fresh session. Read `CLAUDE.md` first, then this file,
then the relevant `docs/SPEC.md` section.

This file records **where the build is now**. It is not a journal. Per-issue
history lives in the closed GitHub issues and in `git log` — do not append a
narrative here. Rewrite the "Current state" and "Next action" sections at the
end of each session and leave the rest short.

## Current state

**Phase 11 — Release 1.0 is the current phase** (milestone of the same name,
label `phase:11`, contract in `docs/SPEC.md` §10 "Phase 11"). Nine of the
original thirteen issues are closed. Four remain, and four more were pulled
in on 2026-09-22: **#128**, **#129** (parked), **#130**, **#131**, plus
**#49**, **#103**, **#127**, **#47**.

Phases 1–10 are complete. Phase 10 (theme system, #74–#81) closed the MVP
feature set.

### The production deploy is live

`https://donner.rootward.family` serves the app from Vercel, backed by the
Supabase Cloud project **Rootward** (`fsdfkyjxdjdcuwludtzd`, us-east-2).
Verified 2026-09-22: `/login` returns 200 with every security header from
#132, all 29 migrations are applied to Cloud, and all four edge functions
(`gedcom-import`, `gedcom-export`, `media-process`, `onboarding-match`) are
`ACTIVE`. The Vercel project is `rootward-web` (root directory `apps/web`)
with all five environment variables set on Production.

`rootward.family` is on the Vercel team but still uses GoDaddy nameservers,
so `donner.rootward.family` resolves through a record rather than Vercel DNS.
The nameserver move (needed for a `*.rootward.family` wildcard certificate,
which only post-MVP multi-tenancy uses) is still open — the steps are in
`DNS-CHECKLIST.md` (local, gitignored).

The external accounts Josh owns are tracked in `EXTERNAL-SETUP-HANDOFF.md`
(local, gitignored). That file lags the real state — check the live systems
with the `vercel` and `supabase` CLIs before trusting it.

## Next action

**#128 is part done.** `docs/deploy/backup-restore.md` is new and covers
backup, restore, and upgrade. Every command in it was run against a
throwaway stack loaded with the 628-person demo tree, not written from the
documentation. All 26 tables matched exactly after a restore, and a stop and
start cycle kept the data.

The rehearsal found three commands that would have shipped broken, and one
silent failure worth knowing: after a database-only restore the tree looks
complete and every photo returns HTTP 500, because the database holds the
list of photos and not the photos.

**#128 stays open for one thing.** Every command ran with `--local`. The
Cloud variants differ by `--linked`, but Cloud runs a different Postgres
build, storage backend, and permission set — the same class of difference
that produced two of the three faults. Josh has offered a production
`pg_dump`, which closes the gap without writing anything to the live tree.
Restore it locally and compare.

After that: **#49**, **#127**, **#103**, **#47** (all local, no deploy
needed), then **#130** (blocked on Josh provisioning a Linux server), then
**#131** last. **#129** stays parked — see below.

**#129 is parked.** Its deploy is live and verified, but the issue's
acceptance test — import the 628-person demo tree, then wipe — cannot run
there. `donner.rootward.family` now holds Josh's real family tree, and
`wipe_tree()` (migration `20260914133629`) deletes every row of `note`,
`person`, `family`, `source`, `media`, `repository`, and `place` with no
scope at all. The parking comment on the issue has the detail.

**Standing rule: no test writes genealogy data to a deploy that holds a real
tree.** Tests run against the local stack. A live journey test needs a
throwaway Supabase project. That decision is what #129 is blocked on.

**Never reset the shared local stack to make room for a test.** The restore
rehearsal used `trillian-resource supabase acquire --fresh`, which gives a
clean stack on its own port block, and released it with `--stop` afterwards.
Use that instead of `pnpm dev:fresh`.

## Conventions this phase

- **Branch from `origin/main`.** The `release_work` branch Phase 11 used is
  merged and deleted; `.trillian-repo.json` `git.baseBranch` is `main` again.
- Josh commits and pushes every branch himself. No PR title or body.
- Continuous deployment is **not** in 1.0. Vercel already redeploys the web app
  on push; `supabase db push` and `supabase functions deploy` stay manual until
  #128 proves a restore path.
- **Production holds real family data.** Never point a test, a fixture, or a
  destructive RPC at the Cloud project. `E2E_BASE_URL` defaults to
  `http://localhost:3000` and the root `.env` points at `127.0.0.1` — keep it
  that way. CI runs its own `supabase start` and never links.

## Carried notes

Small things found and deliberately not fixed. Each is a candidate for an
issue, not a blocker.

- **Heirloom display face.** Cormorant Garamond wants `font-weight: 500` on
  display text (flagged in #79, not applied — a legibility call, not a
  contrast one).
- **pgTAP on the shared local stack.** #109 made the bucket and seed tests
  state-independent, but a stack shared with other sessions still carries
  state-only failures that only `pnpm dev:fresh` clears. A full
  `supabase test db` on a clean stack is 22 files / 380 tests, PASS. Josh runs
  `pnpm dev:fresh` — do not run it unasked.
- **Appearance writes an audit row.** Every theme pick writes an `audit_log`
  row and bumps `account.updated_at` (advisory from #80).
- **Married and maiden names are tree-only.** The tree card shows
  `Given Married (Maiden)`; the profile, People list, and search still show the
  primary name.
- **The demo tree is built, not committed.** `pnpm demo:build` regenerates
  `docs/reference/rootward-demo/rootward-demo.ged` (628 people, 233 families)
  and the gitignored `rootward-demo.gdz` with its media.
- **`audit_log` dominates a backup.** 233,650 rows, 95% of a 256 MB dump.
  Excluding it drops the dump to 14 MB and loses only the change history.
- **The `imports` bucket is never reclaimed** — 234 MB of staging for 46 MB
  of live media, filed as #134.
- **The local CLI is 2.117.0, the repo pins 2.116.0** in `package.json`
  `gen:types` and in CI. That drift is #103.
- **A CD proposal already exists** in `SUPABASE-CD-PROPOSAL.md` (untracked)
  and recommends CD inside Phase 11. This file says after 1.0. The
  disagreement is ordering, not merit, and it is Josh's to settle.

## Pulled into 1.0 on 2026-09-22

Josh's call. `docs/SPEC.md` §10 listed #47 and #103 as out of 1.0 until this
date — that line is now reversed there.

- **#49** — the auto-resolve trigger can miss a second pending
  `access_request` for the same account. A real correctness defect in
  shipped code.
- **#127** — the destructive e2e teardown restores a `tree_settings` root
  person the wipe deleted.
- **#103** — no single source of truth for the pinned Supabase CLI version.
  #128, #129, and #130 each record a CLI version, so this pays for itself.
- **#47** — tooling parity: type-aware lint and strict flags for `apps/web`.

Everything else open is `post-mvp`, `multi-tenant` (#89–#96, gated on Josh's
say-so per WAYFINDER decision 37), #123, #133, or a DRY cleanup (#83, #85,
#87, #88, #98, #102).

## How to work here

- GitHub issues are the task queue. Each issue body cites its `docs/SPEC.md`
  section and carries a `### Done when` checklist.
- Check `gh issue list --state open` against what is actually on `main` before
  picking work. Issues have repeatedly stayed open after their branch merged.
- One issue per session. Do not pull scope forward.
