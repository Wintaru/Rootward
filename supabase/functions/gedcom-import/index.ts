/**
 * `gedcom-import` edge function (SPEC §7, issue #14) — the Deno runtime shell.
 *
 * Thin on purpose: verify the caller, build the service-role gateway, hand off
 * to {@link runImport}. All import logic — phases, batching, resume — lives in
 * the portable `importer.ts`, which the test suite drives directly.
 *
 * Request:  `POST { "jobId": "<uuid>" }`
 * Auth:     a moderator/admin user JWT, or the service-role key (self-reinvoke).
 * Response: `{ status, processedRecords, totalRecords, stats }`.
 */

import { createClient } from "@supabase/supabase-js";

import { createSupabaseGateway } from "./gateway.ts";
import { runImport } from "./importer.ts";

declare const EdgeRuntime:
  | { waitUntil(promise: Promise<unknown>): void }
  | undefined;

/** Stop and yield the invocation after this long, well inside the wall limit. */
const BUDGET_MS = 20_000;
const BATCH_SIZE = 100;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(`missing env ${name}`);
  }
  return value;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");

  const token = (req.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (token === "") {
    return json({ error: "unauthorized" }, 401);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!(await sameSecret(token, serviceRoleKey))) {
    const authed = await isActiveModerator(
      supabaseUrl,
      anonKey,
      serviceRoleKey,
      token,
    );
    if (!authed) {
      return json({ error: "moderator access required" }, 403);
    }
  }

  let jobId: string;
  try {
    const body = (await req.json()) as { jobId?: unknown };
    if (typeof body.jobId !== "string") {
      return json({ error: "jobId (string) required" }, 400);
    }
    jobId = body.jobId;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const reinvoke = async (): Promise<void> => {
    const call = fetch(`${supabaseUrl}/functions/v1/gedcom-import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId }),
    });
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(call.catch(() => undefined));
    } else {
      await call.catch(() => undefined);
    }
  };

  try {
    const outcome = await runImport({
      jobId,
      gateway: createSupabaseGateway(service),
      now: () => Date.now(),
      budgetMs: BUDGET_MS,
      batchSize: BATCH_SIZE,
      reinvoke,
    });
    return json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ status: "failed", error: message }, 500);
  }
});

/** Constant-time compare of two secrets (SHA-256 digests, so length does not
 * leak and the byte compare runs over a fixed 32 bytes). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff === 0;
}

/** True when `token` belongs to an active moderator/admin account. */
async function isActiveModerator(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  token: string,
): Promise<boolean> {
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await asUser.auth.getUser();
  if (error !== null || data.user === null) {
    return false;
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: account } = await service
    .from("account")
    .select("role,status")
    .eq("id", data.user.id)
    .single();
  const row = account as { role?: string; status?: string } | null;
  return (
    row !== null &&
    row.status === "active" &&
    (row.role === "moderator" || row.role === "admin")
  );
}
