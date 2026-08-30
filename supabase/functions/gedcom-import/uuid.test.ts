import { assert, assertEquals, assertNotEquals } from "@std/assert";

import { uuidv5 } from "./uuid.ts";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const UUID_V5_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

Deno.test("matches the RFC 4122 v5 reference vector", async () => {
  assertEquals(
    await uuidv5("www.example.com", DNS_NAMESPACE),
    "2ed6657d-e927-568b-95e1-2665a8aea6a2",
  );
});

Deno.test("is deterministic and namespace-scoped", async () => {
  const a = await uuidv5("@I1@", DNS_NAMESPACE);
  assertEquals(a, await uuidv5("@I1@", DNS_NAMESPACE));
  assertNotEquals(a, await uuidv5("@I2@", DNS_NAMESPACE));
  assertNotEquals(
    a,
    await uuidv5("@I1@", "00000000-0000-4000-8000-000000000000"),
  );
});

Deno.test("emits a well-formed v5 UUID", async () => {
  assert(UUID_V5_RE.test(await uuidv5("place|boston", DNS_NAMESPACE)));
});
