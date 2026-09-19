import { env } from "./env";

/**
 * Whether the local stack can actually run the GEDCOM edge functions.
 *
 * `supabase start` bakes an edge runtime that mounts only
 * `supabase/functions`, while `deno.json` maps `@rootward/*` to
 * `../../packages/*` — so `gedcom-import` and `gedcom-export` cannot boot
 * there and every call answers 503 (see `supabase/functions/README.md`,
 * "Serving locally"). The fix is to serve them with the import map named:
 *
 *     supabase functions serve --import-map supabase/functions/deno.json
 *
 * The suite probes once and skips the export tests with that instruction
 * rather than reporting an environment gap as a product failure.
 */
let cached: Promise<boolean> | null = null;

export function gedcomFunctionsAvailable(): Promise<boolean> {
  cached ??= probe();
  return cached;
}

async function probe(): Promise<boolean> {
  try {
    const response = await fetch(
      `${env.supabaseUrl}/functions/v1/gedcom-export`,
      {
        method: "POST",
        headers: {
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: "00000000-0000-4000-8000-000000000000" }),
      },
    );
    // 503 is the boot failure. Anything else (401/400/500 from the function's
    // own code) means the worker started, which is all this checks.
    return response.status !== 503;
  } catch {
    return false;
  }
}

export const SERVE_HINT =
  "The GEDCOM edge functions are not bootable on this stack (HTTP 503). " +
  "Serve them with: supabase functions serve --import-map supabase/functions/deno.json";
