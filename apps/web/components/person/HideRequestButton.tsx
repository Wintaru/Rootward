"use client";

import { useId, useState } from "react";

import { requestHideAction } from "@/app/person/[personId]/actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

/**
 * "Ask a moderator to hide this record" (SPEC §5/§7, decisions 7/14/27, issue
 * #61). Shown on a profile only to a viewer linked to that person, or linked
 * to one of their parents (decision 14's "hide my child") --
 * `PersonProfile.tsx` decides that; `request_hide`'s own authorization check
 * is the real boundary regardless.
 */
export function HideRequestButton({ personId }: { readonly personId: string }) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") {
    return (
      <p className="text-muted-foreground text-sm">
        Request sent — a moderator will review it.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        className="w-fit"
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setOpen(true)}
      >
        Ask a moderator to hide this record
      </Button>
    );
  }

  async function handleSend() {
    setStatus("sending");
    setError(null);

    const result = await requestHideAction({ personId, reason });
    if (result.status === "error") {
      setError(result.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border p-3">
      <label htmlFor={reasonId} className="text-sm font-medium">
        Ask a moderator to hide this record
      </label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        rows={3}
        className={inputClass}
      />
      {status === "error" && error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="w-fit"
          size="sm"
          type="button"
          onClick={handleSend}
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending…" : "Send request"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setOpen(false)}
          disabled={status === "sending"}
          className="text-muted-foreground w-fit"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
