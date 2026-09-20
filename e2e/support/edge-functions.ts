import { env } from "./env";

/**
 * Whether the local stack can actually boot a given edge function.
 *
 * `supabase start` bakes an edge runtime that mounts only
 * `supabase/functions`, while `deno.json` maps `@rootward/*` to
 * `../../packages/*` — so the functions cannot boot there and every call
 * answers 503 (see `supabase/functions/README.md`, "Serving locally"). The
 * fix is to serve them with the import map named:
 *
 *     supabase functions serve --import-map supabase/functions/deno.json
 *
 * The suite probes once per function and skips the tests that need one with
 * that instruction, rather than reporting an environment gap as a product
 * failure.
 */
const cache = new Map<string, Promise<boolean>>();

export function edgeFunctionBootable(name: string): Promise<boolean> {
  let probed = cache.get(name);
  if (probed === undefined) {
    probed = probe(name);
    cache.set(name, probed);
  }
  return probed;
}

/** The GEDCOM export path. Import and export share a runtime, so one probe
 * answers for both. */
export function gedcomFunctionsAvailable(): Promise<boolean> {
  return edgeFunctionBootable("gedcom-export");
}

/** The media upload path (`MediaSection`'s file input). */
export function mediaProcessAvailable(): Promise<boolean> {
  return edgeFunctionBootable("media-process");
}

async function probe(name: string): Promise<boolean> {
  try {
    const response = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    // 503 is the boot failure. Anything else (401/400/500 from the function's
    // own code) means the worker started, which is all this checks.
    return response.status !== 503;
  } catch {
    return false;
  }
}

export const SERVE_HINT =
  "The edge functions are not bootable on this stack (HTTP 503). " +
  "Serve them with: supabase functions serve --import-map supabase/functions/deno.json";
