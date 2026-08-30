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
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and fill it in (supabase status -o env prints the local keys).`,
    );
  }
  return value;
}

/** Public REST/Realtime URL. Safe in the browser. */
export function supabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

/** Anon key — RLS applies to every request made with it. Safe in the browser. */
export function supabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
