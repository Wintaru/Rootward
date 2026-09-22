import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT } from "@rootward/shared";

import type { Database } from "./database.types";
import { submitAccessRequest } from "./onboarding";

/**
 * `submitAccessRequest` is idempotent since issue #49: an account may hold only
 * one open request, and a second submission is the same person asking again.
 * These cover the branch that decides whether a collision is success or a
 * failure the person should see.
 */

interface InsertError {
  readonly code: string;
  readonly message: string;
}

/** A client whose single `insert` answers with `error`, and records the row. */
function clientAnswering(error: InsertError | null): {
  readonly client: SupabaseClient<Database>;
  readonly insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(() => Promise.resolve({ error }));
  const from = vi.fn(() => ({ insert }));
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    insert,
  };
}

const input = {
  accountId: "49000000-0000-0000-0000-0000000000a1",
  name: "Ada Lovelace",
  birthMonth: 12,
  birthYear: 1815,
  message: "  please let me in  ",
};

describe("submitAccessRequest", () => {
  it("sends the trimmed row and resolves when the insert succeeds", async () => {
    const { client, insert } = clientAnswering(null);

    await expect(submitAccessRequest(client, input)).resolves.toBe("filed");

    expect(insert).toHaveBeenCalledWith({
      account_id: input.accountId,
      submitted_name: "Ada Lovelace",
      submitted_birth_month: 12,
      submitted_birth_year: 1815,
      message: "please let me in",
    });
  });

  it("reports already_open on a collision rather than throwing", async () => {
    // The person does have a request with a moderator, so this is not an
    // error. It is also not a success: the row they just wrote was dropped,
    // and the caller has to be able to say so.
    const { client } = clientAnswering({
      code: "23505",
      message: `duplicate key value violates unique constraint "${ACCESS_REQUEST_ONE_PENDING_PER_ACCOUNT}"`,
    });

    await expect(submitAccessRequest(client, input)).resolves.toBe(
      "already_open",
    );
  });

  it("still throws on a unique violation from a different constraint", async () => {
    const { client } = clientAnswering({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "access_request_pkey"',
    });

    await expect(submitAccessRequest(client, input)).rejects.toThrow(
      /access_request_pkey/,
    );
  });

  it("still throws when the insert is refused outright", async () => {
    const { client } = clientAnswering({
      code: "42501",
      message: "new row violates row-level security policy",
    });

    await expect(submitAccessRequest(client, input)).rejects.toThrow(
      /row-level security/,
    );
  });

  it("sends null for an empty name and message rather than an empty string", async () => {
    const { client, insert } = clientAnswering(null);

    await expect(
      submitAccessRequest(client, { ...input, name: "   ", message: "" }),
    ).resolves.toBe("filed");

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ submitted_name: null, message: null }),
    );
  });
});
