/**
 * `media-process` edge function (SPEC §7, issue #33) -- the Deno runtime
 * shell.
 *
 * Thin on purpose: verify the caller, build the service-role gateway and the
 * real codec/exif tools, hand off to {@link runMediaProcess}. All validation,
 * derivative generation, and EXIF handling lives in the portable
 * `processor.ts`, which the test suite drives directly with fakes.
 *
 * Request:  `POST { ownerType, ownerId, stagingPath, originalFilename }`
 * Auth:     a moderator/admin user JWT, or the service-role key.
 * Response: `{ status, mediaId?, hasDerivatives?, warnings?, reason? }`.
 */

import { createClient } from "@supabase/supabase-js";

import { createSupabaseGateway } from "./gateway.ts";
import { createImageCodec } from "./codec.ts";
import { createExifTools } from "./exif.ts";
import { MEDIA_OWNERS, type MediaOwner, runMediaProcess } from "./processor.ts";

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

  let callerAccountId: string | null = null;
  if (!(await sameSecret(token, serviceRoleKey))) {
    callerAccountId = await activeModeratorId(
      supabaseUrl,
      anonKey,
      serviceRoleKey,
      token,
    );
    if (callerAccountId === null) {
      return json({ error: "moderator access required" }, 403);
    }
  }

  let body: {
    ownerType: MediaOwner;
    ownerId: string;
    stagingPath: string;
    originalFilename: string;
  };
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    if (
      typeof raw.ownerType !== "string" ||
      !MEDIA_OWNERS.includes(raw.ownerType as MediaOwner) ||
      typeof raw.ownerId !== "string" ||
      typeof raw.stagingPath !== "string" ||
      typeof raw.originalFilename !== "string"
    ) {
      return json({
        error:
          "ownerType (media owner), ownerId, stagingPath, originalFilename (all strings) required",
      }, 400);
    }
    body = {
      ownerType: raw.ownerType as MediaOwner,
      ownerId: raw.ownerId,
      stagingPath: raw.stagingPath,
      originalFilename: raw.originalFilename,
    };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const outcome = await runMediaProcess(
      {
        ownerType: body.ownerType,
        ownerId: body.ownerId,
        stagingPath: body.stagingPath,
        originalFilename: body.originalFilename,
        uploadedBy: callerAccountId,
      },
      {
        gateway: createSupabaseGateway(service),
        codec: createImageCodec(),
        exif: createExifTools(),
        newId: () => crypto.randomUUID(),
      },
    );
    return json(outcome, outcome.status === "rejected" ? 422 : 200);
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

/** The caller's `account.id` when the token belongs to an active
 * moderator/admin, else `null`. */
async function activeModeratorId(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  token: string,
): Promise<string | null> {
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await asUser.auth.getUser();
  if (error !== null || data.user === null) {
    return null;
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
  const authed = row !== null &&
    row.status === "active" &&
    (row.role === "moderator" || row.role === "admin");
  return authed ? data.user.id : null;
}
