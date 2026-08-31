"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  describeOtherEditors,
  presenceChannelName,
  type EditPresenceEntry,
  type EditPresenceUser,
} from "@/lib/edit/presence";
import { editSectionLabel } from "@/lib/edit/sections";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Presence banner for the edit view (SPEC §8.3 / §8.5, WAYFINDER decision 26,
 * §10 item 32). Joins the `person:{id}` Realtime channel on mount, tracks
 * `{ userId, displayName, section }`, and lists every other editor currently
 * on this person and which section they're in.
 *
 * The channel is joined once per person + identity and kept open across a
 * section switch — `self` changing re-tracks the existing connection instead
 * of leaving and rejoining, so other subscribers see one continuous presence
 * with an updated section rather than a leave/join flicker. Unmounting (the
 * "Done" link navigates away, or the whole route unmounts) removes the
 * channel; Realtime's own `leave` event tells every other subscriber, so no
 * explicit "I'm leaving" call is needed here.
 *
 * `private: true` (decision 6: nothing is public, RLS is the access
 * boundary — a non-private channel is authorized by nothing at all, since
 * Supabase only evaluates `realtime.messages` RLS for a private one) plus the
 * `is_moderator()` policies in `20260831230616_edit_presence_authorization.sql`
 * put the same boundary in front of this channel that the edit route itself
 * enforces — caught in code review, see `DECISIONS.md`.
 */
export function PresenceBanner({
  personId,
  self,
}: {
  readonly personId: string;
  readonly self: EditPresenceUser;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [others, setOthers] = useState<readonly EditPresenceEntry[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const selfRef = useRef(self);

  // Join once per person + identity. `on("presence", …)` implicitly enables
  // this client to receive presence state (Realtime buffers it otherwise).
  useEffect(() => {
    const channel = supabase.channel(presenceChannelName(personId), {
      config: { private: true, presence: { key: self.userId } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        setOthers(describeOtherEditors(channel.presenceState(), self.userId));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track(selfRef.current);
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // `self` beyond `userId` is handled by the re-track effect below, not a
    // rejoin — rejoining on every section switch would flicker a leave/join
    // for every other subscriber instead of a smooth section update. Reading
    // `selfRef.current` above (not `self` directly) is what keeps this
    // exhaustive-deps clean without needing to suppress the rule.
  }, [supabase, personId, self.userId]);

  // Re-track on a section (or display-name) change without rejoining. Also
  // keeps `selfRef` current for the join effect's first `track()` call above.
  // Depends on the primitive fields, not `self` by reference — `self` is a
  // fresh object literal from `EditShell` (a server component) on every
  // render, including one triggered by something unrelated to identity or
  // section, and re-tracking on every one of those would be a wasted round
  // trip for no visible change.
  useEffect(() => {
    selfRef.current = self;
    const channel = channelRef.current;
    if (channel !== null && channel.state === "joined") {
      void channel.track(self);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `self` itself is intentionally not a dep; see above.
  }, [self.userId, self.displayName, self.section]);

  if (others.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="border-border bg-accent/50 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm"
    >
      {others.map((entry) => (
        <p key={entry.userId}>
          <span className="font-medium">{entry.displayName}</span> is editing{" "}
          {editSectionLabel(entry.section)}
        </p>
      ))}
    </div>
  );
}
