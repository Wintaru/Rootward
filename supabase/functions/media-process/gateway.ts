/**
 * {@link MediaProcessGateway} backed by a service-role Supabase client. The
 * only file besides `index.ts` that talks to the database or storage; the
 * engine (`processor.ts`) stays driver-free and portable, same split as
 * `gedcom-export` / `gedcom-import` / `onboarding-match`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  MediaLinkInsert,
  MediaProcessGateway,
  MediaRowInsert,
  TreeMediaSettings,
} from "./processor.ts";

export const BUCKET = "media";

export function createSupabaseGateway(
  supabase: SupabaseClient,
): MediaProcessGateway {
  return {
    async loadTreeSettings(): Promise<TreeMediaSettings> {
      const { data, error } = await supabase
        .from("tree_settings")
        .select("media_max_bytes,media_allowed_mime,strip_exif_gps")
        .eq("id", 1)
        .single();
      if (error !== null) {
        throw new Error(`load tree_settings: ${error.message}`);
      }
      const row = data as {
        media_max_bytes: number;
        media_allowed_mime: string[];
        strip_exif_gps: boolean;
      };
      return {
        mediaMaxBytes: row.media_max_bytes,
        mediaAllowedMime: row.media_allowed_mime,
        stripExifGps: row.strip_exif_gps,
      };
    },

    async readObject(path: string): Promise<Uint8Array> {
      const { data, error } = await supabase.storage.from(BUCKET).download(
        path,
      );
      if (error !== null || data === null) {
        throw new Error(
          `read ${BUCKET}/${path}: ${error?.message ?? "no data"}`,
        );
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async writeObject(
      path: string,
      bytes: Uint8Array,
      contentType: string,
    ): Promise<void> {
      const { error } = await supabase.storage.from(BUCKET).upload(
        path,
        bytes,
        {
          contentType,
          upsert: true,
        },
      );
      if (error !== null) {
        throw new Error(`write ${BUCKET}/${path}: ${error.message}`);
      }
    },

    async removeObject(path: string): Promise<void> {
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error !== null) {
        throw new Error(`remove ${BUCKET}/${path}: ${error.message}`);
      }
    },

    async insertMedia(row: MediaRowInsert): Promise<void> {
      const d = row.date;
      const { error } = await supabase.from("media").insert({
        id: row.id,
        original_filename: row.originalFilename,
        mime_type: row.mimeType,
        size_bytes: row.sizeBytes,
        storage_path_original: row.storagePathOriginal,
        storage_path_thumb: row.storagePathThumb,
        storage_path_display: row.storagePathDisplay,
        date_value_raw: d?.date_value_raw ?? null,
        date_kind: d?.date_kind ?? null,
        date_year1: d?.date_year1 ?? null,
        date_month1: d?.date_month1 ?? null,
        date_day1: d?.date_day1 ?? null,
        date_year2: d?.date_year2 ?? null,
        date_month2: d?.date_month2 ?? null,
        date_day2: d?.date_day2 ?? null,
        date_calendar: d?.date_calendar ?? "gregorian",
        date_dual_year: d?.date_dual_year ?? false,
        date_phrase: d?.date_phrase ?? null,
        exif: row.exif,
        uploaded_by: row.uploadedBy,
      });
      if (error !== null) {
        throw new Error(`insert media ${row.id}: ${error.message}`);
      }
    },

    async insertMediaLink(link: MediaLinkInsert): Promise<void> {
      const { error } = await supabase.from("media_link").insert({
        media_id: link.mediaId,
        owner_type: link.ownerType,
        owner_id: link.ownerId,
      });
      if (error !== null) {
        throw new Error(
          `insert media_link for media ${link.mediaId}: ${error.message}`,
        );
      }
    },
  };
}
