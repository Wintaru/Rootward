import { describe, expect, it } from "vitest";

import {
  ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
  SQLSTATE_UNIQUE_VIOLATION,
  isUniqueViolationOn,
} from "./db-constraints.ts";

/**
 * The real message PostgREST forwards for this collision, captured from the
 * local stack. Both call sites depend on the constraint name appearing in it.
 */
const REAL_MESSAGE =
  'duplicate key value violates unique constraint "access_request_one_pending_per_account"';

describe("isUniqueViolationOn", () => {
  it("matches the collision the access_request index actually produces", () => {
    expect(
      isUniqueViolationOn(
        { code: SQLSTATE_UNIQUE_VIOLATION, message: REAL_MESSAGE },
        ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
      ),
    ).toBe(true);
  });

  it("rejects a unique violation on a different constraint", () => {
    // The whole point of checking the name: another unique index on the same
    // table must not be swallowed as "already on file".
    expect(
      isUniqueViolationOn(
        {
          code: SQLSTATE_UNIQUE_VIOLATION,
          message:
            'duplicate key value violates unique constraint "access_request_pkey"',
        },
        ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
      ),
    ).toBe(false);
  });

  it("rejects a different error that happens to quote the name", () => {
    expect(
      isUniqueViolationOn(
        { code: "42501", message: `permission denied near ${REAL_MESSAGE}` },
        ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
      ),
    ).toBe(false);
  });

  it("returns false for no error", () => {
    expect(
      isUniqueViolationOn(null, ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT),
    ).toBe(false);
  });

  it("tolerates a missing or null message", () => {
    expect(
      isUniqueViolationOn(
        { code: SQLSTATE_UNIQUE_VIOLATION, message: null },
        ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
      ),
    ).toBe(false);
    expect(
      isUniqueViolationOn(
        { code: SQLSTATE_UNIQUE_VIOLATION },
        ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT,
      ),
    ).toBe(false);
  });
});
