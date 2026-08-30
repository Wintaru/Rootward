/**
 * {@link ImportGateway} backed by a service-role Supabase client. The only file
 * besides `index.ts` that talks to the database or storage; the engine
 * (`importer.ts`) stays driver-free and portable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Cursor,
  ImportGateway,
  ImportJobPatch,
  ImportJobRow,
  ImportStats,
  NotificationType,
  Row,
  TableName,
} from "./importer.ts";

/** Fallback bucket when `import_job.storage_path` carries no `bucket/` prefix. */
const DEFAULT_BUCKET = "imports";

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

    async downloadGedcom(storagePath: string): Promise<string> {
      const [bucket, key] = splitStoragePath(storagePath);
      const { data, error } = await supabase.storage.from(bucket).download(key);
      if (error !== null || data === null) {
        throw new Error(
          `download ${bucket}/${key}: ${error?.message ?? "no data"}`,
        );
      }
      return data.text();
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
  };
}

function splitStoragePath(path: string): [bucket: string, key: string] {
  const slash = path.indexOf("/");
  if (slash <= 0) {
    return [DEFAULT_BUCKET, path];
  }
  return [path.slice(0, slash), path.slice(slash + 1)];
}

function normalizeStats(value: unknown): ImportStats {
  const base: ImportStats = {
    added: 0,
    updated: 0,
    skipped: 0,
    removed: 0,
    warnings: [],
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
  };
}
