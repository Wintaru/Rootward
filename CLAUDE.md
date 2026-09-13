# Rootward — working instructions for Claude

Rootward is an open-source, self-hostable family-tree website. Data lives in
Postgres (Supabase); GEDCOM is import/export only. See `README.md` for the
product pitch.

## Start every session here

This project runs as a series of **fresh agent sessions**, one per unit of work,
to keep context small. There is no parallel work. To pick up:

1. Read `PROGRESS.md` — it names the current phase and the next issue.
2. Read `docs/SPEC.md` — the section for that issue is the build contract.
   Read `docs/WAYFINDER.md` only when you need the *why* behind a decision.
3. Run `gh issue list --state open` and find the work:
   - **If no issues exist yet**, the task for this session is to create the issue
     set from `docs/SPEC.md` §10 — one issue per numbered item, milestones per
     phase, labels per §10. Then stop.
   - **If `ready`-labelled issues exist**, take the lowest-numbered one unless
     `PROGRESS.md` says otherwise.
   - **If issues exist but none is `ready`**, follow `docs/SPEC.md` §10 order and
     pick the next unstarted item.
4. Do that one issue. Do not pull scope forward from later issues.
5. When done: update `PROGRESS.md`, stage the work, close the GitHub issue
   for it (comment naming the branch — Josh commits and pushes himself right
   after, so there is no merge commit to cite yet), then hand Josh the
   commit message, then stop. Trust that the commit lands — don't wait for
   him to confirm before closing. A quick sanity check at the start of the
   next session (e.g. is the branch's work actually on `origin/main`?) is
   fine, but the default assumption is that it already is.

If a §11 open question blocks the issue you picked, stop and ask Josh — do not
guess past it.

If `PROGRESS.md` and the GitHub issues disagree, `PROGRESS.md` is stale — trust
the issues and fix `PROGRESS.md`.

## Canonical documents

| File | Role | Who edits it |
| --- | --- | --- |
| `docs/WAYFINDER.md` | The decision map. Settled decisions, numbered. | Only via the `wayfinder` skill, and only when a decision genuinely changes. Mark superseded entries in place, never delete. |
| `docs/SPEC.md` | The build contract derived from WAYFINDER. | Update when an issue reveals the spec was wrong or thin. Keep it in step with WAYFINDER — WAYFINDER wins on conflict. |
| `PROGRESS.md` | Where the build is right now. | Every session, at the end. |
| `DECISIONS.md` | Build-time decision log (gitignored). | As consequential forks happen. |

## Conventions

- **Hosted multi-tenancy is a planned future phase, not current work.**
  WAYFINDER decision 37 and the "Hosted Multi-Tenancy (Post-MVP)" milestone
  track the plan for offering Rootward as a subdomain-per-family hosted
  service. Don't pick up any of its issues until Josh says so — but while
  doing ordinary single-tenant work, keep RLS checks behind shared helper
  functions (not repeated inline), keep new storage buckets/policies gated
  the same way as the existing ones, and don't hardcode this deployment's
  domain in new code. None of that is multi-tenant work; it just keeps the
  later retrofit mechanical instead of a rewrite.
- **Branch before work.** `git switch -c <type>/<slug> origin/main` (fetch first).
  Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
- **Stage, do not commit.** Josh runs every commit and push himself. Hand him the
  commit message as a copyable block. Do not draft the PR title or body — Josh
  writes those (`.trillian-repo.json` → `git.prMessages: false`).
- **One reviewed body of work per PR.** Run the verify gate
  (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test`),
  then a code review, before handing over the message. Work under
  `supabase/functions/` also runs the Deno gate (`deno fmt --check`, `deno lint`,
  `deno check`, `deno test` — see that directory's `README.md`); `deno` must be
  installed (`brew install deno`).
- **Schema is migrations.** Never hand-edit a shipped migration. Add a new one.
- **RLS is the access boundary.** Every new table gets RLS enabled and an
  allow/deny test in the same PR. Frontend checks are convenience, not security.
- **The GEDCOM module stays portable.** `packages/gedcom` and the date parser in
  `packages/shared` use pure TypeScript — no Deno or Node built-ins — so a C#
  port stays possible (WAYFINDER decision 8).
- **Edge functions are Deno, not pnpm.** `supabase/functions/` sits outside the
  workspace; `deno.json` holds its import map and `sloppy-imports`. Split each
  function into a portable engine (injected gateway, unit-tested) and a thin
  `Deno.serve` shell — see `supabase/functions/README.md`.
- **Data access:** explicit column lists, filter/paginate/aggregate in Postgres,
  one round trip where possible. The tree view fetches only the visible
  neighborhood (WAYFINDER decision 9).

## Servers

Claude-managed. Run the dev stack as a harness-tracked background task
(`pnpm dev`, `supabase start`) and stop it when the session ends. Do not
fire-and-forget it. Check `pnpm dev:status` before assuming the app is up.

The Supabase stack is shared by every session on the machine. `pnpm dev:fresh`,
`pnpm dev:up`, `pnpm dev:stop`, and `supabase functions serve` all restart or
remove containers other sessions may be using. Do not run them unless Josh
asks; when a fresh stack is needed, say so and let Josh run `pnpm dev:fresh`.

## Stack skills

Load `typescript` for app code, `sql` for migrations and policies,
`frontend-arch` for component structure. iDesign does not apply here.
