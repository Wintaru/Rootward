/**
 * Environment the suite runs against. Everything is read once, here, so a
 * missing value fails at startup with a clear message instead of as a cryptic
 * network error deep inside a test.
 *
 * Values come from the repo-root `.env` (the same file `pnpm dev` loads) —
 * `playwright.config.ts` loads it before the config body runs.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. Run the suite through "pnpm test:e2e" from the repo root ` +
        `so the root .env is loaded, or export it yourself.`,
    );
  }
  return value;
}

export const env = {
  /** The web app under test. */
  baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  /** Supabase local API gateway (Kong). */
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /**
   * Mailpit, where the local stack delivers magic links. The port mirrors
   * `[inbucket].port` in `supabase/config.toml`; override it with
   * `E2E_MAILPIT_URL` rather than editing this default if the two ever
   * diverge.
   */
  mailpitUrl: process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:57324",
} as const;
