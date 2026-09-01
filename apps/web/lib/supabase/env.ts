/**
 * Supabase connection settings that are safe in the browser, read from the
 * environment at call time. The service-role key lives in `service.ts` behind
 * `server-only`, never here.
 *
 * Lazy on purpose: reading `process.env` inside the factory functions (not at
 * module load) keeps `next build` working when the build runs without a `.env`,
 * and still fails loudly the moment a client is actually constructed without
 * its configuration.
 */

export function requireEnv(name: string): string {
  return requireEnvValue(name, process.env[name]);
}

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and fill it in (supabase status -o env prints the local keys).`,
    );
  }
  return value;
}

/**
 * Public REST/Realtime URL. Safe in the browser.
 *
 * A literal `process.env.NEXT_PUBLIC_*` access, not `requireEnv`'s dynamic
 * `process.env[name]` -- Next.js/Turbopack only inlines the *literal* form
 * into the client bundle at build time; a computed lookup evaluates against
 * an empty stub in the browser, so `requireEnv("NEXT_PUBLIC_SUPABASE_URL")`
 * here always threw "missing", even with `.env` filled in correctly. Server
 * components and `server-only` files (e.g. `service.ts`'s
 * `SUPABASE_SERVICE_ROLE_KEY`) run in real Node.js and have no such
 * restriction, so `requireEnv` stays dynamic for them.
 */
export function supabaseUrl(): string {
  return requireEnvValue(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/** Anon key — RLS applies to every request made with it. Safe in the browser. */
export function supabaseAnonKey(): string {
  return requireEnvValue(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
