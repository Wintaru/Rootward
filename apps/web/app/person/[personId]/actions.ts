"use server";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { isUuid, requestHide } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * "Ask a moderator to hide this record" (SPEC §5/§7, decisions 7/14/27, issue
 * #61). Any approved account may call this -- the person-or-their-parent
 * check is the `request_hide` SQL function's own boundary (see
 * `lib/db/hide-request.ts`), not re-verified here. The button that calls this
 * action is only ever shown to a linked viewer or a linked parent
 * (`PersonProfile.tsx`), but that is convenience, not the gate.
 */
export type RequestHideActionResult =
  | { readonly status: "sent" }
  | { readonly status: "error"; readonly message: string };

export async function requestHideAction(input: {
  readonly personId: string;
  readonly reason: string;
}): Promise<RequestHideActionResult> {
  const current = await getCurrentAccount();
  if (current === null || !isApproved(current.account)) {
    return {
      status: "error",
      message: "You do not have permission to do that.",
    };
  }
  if (!isUuid(input.personId)) {
    return { status: "error", message: "Invalid person." };
  }

  const supabase = await createSupabaseServerClient();
  try {
    await requestHide(
      supabase,
      input.personId,
      input.reason.trim() === "" ? undefined : input.reason.trim(),
    );
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error ? err.message : "That request could not be sent.",
    };
  }

  return { status: "sent" };
}
