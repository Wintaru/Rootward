import { CALENDARS, GENEALOGY_DATE_KINDS } from "@rootward/shared";
import { describe, expect, it } from "vitest";

import { Constants } from "./database.types";

/**
 * `@rootward/shared` restates the `genealogy_date_kind` and `calendar` Postgres
 * enums as `as const` unions (`packages/shared/src/genealogy-date.ts`) because it
 * must not import the generated DB types. This is the cross-package sync guard
 * that #11 deferred to the first web-app consumer of the module: it fails when
 * the shared copy drifts from the generated schema.
 *
 * The migrations are the authority; `database.types.ts` is regenerated from them
 * and drift-checked in CI, so comparing against `Constants` is comparing against
 * the schema.
 */
describe("genealogy-date enum parity with the generated schema", () => {
  it("GENEALOGY_DATE_KINDS matches the genealogy_date_kind enum", () => {
    expect([...GENEALOGY_DATE_KINDS].sort()).toEqual(
      [...Constants.public.Enums.genealogy_date_kind].sort(),
    );
  });

  it("CALENDARS matches the calendar enum", () => {
    expect([...CALENDARS].sort()).toEqual(
      [...Constants.public.Enums.calendar].sort(),
    );
  });
});
