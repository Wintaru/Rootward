# Deploy Rootward

Rootward has two parts: a Supabase project (the database, auth, storage, and
four edge functions) and the Next.js web app. This guide has one path for
each. Pick one.

| Path | Supabase | Web app | Best for |
| --- | --- | --- | --- |
| [Vercel + Supabase Cloud](vercel-supabase-cloud.md) | Supabase Cloud, free tier | Vercel | Fastest start, no server to maintain |
| [Docker Compose self-host](docker-compose-self-host.md) | Your own server, Supabase CLI | Your own server, Docker | Full control, one deployment per family (decision 17) |

Both paths run the same code and the same database schema. Read this page
first — it covers the steps common to both, then each guide adds its own
setup around them.

## What you need before you start

- A Supabase account (Cloud path) or a Linux server with Docker installed
  (self-host path).
- A domain name. Auth redirects and Google sign-in both need a real URL, not
  an IP address.
- Optional: a Google Cloud project, to turn on "Continue with Google"
  sign-in. Magic-link sign-in works without it.

## The two families of environment variable

Every deploy sets the same variables. `.env.example` at the repository root
lists them with comments. The table below is the deploy-time reference.

| Variable | Where it is used | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Web app (browser and server) | Your Supabase project's API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web app (browser and server) | Your Supabase project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Web app (server only) | Your Supabase project's service role key. Keep this secret. |
| `NEXT_PUBLIC_SITE_URL` | Web app (server) | The public URL of the web app, for example `https://tree.example.com` |
| `ADMIN_EMAIL` | Web app (server) | The email address to promote to admin on its first sign-in (decision 19) |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | Supabase Auth | From your Google OAuth client. Leave unset for magic-link-only sign-in. |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | Supabase Auth | From your Google OAuth client. Keep this secret. |

The edge functions (`gedcom-import`, `gedcom-export`, `onboarding-match`,
`media-process`) need no variables of their own. Supabase gives every edge
function `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
automatically, on both Cloud and self-hosted projects.

## Database schema, storage buckets, and edge functions

`supabase db push` applies every migration in `supabase/migrations/`. It
creates all 23 tables, the RLS policies, and the three storage buckets
(`imports`, `exports`, `media`). It does **not** run `supabase/seed.sql` —
seed data is for local development only, and a real deploy starts with an
empty tree. The exact command differs by path, because the CLI needs to
know which database it is talking to:

- **Cloud:** link the CLI to your project first (`supabase link`), then run
  the plain `supabase db push`. It also needs a one-time
  `supabase functions deploy <name>` per function. See
  [`vercel-supabase-cloud.md`](vercel-supabase-cloud.md).
- **Self-host:** run `supabase db push --local` against your own
  `supabase start` stack. No function deploy step exists for this path —
  the self-hosted edge runtime already serves the functions straight from
  `supabase/functions/` on disk. See
  [`docker-compose-self-host.md`](docker-compose-self-host.md).

The steps below apply to both paths; each path's guide shows exactly where
to make them.

1. Turn on Google sign-in (skip this for magic-link-only). Create an OAuth
   client in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Set its authorized redirect URI to
   `<your-supabase-url>/auth/v1/callback` — this is a Supabase URL, not your
   app's URL. Each path's guide shows where to put the client ID and secret.

2. Set the Auth **Site URL** to your web app's real URL, and add
   `<your-app-url>/auth/callback` to the Auth **Redirect URLs**. Each path's
   guide shows where to set these.

3. Set up outgoing email. Supabase's built-in mailer is rate-limited and not
   meant for production use. Configure a real SMTP provider (for example
   Postmark, Resend, or SendGrid) so magic-link and invitation emails reach
   real inboxes. Each path's guide shows where to set this.

## Bootstrap the first admin

Set `ADMIN_EMAIL` to your own email address before the first deploy. Sign in
once, through magic link or Google, with that address. Rootward promotes
that account to admin automatically (decision 19) — no database step
necessary. Every later sign-in from that address re-checks the promotion, so
it is safe to leave `ADMIN_EMAIL` set after the first admin exists.

## After the first deploy

- Go to `/import` as the admin and load a GEDCOM file, or start adding
  people by hand once the edit view supports it.
- Go to `/settings` to name the tree and set the default root person
  (issue #37).
- Invite the rest of the family from `/moderation` (issue #20), or let them
  sign up and self-claim their place in the tree (issue #19).

See [`docs/reference/`](../reference) for the demo GEDCOM used in
development, and [`../SPEC.md`](../SPEC.md) for how each piece works.
