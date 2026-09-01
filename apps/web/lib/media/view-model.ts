import { formatRowDate } from "@/lib/db/genealogy-date";
import type { MediaDetail } from "@/lib/db/media";
import type { MediaOwner } from "@/lib/db/types";

/**
 * Pure view model for `/media/[mediaId]` (SPEC §8.3, §10 item 34) — mirrors
 * `person/view-model.ts`'s split (a pure builder + a thin presentational
 * component) so every string and URL choice lives here, unit-testable
 * without a runtime.
 */

/** MIME types a browser renders natively in `<img>` — used only as a
 * fallback when `media-process` produced no display derivative for this file
 * (a GIF: no codec, so the original is kept as-is and is itself already
 * browser-renderable — see `processor.ts`'s "no thumbnail codec" branch).
 * HEIC is deliberately absent: browsers cannot render it directly, so a HEIC
 * item with no derivative has no inline image at all, only a download link. */
const NATIVELY_RENDERABLE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const OWNER_LABEL: Readonly<Record<Exclude<MediaOwner, "person">, string>> = {
  event: "An event",
  fact: "A fact",
  family: "A family record",
  source: "A source",
  place: "A place",
};

export interface MediaLinkLine {
  readonly id: string;
  readonly label: string;
  /** `/person/<id>` for a person-owned link; `null` for every other owner
   * type — none has its own detail route yet (see `getMediaDetail`'s doc). */
  readonly href: string | null;
  readonly isPrimary: boolean;
  readonly caption: string | null;
}

export interface MediaDetailView {
  readonly id: string;
  readonly title: string;
  readonly date: string | null;
  readonly mimeType: string | null;
  readonly sizeLabel: string | null;
  /** A URL the page can put straight in `<img src>`, preferring the ~1200px
   * display derivative and falling back to the original only for a MIME the
   * browser renders unassisted; `null` means "offer a download link
   * instead," not "this failed to load." */
  readonly imageUrl: string | null;
  readonly downloadUrl: string | null;
  readonly links: readonly MediaLinkLine[];
}

export function buildMediaDetailView(
  data: MediaDetail,
  signedDisplayUrl: string | null,
  signedOriginalUrl: string | null,
): MediaDetailView {
  const nativelyRenderable =
    data.mimeType !== null && NATIVELY_RENDERABLE_MIME.has(data.mimeType);
  const imageUrl =
    signedDisplayUrl ?? (nativelyRenderable ? signedOriginalUrl : null);

  return {
    id: data.id,
    title:
      data.title?.trim() || data.originalFilename?.trim() || "Untitled media",
    date: formatRowDate(data.date) || null,
    mimeType: data.mimeType,
    sizeLabel: formatByteSize(data.sizeBytes),
    imageUrl,
    downloadUrl: signedOriginalUrl,
    links: data.links.map((link) => ({
      id: link.id,
      label:
        link.ownerType === "person"
          ? (link.personName ?? "Unknown person")
          : OWNER_LABEL[link.ownerType],
      href: link.ownerType === "person" ? `/person/${link.ownerId}` : null,
      isPrimary: link.isPrimary,
      caption: link.caption,
    })),
  };
}

function formatByteSize(bytes: number | null): string | null {
  if (bytes === null) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}
