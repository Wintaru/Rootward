/**
 * {@link ImportGateway} backed by a service-role Supabase client. The only file
 * besides `index.ts` that talks to the database or storage; the engine
 * (`importer.ts`) stays driver-free and portable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decodeMediaStorageKey,
  GEDCOM_OBJECT_NAME,
  MEDIA_SUBPREFIX,
} from "@rootward/gedcom";

import type { TreeMediaSettings } from "../_shared/media-pipeline.ts";
import type { MediaBytesPatch } from "./media-attach.ts";
import type {
  Cursor,
  ImportGateway,
  ImportJobPatch,
  ImportJobRow,
  ImportSource,
  ImportStats,
  NotificationType,
  Row,
  TableName,
} from "./importer.ts";

/** Fallback bucket when `import_job.storage_path` carries no `bucket/` prefix. */
const DEFAULT_BUCKET = "imports";

/** `storage.list()` page size -- comfortably above a real GedZip's typical
 * file count, with pagination below in case one ever exceeds it. */
const STORAGE_LIST_PAGE_SIZE = 1000;

/** Private bucket `media-process` and, now, `gedcom-import` write processed
 * objects into (`20260901111850_media_bucket.sql`) -- same bucket, same path
 * shape (`<media id>/original.<ext>`, …), so the frontend Media viewer reads
 * either origin identically. */
const MEDIA_BUCKET = "media";

/** Max rows per `upsert` call, to bound the PostgREST request body. */
const UPSERT_CHUNK = 500;

const JOB_COLUMNS =
  "id,mode,status,storage_path,started_by,total_records,processed_records,cursor,stats";

export function createSupabaseGateway(supabase: SupabaseClient): ImportGateway {
  return {
    async loadJob(jobId: string): Promise<ImportJobRow> {
      const { data, error } = await supabase
        .from("import_job")
        .select(JOB_COLUMNS)
        .eq("id", jobId)
        .single();
      if (error !== null) {
        throw new Error(`load import_job ${jobId}: ${error.message}`);
      }
      const row = data as Record<string, unknown>;
      return {
        id: row.id as string,
        mode: row.mode as ImportJobRow["mode"],
        status: row.status as ImportJobRow["status"],
        storage_path: (row.storage_path as string | null) ?? null,
        started_by: (row.started_by as string | null) ?? null,
        total_records: (row.total_records as number | null) ?? null,
        processed_records: (row.processed_records as number | null) ?? 0,
        cursor: (row.cursor as Cursor | null) ?? null,
        stats: normalizeStats(row.stats),
      };
    },

    async downloadSource(storagePath: string): Promise<ImportSource> {
      // `storagePath` is a job's storage *prefix* (`imports/<jobId>`), not a
      // single object -- see the constants above. This function never reads
      // more than one small object at a time: the GEDCOM text, then later,
      // per media batch, only the handful of photos that batch needs. No
      // archive is ever downloaded or decompressed here (issue #104) --
      // that already happened client-side, before upload, where memory is
      // not capped at 256 MB.
      const [bucket, prefix] = splitStoragePath(storagePath);
      const gedcomBytes = await downloadBytes(
        supabase,
        bucket,
        `${prefix}/${GEDCOM_OBJECT_NAME}`,
      );
      const mediaPrefix = `${prefix}/${MEDIA_SUBPREFIX}`;
      const keyByArchivePath = await listMediaObjects(
        supabase,
        bucket,
        mediaPrefix,
      );

      return {
        gedcomText: new TextDecoder().decode(gedcomBytes),
        mediaEntryNames: [...keyByArchivePath.keys()],
        readMediaBytes: async (paths) => {
          const found = await Promise.all(
            paths.map(async (path) => {
              const key = keyByArchivePath.get(path);
              if (key === undefined) {
                return null;
              }
              return [
                path,
                await downloadBytes(supabase, bucket, key),
              ] as const;
            }),
          );
          return new Map(
            found.filter((entry): entry is readonly [string, Uint8Array] =>
              entry !== null
            ),
          );
        },
      };
    },

    async loadMediaSettings(): Promise<TreeMediaSettings> {
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

    async writeMediaObject(
      path: string,
      bytes: Uint8Array,
      contentType: string,
    ): Promise<void> {
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error !== null) {
        throw new Error(`write ${MEDIA_BUCKET}/${path}: ${error.message}`);
      }
    },

    async updateMediaBytes(
      mediaId: string,
      patch: MediaBytesPatch,
    ): Promise<void> {
      const { error } = await supabase
        .from("media")
        .update({
          mime_type: patch.mimeType,
          size_bytes: patch.sizeBytes,
          storage_path_original: patch.storagePathOriginal,
          storage_path_thumb: patch.storagePathThumb,
          storage_path_display: patch.storagePathDisplay,
          exif: patch.exif,
        })
        .eq("id", mediaId);
      if (error !== null) {
        throw new Error(`update media ${mediaId}: ${error.message}`);
      }
    },

    async upsertRows(table: TableName, rows: readonly Row[]): Promise<void> {
      // One batch can fan a person out into many event/citation rows; cap the
      // PostgREST payload rather than send an unbounded array.
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK) as Row[];
        const { error } = await supabase
          .from(table)
          .upsert(chunk, { onConflict: "id" });
        if (error !== null) {
          throw new Error(
            `upsert ${String(chunk.length)} into ${table}: ${error.message}`,
          );
        }
      }
    },

    async updateJob(jobId: string, patch: ImportJobPatch): Promise<void> {
      const { error } = await supabase
        .from("import_job")
        .update(patch)
        .eq("id", jobId);
      if (error !== null) {
        throw new Error(`update import_job ${jobId}: ${error.message}`);
      }
    },

    async createNotification(
      type: NotificationType,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const { error } = await supabase
        .from("notification")
        .insert({ type, payload });
      if (error !== null) {
        throw new Error(`create ${type} notification: ${error.message}`);
      }
    },

    async setDefaultRootPersonIfUnset(personId: string): Promise<void> {
      // The `is('default_root_person_id', null)` filter makes the write
      // conditional in one round trip: zero rows match once a root exists.
      // `tree_settings` is a singleton (CHECK `id = 1`, migration #7), so
      // that filter alone addresses the one row.
      const { error } = await supabase
        .from("tree_settings")
        .update({ default_root_person_id: personId })
        .is("default_root_person_id", null);
      if (error !== null) {
        throw new Error(`set default root person: ${error.message}`);
      }
    },
  };
}

