import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { isApproved } from "@/lib/auth/access";
import { getCurrentAccount } from "@/lib/auth/current-account";
import { getMediaDetail } from "@/lib/db/media";
import { getSignedMediaUrl } from "@/lib/db/media-urls";
import { buildMediaDetailView } from "@/lib/media/view-model";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MediaViewer } from "@/components/media/MediaViewer";

export const metadata: Metadata = {
  title: "Media · Rootward",
};

/**
 * `/media/[mediaId]` — the media viewer (SPEC §8.3, §10 item 34). Approved
 * members only, same gate as `/person/[personId]`.
 *
 * RLS is the real boundary: `getMediaDetail` reads the `media` row under
 * `media_select` (any approved member) and its attachment links under
 * `media_link_select` (`media_link_is_visible`) — an absent or hidden media
 * item comes back `null` → `notFound()`, and a link whose owner the caller
 * cannot see is simply missing from the list rather than shown blank.
 *
 * The display/original signed URLs are minted server-side with the service
 * role (`media-urls.ts`) — the `media` bucket's `storage.objects` policy is
 * moderator-only, so even an approved member's own session cannot sign these
 * paths itself. Only paths `getMediaDetail` already returned (already
 * confirmed visible) are ever passed in.
 */
export default async function MediaPage({
  params,
}: PageProps<"/media/[mediaId]">) {
  const { mediaId } = await params;

  const current = await getCurrentAccount();
  if (current === null) {
    redirect("/login");
  }
  if (!isApproved(current.account)) {
    redirect("/onboarding");
  }

  const supabase = await createSupabaseServerClient();
  const data = await getMediaDetail(supabase, mediaId);
  if (data === null) {
    notFound();
  }

  const [displayUrl, originalUrl] = await Promise.all([
    getSignedMediaUrl(data.storagePathDisplay),
    getSignedMediaUrl(data.storagePathOriginal),
  ]);

  return (
    <MediaViewer view={buildMediaDetailView(data, displayUrl, originalUrl)} />
  );
}
