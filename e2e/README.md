# Rootward end-to-end suite

Playwright tests that drive the real app in a real browser, against the local
Supabase stack. They cover every screen in SPEC §8.1 from every access level
in SPEC §9.4 — viewer, moderator, admin, a member who is not approved yet, a
suspended one, and a visitor with no session at all.

## Running it

Start the dev stack first; the suite attaches to it and never starts or stops
a server of its own (the stack is shared with other sessions on the machine).

```sh
pnpm dev            # one terminal
pnpm test:e2e       # another
```

Useful variants:

```sh
pnpm test:e2e --project=app        # desktop only
pnpm test:e2e --project=mobile     # the phone-width checks (#65)
pnpm test:e2e --ui                 # the Playwright UI runner
pnpm test:e2e:report               # open the last HTML report
```

## What the run does to your database

`global-setup` creates five test accounts and a small fixture family, and
`global-teardown` removes both again. Set `E2E_KEEP_FIXTURES=1` to keep them
after a failed run.

Notifications, invitations, and any people a test created are swept too, so
the database is left as it was found.

Nothing else is touched — **except** the `destructive` project, which wipes
the tree. It is off unless `E2E_DESTRUCTIVE=1` is set, because a bare
`playwright test` runs every _configured_ project:

```sh
E2E_DESTRUCTIVE=1 pnpm test:e2e --project=destructive
```

Without that variable the project is not added to the config at all, and the
spec file repeats the check, so a stale config cannot re-open the hole. It
wipes the tree and imports a GEDCOM because that is the only way to test
wipe and import (decision 33: only the first import is a plain load).
The GEDCOM it uses is, in order: `E2E_GEDCOM_PATH`, then
`~/Downloads/Donner/Donner.ged` if present, then the repo's own
`docs/reference/demo-tree.ged`. No real family data is committed here.

## Fixtures, not live data

Every assertion runs against data the suite creates, never against whatever
happens to be in the database. Two families, in id ranges the seed (`d…`) and
the pgTAP fixtures (`a…`/`b…`/`c…`) do not use:

- **`Qatestsson`** (`e0…`) — three generations, one person per rung of the
  visibility ladder, one claimed by the `viewer` account, and one photo.
- **`Bulktestsson`** (`e1…`) — 220 people under one surname. Large on
  purpose: it makes pagination deterministic, and it crosses the match count
  at which a name filter starts failing (see BUG-003 in
  `../E2E-BUG-REPORT.md`).

## How sign-in works

The product has no password (decision 11), so the suite does what a person
does: ask for a magic link at `/login`, read it out of Mailpit, follow it.
`global-setup` does that once per access level and saves the browser session,
so the tests themselves never pay for sign-in.

This means a broken sign-in fails the suite at startup rather than 200 tests
at once — which is how BUG-001 was found.

## Known skips

The GEDCOM import and export tests skip unless the edge functions are
bootable. `supabase start` bakes a runtime that mounts only
`supabase/functions`, while `deno.json` maps `@rootward/*` at
`../../packages/*`, so those two functions answer 503 there. Serve them with
the import map named (see `supabase/functions/README.md`):

```sh
supabase functions serve --import-map supabase/functions/deno.json
```

The suite probes once and skips with that instruction, rather than reporting
a setup gap as a product failure.

## Layout

| Path                                    | What it holds                               |
| --------------------------------------- | ------------------------------------------- |
| `tests/*.spec.ts`                       | One file per screen or concern              |
| `tests/destructive/`                    | The opt-in wipe + import story              |
| `support/test.ts`                       | `test` with one ready page per access level |
| `support/fixture-data.ts`               | The two fixture families and the media item |
| `support/auth.ts`, `support/mailpit.ts` | The magic-link sign-in path                 |
| `support/supabase-admin.ts`             | Service-role setup — never used to assert   |

`support/supabase-admin.ts` bypasses RLS on purpose, for setup only. What a
member can see is always read through the app under that member's own
session — that is the thing under test.
