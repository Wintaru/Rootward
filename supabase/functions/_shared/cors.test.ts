/**
 * The preflight contract, and the guard that keeps it in one place.
 *
 * `corsPreflightResponse` is deliberately not selective, so these tests do not
 * pin a header list -- pinning one here would rebuild the same literal the
 * function exists to avoid. They assert the property instead: whatever a
 * browser asks for comes back allowed.
 */

import { assert, assertEquals } from "@std/assert";

import { corsPreflightResponse } from "./cors.ts";

const FUNCTIONS = new URL("../", import.meta.url);

function preflight(requestedHeaders?: string): Response {
  const headers = new Headers({
    Origin: "https://donner.rootward.family",
    "Access-Control-Request-Method": "POST",
  });
  if (requestedHeaders !== undefined) {
    headers.set("Access-Control-Request-Headers", requestedHeaders);
  }
  return corsPreflightResponse(
    new Request("https://example.test/gedcom-import", {
      method: "OPTIONS",
      headers,
    }),
  );
}

Deno.test("a preflight allows every header it asked for", () => {
  // What `supabase.functions.invoke` sends from a browser today: the two from
  // the client constructor, `X-Client-Info` from its default global headers,
  // and the body's content type. It is an example, not the contract.
  const requested = "authorization, apikey, x-client-info, content-type";
  const allowed = preflight(requested).headers.get(
    "Access-Control-Allow-Headers",
  );

  assertEquals(allowed, requested);
});

Deno.test("a preflight allows a header the SDK has not sent before", () => {
  const allowed = preflight("x-region").headers.get(
    "Access-Control-Allow-Headers",
  );

  assertEquals(allowed, "x-region");
});

Deno.test("a preflight varies on the request headers it echoes", () => {
  assertEquals(
    preflight("authorization").headers.get("Vary"),
    "Access-Control-Request-Headers",
  );
});

Deno.test("a bare OPTIONS gets no allow-list", () => {
  const response = preflight();

  assertEquals(response.headers.get("Access-Control-Allow-Headers"), null);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("no function shell carries its own CORS headers", async () => {
  const shells: string[] = [];
  for await (const entry of Deno.readDir(FUNCTIONS)) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;
    shells.push(entry.name);
  }
  assert(shells.length > 0, "found no function directories to check");

  for (const name of shells) {
    const source = await Deno.readTextFile(
      new URL(`${name}/index.ts`, FUNCTIONS),
    );

    // Case-insensitive: HTTP header names are, so a lowercase literal is a
    // working copy that a `.includes("Access-Control-")` would wave through.
    assert(
      !/access-control-/i.test(source),
      `${name}/index.ts declares its own CORS header -- import _shared/cors.ts instead`,
    );

    // Unquoted `OPTIONS` on purpose. The narrower `'"OPTIONS"'` misses a
    // shell that routes preflight through a constant or a switch, and the
    // false positive it trades for -- "you named OPTIONS, use the helper" --
    // is the direction worth failing in.
    if (source.includes("OPTIONS")) {
      assert(
        source.includes("corsPreflightResponse"),
        `${name}/index.ts answers OPTIONS without _shared/cors.ts`,
      );
      // The preflight is half the contract. A shell that answers OPTIONS but
      // drops CORS_HEADERS from its real responses passes preflight in a
      // browser and then fails the POST with no allow-origin -- the same
      // production-only failure this module exists to remove.
      assert(
        source.includes("CORS_HEADERS"),
        `${name}/index.ts sends no CORS headers on its real responses`,
      );
    }
  }
});
