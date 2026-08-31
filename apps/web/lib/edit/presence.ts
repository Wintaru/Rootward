import { EDIT_SECTIONS, type EditSectionSlug } from "./sections";

/**
 * Pure presence logic for the edit view (SPEC §8.3 / §8.5, WAYFINDER decision
 * 26, §10 item 32). Framework- and Realtime-client-free so the parsing and
 * formatting are unit-testable without a live channel; the client component
 * (`components/person/edit/PresenceBanner.tsx`) owns the channel lifecycle
 * and calls into this.
 */

/** The payload every editor tracks on the `person:{id}` channel. */
export interface EditPresenceUser {
  readonly userId: string;
  readonly displayName: string;
  readonly section: EditSectionSlug;
}

export type EditPresenceEntry = EditPresenceUser;

/** `person:{id}` — the Realtime channel decision 26 names. */
export function presenceChannelName(personId: string): string {
  return `person:${personId}`;
}

/**
 * The Realtime client tracks presence by key (here, `userId`), with one array
 * entry per open connection under that key — a second tab from the same
 * editor shows up as a second entry. `channel.presenceState()` returns this
 * shape untyped; parse it defensively (a malformed, foreign-shaped, or
 * out-of-range `section` is dropped, not thrown on — `is_moderator()` RLS on
 * `realtime.messages` (see the migration) keeps a non-moderator from tracking
 * at all, but a payload shape this loose is worth validating regardless) and
 * take the last entry per key as that editor's likely-current section. Real
 * presence carries no per-update timestamp, so "last" here means join order
 * for a second open tab under the same key, not necessarily whichever tab
 * they're actually looking at right now.
 */
export function describeOtherEditors(
  state: Readonly<Record<string, readonly unknown[]>>,
  selfUserId: string,
): readonly EditPresenceEntry[] {
  const entries: EditPresenceEntry[] = [];

  for (const [key, presences] of Object.entries(state)) {
    if (key === selfUserId || presences.length === 0) {
      continue;
    }
    const latest = presences[presences.length - 1];
    if (isEditPresenceUser(latest)) {
      entries.push(latest);
    }
  }

  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function isEditPresenceUser(value: unknown): value is EditPresenceUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<EditPresenceUser>;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.displayName === "string" &&
    EDIT_SECTIONS.some((section) => section.slug === candidate.section)
  );
}
