/**
 * {@link ImportGateway} backed by a service-role Supabase client. The only file
 * besides `index.ts` that talks to the database or storage; the engine
 * (`importer.ts`) stays driver-free and portable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isZip, readGedZip, readMediaEntries } from "@rootward/gedcom";

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
      const [bucket, key] = splitStoragePath(storagePath);
      const bytes = await downloadBytes(supabase, bucket, key);
      // A GedZip (issue #101): the upload carries the media its FILE tags
      // point at alongside the .ged text, detected by magic bytes rather than
      // the storage key's extension so a mislabeled upload still works.
      if (isZip(bytes)) {
        const zip = readGedZip(bytes);
        return {
          gedcomText: zip.gedcomText,
          mediaEntryNames: zip.mediaEntryNames,
          // Deliberately re-downloads rather than closing over `bytes`
          // above: a real GedZip's archive can run to tens of megabytes,
          // and the edge runtime's per-invocation memory ceiling is fixed
          // (256 MB locally) regardless of how little of it we've actually
          // decompressed. Keeping the whole compressed archive alive in a
          // closure for the rest of the invocation left no headroom for the
          // media phase's own real cost -- WASM image decode/resize/encode
          // of full-resolution photos -- and OOM'd the worker even once
          // decompression itself was already batch-scoped (issue #104). One
          // extra local-network download of an archive already proven to
          // exist is worth letting this call's copy of it be freed before
          // that decode work runs, instead of paying for both at once. The
          // media phase reinvokes per batch (`importer.ts`), so this doubles
          // the archive's Storage bandwidth for each of those invocations --
          // real, but bounded (two downloads per call, not unbounded), and a
          // Storage read is far cheaper to recover from than an OOM'd worker.
          readMediaBytes: async (paths) => {
            if (paths.length === 0) {
              return new Map();
            }
            const archiveBytes = await downloadBytes(supabase, bucket, key);
            return readMediaEntries(archiveBytes, new Set(paths));
          },
        };
      }
      return {
        gedcomText: new TextDecoder().decode(bytes),
        mediaEntryNames: [],
        readMediaBytes: () => Promise.resolve(new Map()),
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
