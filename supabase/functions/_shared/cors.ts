/**
 * CORS for the four `Deno.serve` shells (SPEC §7). Every function is invoked
 * from the browser through `supabase.functions.invoke`, so a preflight that
 * refuses a header the SDK sends makes the function unreachable from the app
 * while `curl` still works -- which is how the GEDCOM import failed on the
 * first hosted deploy with `x-client-info is not allowed`.
 *
 * Shared rather than copied per function: the four shells had four identical
 * literals, so the next one to be added starts from whichever copy was pasted.
 * `cors.test.ts` asserts no `index.ts` grows its own.
 */

/** Sent on every response, preflight and real. */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Answer a preflight by echoing back whatever headers it asked for.
 *
 * A literal allow-list is the obvious alternative and is what broke: the set
 * is `supabase-js`'s, not ours. `Authorization` and `apikey` come from the
 * client constructor, `X-Client-Info` from its default global headers, and
 * `x-region` appears only when a region is configured -- so an SDK upgrade can
 * add a header no test here would catch, and the failure shows up only in a
 * browser, only in production.
 *
 * Echoing grants nothing new. `Access-Control-Allow-Origin: *` already forbids
 * the browser from attaching cookies, and each function authenticates the
 * bearer token itself before it does any work. CORS never was the boundary
 * here -- it only decides whether a browser is willing to show the caller a
 * response it could have fetched with `curl` regardless.
 *
 * `Vary` is what keeps that honest: the response now depends on a request
 * header, so a cache told nothing would serve one caller's allow-list to the
 * next. A bare `OPTIONS` (a probe, a health check) asks for no headers and
 * gets no allow-list, which is the correct answer to that question.
 */
export function corsPreflightResponse(request: Request): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    Vary: "Access-Control-Request-Headers",
  };

  const requested = request.headers.get("Access-Control-Request-Headers");
  if (requested !== null) {
    headers["Access-Control-Allow-Headers"] = requested;
  }

  return new Response(null, { headers });
}
