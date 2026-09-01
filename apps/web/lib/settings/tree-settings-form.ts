/**
 * Pure validation for the `/settings` tree-settings form (SPEC §4.6, §10 item
 * 37). No Supabase client, no `next` import — unit-tested without a runtime,
 * mirroring `lib/moderation/invite.ts`. The side-effecting save lives in
 * `app/settings/actions.ts`.
 */

import { MAX_GENERATIONS, type TreeSettingsPatch } from "@/lib/db";
import { isUuid } from "@/lib/db/uuid";

export type { TreeSettingsPatch };

/** The raw form fields — every numeric/list value is still a string, exactly
 * as an `<input>` hands it back. */
export interface RawTreeSettingsInput {
  readonly treeName: string;
  readonly treeDescription: string;
  readonly allowSelfSignup: boolean;
  readonly livingThresholdYears: string;
  readonly defaultRootPersonId: string;
  readonly defaultGenerationsUp: string;
  readonly defaultGenerationsDown: string;
  readonly mediaMaxBytes: string;
  readonly mediaAllowedMime: string;
  readonly stripExifGps: boolean;
}

export type TreeSettingsValidation =
  | { readonly ok: true; readonly value: TreeSettingsPatch }
  | { readonly ok: false; readonly error: string };

// `smallint` is the column type for `living_threshold_years` (SPEC §4.6) —
// the bound here is the real storage limit, not a guessed product rule.
const SMALLINT_MAX = 32767;

// A loose `type/subtype` shape, matching the informal grammar RFC 6838 media
// types follow. `media-process`'s `mediaAllowedMime.includes(mimeType)` check
// (SPEC §7) is an exact string match with no wildcards, so this only needs to
// catch an obvious typo before it silently blocks every upload of that type.
const MIME_RE = /^[a-z0-9][a-z0-9!#$&\-^_.+]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/i;

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseIntInRange(
  value: string,
  min: number,
  max: number,
): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

/** Split on commas or newlines, trim, drop blanks, de-dupe — the admin can
 * paste a comma list or write one MIME type per line and get the same
 * result. */
function parseMimeList(raw: string): readonly string[] | null {
  const items = raw
    .split(/[,\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  const unique = Array.from(new Set(items));
  if (unique.length === 0 || !unique.every((item) => MIME_RE.test(item))) {
    return null;
  }
  return unique;
}

export function validateTreeSettingsForm(
  raw: RawTreeSettingsInput,
): TreeSettingsValidation {
  const livingThresholdYears = parseIntInRange(
    raw.livingThresholdYears,
    1,
    SMALLINT_MAX,
  );
  if (livingThresholdYears === null) {
    return {
      ok: false,
      error:
        "The living-person threshold must be a whole number of years, at least 1.",
    };
  }

  const defaultGenerationsUp = parseIntInRange(
    raw.defaultGenerationsUp,
    0,
    MAX_GENERATIONS,
  );
  const defaultGenerationsDown = parseIntInRange(
    raw.defaultGenerationsDown,
    0,
    MAX_GENERATIONS,
  );
  if (defaultGenerationsUp === null || defaultGenerationsDown === null) {
    return {
      ok: false,
      error: `Generations up and down must each be a whole number between 0 and ${String(MAX_GENERATIONS)}.`,
    };
  }

  const mediaMaxBytes = parseIntInRange(
    raw.mediaMaxBytes,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (mediaMaxBytes === null) {
    return {
      ok: false,
      error:
        "The maximum upload size must be a whole number of bytes, greater than zero.",
    };
  }

  const mediaAllowedMime = parseMimeList(raw.mediaAllowedMime);
  if (mediaAllowedMime === null) {
    return {
      ok: false,
      error:
        "Allowed media types must be a list of MIME types (like image/jpeg), one per line or comma-separated, with at least one entry.",
    };
  }

  const defaultRootPersonIdRaw =
    blankToNull(raw.defaultRootPersonId)?.toLowerCase() ?? null;
  if (defaultRootPersonIdRaw !== null && !isUuid(defaultRootPersonIdRaw)) {
    return {
      ok: false,
      error:
        "The default root person must be a person ID (a UUID), or left blank.",
    };
  }

  return {
    ok: true,
    value: {
      treeName: blankToNull(raw.treeName),
      treeDescription: blankToNull(raw.treeDescription),
      allowSelfSignup: raw.allowSelfSignup,
      livingThresholdYears,
      defaultRootPersonId: defaultRootPersonIdRaw,
      defaultGenerationsUp,
      defaultGenerationsDown,
      mediaMaxBytes,
      mediaAllowedMime,
      stripExifGps: raw.stripExifGps,
    },
  };
}
