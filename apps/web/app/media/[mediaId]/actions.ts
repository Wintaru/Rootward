"use server";

import { revalidatePath } from "next/cache";
import {
  isRotation,
  type CropRect,
  type MediaTransform,
} from "@rootward/media";

import { resolveEditAccess } from "@/lib/auth/require-moderator";
import { applyMediaTransform, derivativePaths } from "@/lib/db/media-transform";
import { isUuid } from "@/lib/db/uuid";
import { removeMediaStorageObjects } from "@/lib/db/wipe-tree";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ApplyMediaTransformActionResult =
  | { readonly status: "saved"; readonly warnings: readonly string[] }
  | { readonly status: "conflict" }
  | { readonly status: "error"; readonly message: string };

/**
 * Commit a rotate/crop (SPEC §8.3, migration `20260914170500`). The browser
 * has already uploaded the regenerated thumb/display pair under `token`
 * (`lib/db/media-transform.ts`); this repoints the row at them with a
 * version-checked update and removes the superseded objects. Moderator
 * gate up front is convenience -- `media_write` RLS and the bucket's
 * `media_moderator_all` policy are the boundary, both enforced on the
 * caller's own session client below.
 *
 * On a lost version check the just-uploaded objects are removed again so a
 * conflict leaves no orphans; a failed cleanup of the *old* objects after a
 * successful update is reported as a warning rather than failing the save
 * (the row already points at the new derivatives -- an orphaned old thumb
 * costs storage, not correctness).
 */
export async function applyMediaTransformAction(input: {
  readonly mediaId: string;
  readonly token: string;
  readonly expectedUpdatedAt: string;
  readonly rotation: number;
  readonly crop: CropRect | null;
}): Promise<ApplyMediaTransformActionResult> {
  const access = await resolveEditAccess();
  if (access.kind !== "allowed") {
    return {
      status: "error",
      message: "You do not have permission to edit media.",
    };
  }
  if (
    !isUuid(input.mediaId) ||
    !isUuid(input.token) ||
    typeof input.expectedUpdatedAt !== "string"
  ) {
    return { status: "error", message: "Invalid media." };
  }
  if (!isRotation(input.rotation)) {
    return { status: "error", message: "Invalid rotation." };
  }
  if (input.crop !== null && !isWholeCrop(input.crop)) {
    return { status: "error", message: "Invalid crop." };
  }
  const transform: MediaTransform = {
    rotation: input.rotation,
    crop: input.crop,
  };
  const paths = derivativePaths(input.mediaId, input.token);

  const supabase = await createSupabaseServerClient();
  const result = await applyMediaTransform(supabase, {
    mediaId: input.mediaId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    transform,
    paths,
  });

  if (!result.ok) {
    try {
      await removeMediaStorageObjects(supabase, [paths.thumb, paths.display]);
    } catch (err: unknown) {
      // The conflict is the outcome to report; a failed cleanup of the
      // never-referenced pair is a storage leak, not a reason to hide it.
      console.error("applyMediaTransformAction: conflict cleanup failed", err);
    }
    return { status: "conflict" };
  }

  const warnings: string[] = [];
  try {
    await removeMediaStorageObjects(supabase, result.replacedPaths);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`The previous thumbnails could not be removed: ${message}`);
  }

  revalidatePath(`/media/${input.mediaId}`);
  return { status: "saved", warnings };
}

/** Mirrors `media_crop_check`: non-negative whole-pixel origin, positive
 * whole-pixel size. */
function isWholeCrop(crop: CropRect): boolean {
  return (
    Number.isInteger(crop.x) &&
    Number.isInteger(crop.y) &&
    Number.isInteger(crop.width) &&
    Number.isInteger(crop.height) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.width > 0 &&
    crop.height > 0
  );
}
