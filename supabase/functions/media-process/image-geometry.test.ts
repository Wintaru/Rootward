import { assertEquals } from "@std/assert";

import { computeTargetSize } from "./image-geometry.ts";

Deno.test("computeTargetSize: already fits, returned unchanged", () => {
  assertEquals(computeTargetSize({ width: 100, height: 50 }, 240), {
    width: 100,
    height: 50,
  });
});

Deno.test("computeTargetSize: exactly at the cap is unchanged", () => {
  assertEquals(computeTargetSize({ width: 240, height: 120 }, 240), {
    width: 240,
    height: 120,
  });
});

Deno.test("computeTargetSize: scales the longer side down, landscape", () => {
  assertEquals(computeTargetSize({ width: 4000, height: 2000 }, 1200), {
    width: 1200,
    height: 600,
  });
});

Deno.test("computeTargetSize: scales the longer side down, portrait", () => {
  assertEquals(computeTargetSize({ width: 2000, height: 4000 }, 1200), {
    width: 600,
    height: 1200,
  });
});

Deno.test("computeTargetSize: never upscales a small image", () => {
  assertEquals(computeTargetSize({ width: 10, height: 10 }, 240), {
    width: 10,
    height: 10,
  });
});

Deno.test("computeTargetSize: never rounds a dimension to zero", () => {
  const target = computeTargetSize({ width: 10000, height: 1 }, 240);
  assertEquals(target.width, 240);
  assertEquals(target.height >= 1, true);
});
