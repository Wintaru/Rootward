import { formatGenealogyDate, parseGenealogyDate } from "@rootward/shared";

/**
 * Pure preview logic behind the `DateInput` component (SPEC §8.3, WAYFINDER
 * decision 22): live-parse the raw text and say what will be saved, so
 * "shows a correct interpretation for every `date_kind`" is testable without
 * rendering React. `DateInput.tsx` calls this on every keystroke; it does not
 * re-implement any of it.
 */

export interface DateInterpretation {
  /** `formatGenealogyDate`'s display string, or `""` for a blank field. */
  readonly preview: string;
  /** `true` when the input did not parse into a structured date and will
   * save as `date_kind: "phrase"` — covers both a genuinely unparseable
   * string and a deliberate `(free text)` phrase, since the data model does
   * not distinguish the two (SPEC §8.3: "Unparsed → saved as `phrase`,
   * flagged"). */
  readonly flagged: boolean;
}

export function interpretDateInput(raw: string): DateInterpretation {
  if (raw.trim() === "") {
    return { preview: "", flagged: false };
  }
  const fields = parseGenealogyDate(raw);
  return {
    preview: formatGenealogyDate(fields),
    flagged: fields.date_kind === "phrase",
  };
}
