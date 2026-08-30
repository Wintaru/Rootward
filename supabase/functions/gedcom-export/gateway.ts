/**
 * {@link ExportGateway} backed by a service-role Supabase client. The only file
 * besides `index.ts` that talks to the database or storage; the engine
 * (`exporter.ts`) stays driver-free and portable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CitationRow,
  EventRow,
  ExportGateway,
  ExportJobPatch,
  ExportJobRow,
  FactRow,
  FamilyChildRow,
  FamilyRow,
  MediaLinkRow,
  MediaRow,
  NoteRow,
  PersonNameRow,
  PersonRow,
  PlaceRow,
  RepositoryRow,
  SourceRow,
  TreeRows,
} from "./exporter.ts";
import { BUCKET } from "./exporter.ts";

/** PostgREST caps an unpaginated select at 1000 rows; page every table read. */
const PAGE = 1000;

const JOB_COLUMNS = "id,type,status,storage_path,started_by";

const DATE_COLUMNS =
  "date_value_raw,date_kind,date_year1,date_month1,date_day1," +
  "date_year2,date_month2,date_day2,date_calendar,date_dual_year,date_phrase";

export function createSupabaseGateway(supabase: SupabaseClient): ExportGateway {
  async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0;; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error !== null) {
        throw new Error(`read ${table}: ${error.message}`);
      }
      const page = (data ?? []) as T[];
      out.push(...page);
      if (page.length < PAGE) {
        return out;
      }
    }
  }

  return {
    async loadJob(jobId: string): Promise<ExportJobRow> {
      const { data, error } = await supabase
        .from("export_job")
        .select(JOB_COLUMNS)
        .eq("id", jobId)
        .single();
      if (error !== null) {
        throw new Error(`load export_job ${jobId}: ${error.message}`);
      }
      const row = data as Record<string, unknown>;
      return {
        id: row.id as string,
        type: row.type as ExportJobRow["type"],
        status: row.status as ExportJobRow["status"],
        storage_path: (row.storage_path as string | null) ?? null,
        started_by: (row.started_by as string | null) ?? null,
      };
    },

    async fetchTree(): Promise<TreeRows> {
      const [
        persons,
        personNames,
        families,
        familyChildren,
        events,
        facts,
        notes,
        citations,
        mediaLinks,
        sources,
        repositories,
        media,
        places,
      ] = await Promise.all([
        fetchAll<PersonRow>(
          "person",
          "id,gedcom_xref,given_name,surname,name_prefix,name_suffix,nickname," +
            "sex,familysearch_id,ancestral_file_number,user_reference_number," +
            "raw_gedcom,created_at",
        ),
        fetchAll<PersonNameRow>(
          "person_name",
          "id,person_id,type,given_name,surname,prefix,suffix,nickname," +
            "sort_order,raw_gedcom",
        ),
        fetchAll<FamilyRow>(
          "family",
          "id,gedcom_xref,partner1_id,partner2_id,partner1_role,partner2_role," +
            "relationship_type,raw_gedcom,created_at",
        ),
        fetchAll<FamilyChildRow>(
          "family_child",
          "id,family_id,person_id,relation_to_partner1,relation_to_partner2," +
            "sort_order,raw_gedcom",
        ),
        fetchAll<EventRow>(
          "event",
          "id,owner_type,person_id,family_id,type,type_other,value,age_text," +
            `place_id,sort_key,raw_gedcom,created_at,${DATE_COLUMNS}`,
        ),
        fetchAll<FactRow>(
          "fact",
          "id,owner_type,person_id,family_id,type,type_other,value,place_id," +
            `raw_gedcom,created_at,${DATE_COLUMNS}`,
        ),
        fetchAll<NoteRow>(
          "note",
          "id,owner_type,owner_id,text,sort_order,raw_gedcom",
        ),
        fetchAll<CitationRow>(
          "citation",
          "id,source_id,owner_type,owner_id,page,data_text,quality," +
            `raw_gedcom,${DATE_COLUMNS}`,
        ),
        fetchAll<MediaLinkRow>(
          "media_link",
          "id,media_id,owner_type,owner_id,caption,is_primary,sort_order",
        ),
        fetchAll<SourceRow>(
          "source",
          "id,gedcom_xref,title,author,publication_info,repository_id," +
            "source_text,raw_gedcom,created_at",
        ),
        fetchAll<RepositoryRow>(
          "repository",
          "id,gedcom_xref,name,address,phone,email,website,raw_gedcom,created_at",
        ),
        fetchAll<MediaRow>(
          "media",
          "id,gedcom_xref,original_filename,mime_type,title," +
            `raw_gedcom,created_at,${DATE_COLUMNS}`,
        ),
        fetchAll<PlaceRow>("place", "id,name,normalized_name"),
      ]);

      return {
        persons,
        personNames,
        families,
        familyChildren,
        events,
        facts,
        notes,
        citations,
        mediaLinks,
        sources,
        repositories,
        media,
        places,
      };
    },

    async uploadGedcom(key: string, text: string): Promise<void> {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(key, new Blob([text], { type: "text/plain" }), {
          contentType: "text/plain; charset=utf-8",
          upsert: true,
        });
      if (error !== null) {
        throw new Error(`upload ${BUCKET}/${key}: ${error.message}`);
      }
    },

    async signUrl(key: string, expiresInSeconds: number): Promise<string> {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(key, expiresInSeconds);
      if (error !== null || data === null) {
        throw new Error(
          `sign ${BUCKET}/${key}: ${error?.message ?? "no url"}`,
        );
      }
      return data.signedUrl;
    },

    async updateJob(jobId: string, patch: ExportJobPatch): Promise<void> {
      const { error } = await supabase
        .from("export_job")
        .update(patch)
        .eq("id", jobId);
      if (error !== null) {
        throw new Error(`update export_job ${jobId}: ${error.message}`);
      }
    },
  };
}