function splitStoragePath(path: string): [bucket: string, key: string] {
  const slash = path.indexOf("/");
  if (slash <= 0) {
    return [DEFAULT_BUCKET, path];
  }
  return [path.slice(0, slash), path.slice(slash + 1)];
}

async function downloadBytes(
  supabase: SupabaseClient,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error !== null || data === null) {
    throw new Error(
      `download ${bucket}/${key}: ${error?.message ?? "no data"}`,
    );
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Every media object under a job's `media/` prefix, keyed by the archive
 * path its storage key decodes to (see `GEDCOM_OBJECT_NAME` comment above).
 * A plain `.ged` import (no `media/` objects at all) returns an empty map --
 * `list()` on an empty prefix is not an error. An entry whose key does not
 * decode (never written by this app) is silently skipped rather than failing
 * the whole import over one stray object. */
async function listMediaObjects(
  supabase: SupabaseClient,
  bucket: string,
  mediaPrefix: string,
): Promise<Map<string, string>> {
  const keyByArchivePath = new Map<string, string>();
  for (let offset = 0;; offset += STORAGE_LIST_PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(mediaPrefix, { limit: STORAGE_LIST_PAGE_SIZE, offset });
    if (error !== null) {
      throw new Error(`list ${bucket}/${mediaPrefix}: ${error.message}`);
    }
    for (const entry of data) {
      const decoded = decodeMediaStorageKey(entry.name);
      if (decoded !== null) {
        keyByArchivePath.set(
          decoded.archivePath,
          `${mediaPrefix}/${entry.name}`,
        );
      }
    }
    if (data.length < STORAGE_LIST_PAGE_SIZE) {
      return keyByArchivePath;
    }
  }
}

function normalizeStats(value: unknown): ImportStats {
  const base: ImportStats = {
    added: 0,
    updated: 0,
    skipped: 0,
    removed: 0,
    warnings: [],
    claimedMediaPaths: [],
  };
  if (value === null || typeof value !== "object") {
    return base;
  }
  const s = value as Record<string, unknown>;
  return {
    added: typeof s.added === "number" ? s.added : 0,
    updated: typeof s.updated === "number" ? s.updated : 0,
    skipped: typeof s.skipped === "number" ? s.skipped : 0,
    removed: typeof s.removed === "number" ? s.removed : 0,
    warnings: Array.isArray(s.warnings) ? s.warnings.map(String) : [],
    claimedMediaPaths: Array.isArray(s.claimedMediaPaths)
      ? s.claimedMediaPaths.map(String)
      : [],
  };
}
