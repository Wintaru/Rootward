# Deploy: Docker Compose self-host

The self-host path (WAYFINDER decision 32). One deployment, one tree
(decision 17) — this is the "run it on your own server" story. Read
[`README.md`](README.md) first for the shared setup steps this guide
assumes.

This path runs two things on your server:

- The Supabase stack (database, auth, storage, realtime, and the edge
  functions), through the Supabase CLI's own Docker Compose setup — the
  same tool `pnpm dev` uses locally, pointed at your real domain instead of
  `127.0.0.1`.
- The Next.js web app, through the `docker-compose.yml` and
  `apps/web/Dockerfile` in this repository.

## What you need

- A Linux server with Docker and the Docker Compose plugin installed.
- A domain name with two DNS records pointed at the server, for example
  `tree.example.com` (the web app) and `api.tree.example.com` (the Supabase
  API).
- The [Supabase CLI](https://supabase.com/docs/guides/cli), installed on the
  server.
- A reverse proxy that can get a TLS certificate, for example
  [Caddy](https://caddyserver.com). The example below uses Caddy because it
  gets and renews certificates on its own.

## 1. Get the code onto the server

```sh
git clone https://github.com/<your-fork-or-org>/Rootward.git
cd Rootward
cp .env.example .env
```

Fill in `.env` with the variables from `README.md`'s table. Set
`NEXT_PUBLIC_SUPABASE_URL` to `https://api.tree.example.com`, and
`NEXT_PUBLIC_SITE_URL` to `https://tree.example.com`, using your own domain.

## 2. Turn off local-development-only defaults

`supabase/config.toml` ships set up for local development. Before you start
the stack for the first time, make three changes to this file on your
server.

**WARNING:** Do not skip this step before your first `supabase start`. The
default settings load a demo family tree into your production database and
capture outgoing email instead of sending it.

1. Under `[db.seed]`, set `enabled = false`. The committed `seed.sql` loads
   a demo family and a demo admin account — this is correct for local
   development, and wrong for your own family's tree.
2. Under `[local_smtp]`, set `enabled = false`. This component only
   displays outgoing email in a local web page — it does not send it to
   real inboxes.
3. Add a real SMTP provider under `[auth.email.smtp]` (uncomment the block
   and fill it in). Magic-link and invitation email will not reach anyone
   without this.

Then update the Auth URLs for your domain:

```toml
[auth]
site_url = "https://tree.example.com"
additional_redirect_urls = [
  "https://tree.example.com/auth/callback",
]
```

If you use Google sign-in, its `client_id` and `secret` still read from
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` and
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)` — set those two values in your
`.env` file. Its authorized redirect URI in the Google Cloud Console is
`https://api.tree.example.com/auth/v1/callback`.

These are local changes to your own server's copy of `config.toml`. A later
`git pull` for an update can overwrite them — check this file after every
update.

## 3. Start the Supabase stack

```sh
set -a; source .env; set +a
supabase start
```

This starts Postgres, Auth, Storage, Realtime, and the edge runtime, and
applies every migration. The first start also creates the storage buckets.
It does not seed demo data — you turned that off in step 2.

`supabase start`'s edge runtime serves the four functions
(`gedcom-import`, `gedcom-export`, `onboarding-match`, `media-process`)
straight from `supabase/functions/` on disk. No deploy step is necessary —
`supabase functions deploy` only targets a *linked* Supabase Cloud project,
which this path does not have.

`supabase status -o env` prints the local API URL and keys. Copy the
`ANON_KEY` and `SERVICE_ROLE_KEY` values into
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

## 4. Start the web app

```sh
docker compose up -d --build
```

This builds `apps/web/Dockerfile` and starts the web app on
`127.0.0.1:3000` (step 5 puts a reverse proxy in front of it). The image
contains only the built Next.js standalone server, not the whole
repository.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must already
be in `.env` before this command runs, not just before the container
starts — Next.js bakes both into the browser bundle at build time. This is
why step 3 has you fill them in first.

## 5. Put a reverse proxy in front

`docker-compose.yml` already binds the web app to `127.0.0.1:3000`, not the
public interface — Caddy is the only public door to it. The Supabase CLI's
own containers are not guaranteed to bind to loopback the same way, so set
up a firewall on the server (for example `ufw`) that allows only ports 80
and 443 (Caddy) from the public internet, and blocks every other port from
outside the server itself — including the Supabase API gateway's `57321`
and the database's `57322` (the `[api]` and `[db]` ports in `config.toml`).
Caddy reverse-proxies to the API gateway below, so it needs no direct
public port of its own.

A minimal `Caddyfile`:

```
tree.example.com {
  reverse_proxy 127.0.0.1:3000
}

api.tree.example.com {
  reverse_proxy 127.0.0.1:57321
}
```

Run Caddy on the server (as its own package, or its own container) and
point both DNS records at the server's public IP. Caddy gets and renews the
TLS certificates for both domains on its own.

## 6. Bootstrap the first admin

Follow `README.md`'s "Bootstrap the first admin" section. Sign in at
`https://tree.example.com/login` with the address in `ADMIN_EMAIL`.

## Updating a deployment

```sh
git pull
set -a; source .env; set +a
supabase db push --local
supabase stop
supabase start
docker compose up -d --build
```

`--local` tells the CLI to push migrations to this self-hosted database,
not to a linked Supabase Cloud project — this path has none. A restart
picks up a changed edge function from `supabase/functions/` on disk, the
same way `supabase start` did on the first deploy.

Re-check `supabase/config.toml` against step 2 after every `git pull` — an
upstream change to that file can silently restore a local-development
default.

## Backups

Scheduled, automatic backups are a post-MVP feature (decision 29). Until
then, back up the Postgres data yourself, for example with `pg_dump`
against the database port in `config.toml`, on a schedule you control.
