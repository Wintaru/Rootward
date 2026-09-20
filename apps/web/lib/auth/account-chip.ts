/**
 * What the header's account chip shows for a member (#79): a short name and
 * one or two initials. Pure, so the header can render it server-side.
 */
export interface ChipIdentity {
  /** First word of the display name, else the email's local part. */
  readonly firstName: string;
  /** One or two upper-case letters; `?` when nothing is known. */
  readonly initials: string;
}

export function chipIdentity(
  displayName: string | null,
  email: string | null,
): ChipIdentity {
  const words = (displayName ?? "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length > 0) {
    const first = words[0] ?? "";
    const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
    return {
      firstName: first,
      initials: `${initialOf(first)}${initialOf(last)}`,
    };
  }
  const local = (email ?? "").split("@")[0] ?? "";
  if (local.length > 0) {
    return { firstName: local, initials: initialOf(local) };
  }
  return { firstName: "Member", initials: "?" };
}

function initialOf(word: string): string {
  const first = [...word][0];
  // `toLocaleUpperCase` can expand one code point to two ("ß" → "SS");
  // keep the first so the disc never shows more than two glyphs.
  return first === undefined ? "" : ([...first.toLocaleUpperCase()][0] ?? "");
}
