import type { UnionFamilyEditRow } from "@/lib/db/family-edit";
import {
  unionEndedLabel,
  unionSegment,
  unionTypeLabel,
} from "@/lib/person/labels";

/**
 * The status line on a Relationships union card (issue #122): what the union
 * is and when it began, and — once it has ended — how and when. Whether it
 * ended is `endedBy`, the server's call (`family_ended_by`); this only finds
 * that event for its date. Dates are the rows' raw text (`dateRaw`, exactly
 * what the Events section shows), not re-formatted.
 */
export interface UnionStatusLine {
  /** `"Married — 12 Jun 1990, Springfield"` · `"Married"` · `null`. */
  readonly standing: string | null;
  /** `"Divorced — 2003, Reno"` · `"Divorced"` · `null` while it stands. */
  readonly ended: string | null;
}

export function unionStatusLine(
  union: Pick<UnionFamilyEditRow, "relationshipType" | "endedBy" | "events">,
): UnionStatusLine {
  const marriage = union.events.find((event) => event.type === "marriage");
  const standing = unionSegment(
    unionTypeLabel(union.relationshipType),
    marriage?.dateRaw || null,
    marriage?.placeName ?? null,
  );
  if (union.endedBy === null) {
    return { standing, ended: null };
  }
  const endEvent = union.events.find((event) => event.type === union.endedBy);
  return {
    standing,
    ended: unionSegment(
      unionEndedLabel(union.endedBy),
      endEvent?.dateRaw || null,
      endEvent?.placeName ?? null,
    ),
  };
}
