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
5. When done: update `PROGRESS.md`, stage the work, hand Josh the commit message
   and PR title/body, then stop.

If a §11 open question blocks the issue you picked, stop and ask Josh — do not
guess past it.

If `PROGRESS.md` and the GitHub issues disagree, `PROGRESS.md` is stale — trust
the issues and fix `PROGRESS.md`.

## Canonical documents

| File | Role | Who edits it |
| --- | --- | --- |
| `docs/WAYFINDER.md` | The decision map. 33 settled decisions, numbered. | Only via the `wayfinder` skill, and only when a decision genuinely changes. Mark superseded entries in place, never delete. |
| `docs/SPEC.md` | The build contract derived from WAYFINDER. | Update when an issue reveals the spec was wrong or thin. Keep it in step with WAYFINDER — WAYFINDER wins on conflict. |
| `PROGRESS.md` | Where the build is right now. | Every session, at the end. |
| `DECISIONS.md` | Build-time decision log (gitignored). | As consequential forks happen. |

## Conventions

- **Branch before work.** `git switch -c <type>/<slug> origin/main` (fetch first).
  Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
- **Stage, do not commit.** Josh runs every commit and push himself. Hand him the
  commit message (copyable block) and a PR title + body every time.
- **One reviewed body of work per PR.** Run the verify gate
  (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test`),
  then a code review, before handing over the message.
- **Schema is migrations.** Never hand-edit a shipped migration. Add a new one.
- **RLS is the access boundary.** Every new table gets RLS enabled and an
  allow/deny test in the same PR. Frontend checks are convenience, not security.
- **The GEDCOM module stays portable.** `packages/gedcom` and the date parser in
  `packages/shared` use pure TypeScript — no Deno or Node built-ins — so a C#
  port stays possible (WAYFINDER decision 8).
- **Data access:** explicit column lists, filter/paginate/aggregate in Postgres,
  one round trip where possible. The tree view fetches only the visible
  neighborhood (WAYFINDER decision 9).

## Servers

Claude-managed. Run the dev stack as a harness-tracked background task
(`pnpm dev`, `supabase start`) and stop it when the session ends. Do not
fire-and-forget it. Check `pnpm dev:status` before assuming the app is up.

## Stack skills

Load `typescript` for app code, `sql` for migrations and policies,
`frontend-arch` for component structure. iDesign does not apply here.
