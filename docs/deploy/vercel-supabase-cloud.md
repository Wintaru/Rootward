# Deploy: Vercel + Supabase Cloud

The hosted path. Supabase Cloud runs the database, auth, storage, and edge
functions on its free tier. Vercel runs the Next.js web app. Read
[`README.md`](README.md) first for the shared setup steps this guide
assumes.

## 1. Create the Supabase project

1. At [supabase.com](https://supabase.com), create a new project. Pick a
   region close to your family.
2. Open **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key. You need these for Vercel in step 4.
3. Open **Project Settings → API → Service role**. Copy the **service_role**
   key. Keep this secret. You need it for Vercel in step 4.

## 2. Push the schema and deploy the edge functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) on your own
machine, then run these commands from the repository root.

```sh
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
supabase functions deploy gedcom-import
supabase functions deploy gedcom-export
supabase functions deploy onboarding-match
supabase functions deploy media-process
```

The project ref is in your project's URL and in **Project Settings →
General**.

## 3. Configure Auth

Open **Authentication → URL Configuration** in the Supabase dashboard.

- Set **Site URL** to your Vercel deploy's URL, for example
  `https://tree.example.com`. You can add this after step 5, once you know
  the final domain, and come back to update it.
- Add `<your-app-url>/auth/callback` to **Redirect URLs**.

To turn on Google sign-in, open **Authentication → Sign In / Providers →
Google**. Turn it on, then paste in the client ID and secret from the OAuth
client you created in `README.md` step 1. Its authorized redirect URI must
be `<your-supabase-url>/auth/v1/callback`, copied from this same page.

To send real magic-link and invitation emails, open **Project Settings →
Auth → SMTP Settings**. Turn on **Enable Custom SMTP** and enter your
provider's settings. Skip this only for a small trial where Supabase's
built-in rate limit (a few emails an hour) is enough.

## 4. Deploy the web app to Vercel

1. At [vercel.com](https://vercel.com), import the Rootward GitHub
   repository as a new project.
2. Set the project's **Root Directory** to `apps/web`. Vercel detects the
   pnpm workspace and installs from the repository root automatically.
3. Add the environment variables from `README.md`'s table:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, and `NEXT_PUBLIC_SITE_URL`
   (Vercel's own deploy URL, or your custom domain once you add one).
4. Deploy.

`apps/web/next.config.ts` sets `output: "standalone"` for the Docker
self-host path. Vercel uses its own build and tracing pipeline and ignores
this setting, so it has no effect here.

## 5. Add a custom domain (optional)

Add your domain in the Vercel project's **Settings → Domains**. Then update
three places to match it:

- `NEXT_PUBLIC_SITE_URL` in the Vercel project's environment variables.
- **Site URL** and **Redirect URLs** in Supabase **Authentication → URL
  Configuration** (step 3 above).
- The OAuth client's authorized redirect URI, if you use Google sign-in
  (this one does not change — it always points at Supabase, not at your
  domain).

Redeploy the Vercel project after an environment variable change — Next.js
reads `NEXT_PUBLIC_*` variables at build time.

## 6. Bootstrap the first admin

Follow `README.md`'s "Bootstrap the first admin" section. Sign in at
`/login` with the address in `ADMIN_EMAIL`.

## Updating a deployment

Push migrations and functions the same way as the first deploy:

```sh
supabase db push
supabase functions deploy <changed-function-name>
```

Vercel redeploys automatically on every push to `main`, through its GitHub
integration.
