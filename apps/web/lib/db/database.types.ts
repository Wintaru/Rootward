export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      access_request: {
        Row: {
          account_id: string
          created_at: string
          id: string
          message: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          submitted_birth_month: number | null
          submitted_birth_year: number | null
          submitted_name: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          message?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          submitted_birth_month?: number | null
          submitted_birth_year?: number | null
          submitted_name?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          message?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          submitted_birth_month?: number | null
          submitted_birth_year?: number | null
          submitted_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_request_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_request_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      account: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          person_id: string | null
          role: Database["public"]["Enums"]["account_role"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          person_id?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          person_id?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string | null
          changed_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          row_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          changed_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          changed_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      citation: {
        Row: {
          created_at: string
          data_text: string | null
          date_calendar: Database["public"]["Enums"]["calendar"]
          date_day1: number | null
          date_day2: number | null
          date_dual_year: boolean | null
          date_kind: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1: number | null
          date_month2: number | null
          date_phrase: string | null
          date_sort_key: string | null
          date_value_raw: string | null
          date_year1: number | null
          date_year2: number | null
          id: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["citation_owner"]
          page: string | null
          quality: number | null
          raw_gedcom: Json | null
          source_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_text?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          id?: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["citation_owner"]
          page?: string | null
          quality?: number | null
          raw_gedcom?: Json | null
          source_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_text?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          id?: string
          owner_id?: string
          owner_type?: Database["public"]["Enums"]["citation_owner"]
          page?: string | null
          quality?: number | null
          raw_gedcom?: Json | null
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "citation_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "source"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_attempt: {
        Row: {
          account_id: string
          attempted_at: string
          id: string
          succeeded: boolean
        }
        Insert: {
          account_id: string
          attempted_at?: string
          id?: string
          succeeded: boolean
        }
        Update: {
          account_id?: string
          attempted_at?: string
          id?: string
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "claim_attempt_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      event: {
        Row: {
          age_text: string | null
          created_at: string
          created_by: string | null
          date_calendar: Database["public"]["Enums"]["calendar"]
          date_day1: number | null
          date_day2: number | null
          date_dual_year: boolean | null
          date_kind: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1: number | null
          date_month2: number | null
          date_phrase: string | null
          date_sort_key: string | null
          date_value_raw: string | null
          date_year1: number | null
          date_year2: number | null
          family_id: string | null
          id: string
          owner_type: Database["public"]["Enums"]["event_owner"]
          person_id: string | null
          place_id: string | null
          raw_gedcom: Json | null
          sort_key: string | null
          type: Database["public"]["Enums"]["event_type"]
          type_other: string | null
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          age_text?: string | null
          created_at?: string
          created_by?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          family_id?: string | null
          id?: string
          owner_type: Database["public"]["Enums"]["event_owner"]
          person_id?: string | null
          place_id?: string | null
          raw_gedcom?: Json | null
          sort_key?: string | null
          type: Database["public"]["Enums"]["event_type"]
          type_other?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          age_text?: string | null
          created_at?: string
          created_by?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          family_id?: string | null
          id?: string
          owner_type?: Database["public"]["Enums"]["event_owner"]
          person_id?: string | null
          place_id?: string | null
          raw_gedcom?: Json | null
          sort_key?: string | null
          type?: Database["public"]["Enums"]["event_type"]
          type_other?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      export_job: {
        Row: {
          completed_at: string | null
          created_at: string
          error_text: string | null
          id: string
          size_bytes: number | null
          started_by: string | null
          status: Database["public"]["Enums"]["export_status"]
          storage_path: string | null
          type: Database["public"]["Enums"]["export_type"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          size_bytes?: number | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["export_status"]
          storage_path?: string | null
          type: Database["public"]["Enums"]["export_type"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          size_bytes?: number | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["export_status"]
          storage_path?: string | null
          type?: Database["public"]["Enums"]["export_type"]
        }
        Relationships: [
          {
            foreignKeyName: "export_job_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      fact: {
        Row: {
          created_at: string
          created_by: string | null
          date_calendar: Database["public"]["Enums"]["calendar"]
          date_day1: number | null
          date_day2: number | null
          date_dual_year: boolean | null
          date_kind: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1: number | null
          date_month2: number | null
          date_phrase: string | null
          date_sort_key: string | null
          date_value_raw: string | null
          date_year1: number | null
          date_year2: number | null
          family_id: string | null
          id: string
          is_sensitive: boolean | null
          owner_type: Database["public"]["Enums"]["fact_owner"]
          person_id: string | null
          place_id: string | null
          raw_gedcom: Json | null
          type: Database["public"]["Enums"]["fact_type"]
          type_other: string | null
          updated_at: string
          updated_by: string | null
          value: string | null
          visibility: Database["public"]["Enums"]["fact_visibility"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          family_id?: string | null
          id?: string
          is_sensitive?: boolean | null
          owner_type: Database["public"]["Enums"]["fact_owner"]
          person_id?: string | null
          place_id?: string | null
          raw_gedcom?: Json | null
          type: Database["public"]["Enums"]["fact_type"]
          type_other?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          visibility?: Database["public"]["Enums"]["fact_visibility"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          family_id?: string | null
          id?: string
          is_sensitive?: boolean | null
          owner_type?: Database["public"]["Enums"]["fact_owner"]
          person_id?: string | null
          place_id?: string | null
          raw_gedcom?: Json | null
          type?: Database["public"]["Enums"]["fact_type"]
          type_other?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          visibility?: Database["public"]["Enums"]["fact_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "fact_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "place"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      family: {
        Row: {
          created_at: string
          gedcom_xref: string | null
          id: string
          partner1_id: string | null
          partner1_role: Database["public"]["Enums"]["partner_role"] | null
          partner2_id: string | null
          partner2_role: Database["public"]["Enums"]["partner_role"] | null
          raw_gedcom: Json | null
          relationship_type: Database["public"]["Enums"]["union_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          partner1_id?: string | null
          partner1_role?: Database["public"]["Enums"]["partner_role"] | null
          partner2_id?: string | null
          partner2_role?: Database["public"]["Enums"]["partner_role"] | null
          raw_gedcom?: Json | null
          relationship_type?: Database["public"]["Enums"]["union_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          partner1_id?: string | null
          partner1_role?: Database["public"]["Enums"]["partner_role"] | null
          partner2_id?: string | null
          partner2_role?: Database["public"]["Enums"]["partner_role"] | null
          raw_gedcom?: Json | null
          relationship_type?: Database["public"]["Enums"]["union_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_partner1_id_fkey"
            columns: ["partner1_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_partner2_id_fkey"
            columns: ["partner2_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      family_child: {
        Row: {
          created_at: string
          family_id: string
          id: string
          person_id: string
          raw_gedcom: Json | null
          relation_to_partner1:
            | Database["public"]["Enums"]["child_relation"]
            | null
          relation_to_partner2:
            | Database["public"]["Enums"]["child_relation"]
            | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          person_id: string
          raw_gedcom?: Json | null
          relation_to_partner1?:
            | Database["public"]["Enums"]["child_relation"]
            | null
          relation_to_partner2?:
            | Database["public"]["Enums"]["child_relation"]
            | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          person_id?: string
          raw_gedcom?: Json | null
          relation_to_partner1?:
            | Database["public"]["Enums"]["child_relation"]
            | null
          relation_to_partner2?:
            | Database["public"]["Enums"]["child_relation"]
            | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_child_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_child_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      import_job: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: Json | null
          error_text: string | null
          filename: string | null
          id: string
          mode: Database["public"]["Enums"]["import_mode"]
          processed_records: number
          started_by: string | null
          stats: Json
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string | null
          total_records: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: Json | null
          error_text?: string | null
          filename?: string | null
          id?: string
          mode: Database["public"]["Enums"]["import_mode"]
          processed_records?: number
          started_by?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string | null
          total_records?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: Json | null
          error_text?: string | null
          filename?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["import_mode"]
          processed_records?: number
          started_by?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string | null
          total_records?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_job_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          person_id: string
          role: Database["public"]["Enums"]["account_role"]
          status: Database["public"]["Enums"]["invitation_status"]
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          person_id: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          person_id?: string
          role?: Database["public"]["Enums"]["account_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invitation_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          date_calendar: Database["public"]["Enums"]["calendar"]
          date_day1: number | null
          date_day2: number | null
          date_dual_year: boolean | null
          date_kind: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1: number | null
          date_month2: number | null
          date_phrase: string | null
          date_sort_key: string | null
          date_value_raw: string | null
          date_year1: number | null
          date_year2: number | null
          exif: Json | null
          gedcom_xref: string | null
          id: string
          mime_type: string | null
          original_filename: string | null
          raw_gedcom: Json | null
          size_bytes: number | null
          storage_path_display: string | null
          storage_path_original: string | null
          storage_path_thumb: string | null
          title: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          exif?: Json | null
          gedcom_xref?: string | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          raw_gedcom?: Json | null
          size_bytes?: number | null
          storage_path_display?: string | null
          storage_path_original?: string | null
          storage_path_thumb?: string | null
          title?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          date_calendar?: Database["public"]["Enums"]["calendar"]
          date_day1?: number | null
          date_day2?: number | null
          date_dual_year?: boolean | null
          date_kind?: Database["public"]["Enums"]["genealogy_date_kind"] | null
          date_month1?: number | null
          date_month2?: number | null
          date_phrase?: string | null
          date_sort_key?: string | null
          date_value_raw?: string | null
          date_year1?: number | null
          date_year2?: number | null
          exif?: Json | null
          gedcom_xref?: string | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          raw_gedcom?: Json | null
          size_bytes?: number | null
          storage_path_display?: string | null
          storage_path_original?: string | null
          storage_path_thumb?: string | null
          title?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      media_link: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          is_primary: boolean
          media_id: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["media_owner"]
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          media_id: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["media_owner"]
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          media_id?: string
          owner_id?: string
          owner_type?: Database["public"]["Enums"]["media_owner"]
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_link_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      note: {
        Row: {
          created_at: string
          gedcom_xref: string | null
          id: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["note_owner"]
          raw_gedcom: Json | null
          sort_order: number | null
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["note_owner"]
          raw_gedcom?: Json | null
          sort_order?: number | null
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          owner_id?: string
          owner_type?: Database["public"]["Enums"]["note_owner"]
          raw_gedcom?: Json | null
          sort_order?: number | null
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification: {
        Row: {
          created_at: string
          id: string
          payload: Json
          resolved_at: string | null
          resolved_by: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_read: {
        Row: {
          account_id: string
          notification_id: string
          read_at: string
        }
        Insert: {
          account_id: string
          notification_id: string
          read_at?: string
        }
        Update: {
          account_id?: string
          notification_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_read_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_read_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notification"
            referencedColumns: ["id"]
          },
        ]
      }
      person: {
        Row: {
          ancestral_file_number: string | null
          created_at: string
          created_by: string | null
          familysearch_id: string | null
          gedcom_xref: string | null
          given_name: string | null
          id: string
          is_living: boolean | null
          name_prefix: string | null
          name_suffix: string | null
          nickname: string | null
          raw_gedcom: Json | null
          sex: Database["public"]["Enums"]["sex"] | null
          surname: string | null
          updated_at: string
          updated_by: string | null
          user_reference_number: string | null
          visibility: Database["public"]["Enums"]["person_visibility"]
        }
        Insert: {
          ancestral_file_number?: string | null
          created_at?: string
          created_by?: string | null
          familysearch_id?: string | null
          gedcom_xref?: string | null
          given_name?: string | null
          id?: string
          is_living?: boolean | null
          name_prefix?: string | null
          name_suffix?: string | null
          nickname?: string | null
          raw_gedcom?: Json | null
          sex?: Database["public"]["Enums"]["sex"] | null
          surname?: string | null
          updated_at?: string
          updated_by?: string | null
          user_reference_number?: string | null
          visibility?: Database["public"]["Enums"]["person_visibility"]
        }
        Update: {
          ancestral_file_number?: string | null
          created_at?: string
          created_by?: string | null
          familysearch_id?: string | null
          gedcom_xref?: string | null
          given_name?: string | null
          id?: string
          is_living?: boolean | null
          name_prefix?: string | null
          name_suffix?: string | null
          nickname?: string | null
          raw_gedcom?: Json | null
          sex?: Database["public"]["Enums"]["sex"] | null
          surname?: string | null
          updated_at?: string
          updated_by?: string | null
          user_reference_number?: string | null
          visibility?: Database["public"]["Enums"]["person_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "person_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      person_name: {
        Row: {
          created_at: string
          given_name: string | null
          id: string
          nickname: string | null
          person_id: string
          prefix: string | null
          raw_gedcom: Json | null
          sort_order: number | null
          suffix: string | null
          surname: string | null
          type: Database["public"]["Enums"]["name_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          given_name?: string | null
          id?: string
          nickname?: string | null
          person_id: string
          prefix?: string | null
          raw_gedcom?: Json | null
          sort_order?: number | null
          suffix?: string | null
          surname?: string | null
          type?: Database["public"]["Enums"]["name_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          given_name?: string | null
          id?: string
          nickname?: string | null
          person_id?: string
          prefix?: string | null
          raw_gedcom?: Json | null
          sort_order?: number | null
          suffix?: string | null
          surname?: string | null
          type?: Database["public"]["Enums"]["name_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_name_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      place: {
        Row: {
          country: string | null
          county: string | null
          created_at: string
          geocode_source: Database["public"]["Enums"]["geocode_source"] | null
          geocoded_at: string | null
          id: string
          latitude: number | null
          locality: string | null
          longitude: number | null
          name: string
          normalized_name: string | null
          raw_gedcom: Json | null
          state: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          county?: string | null
          created_at?: string
          geocode_source?: Database["public"]["Enums"]["geocode_source"] | null
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          locality?: string | null
          longitude?: number | null
          name: string
          normalized_name?: string | null
          raw_gedcom?: Json | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          county?: string | null
          created_at?: string
          geocode_source?: Database["public"]["Enums"]["geocode_source"] | null
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          locality?: string | null
          longitude?: number | null
          name?: string
          normalized_name?: string | null
          raw_gedcom?: Json | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      repository: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          gedcom_xref: string | null
          id: string
          name: string | null
          phone: string | null
          raw_gedcom: Json | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          gedcom_xref?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          raw_gedcom?: Json | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          gedcom_xref?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          raw_gedcom?: Json | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      source: {
        Row: {
          author: string | null
          created_at: string
          gedcom_xref: string | null
          id: string
          publication_info: string | null
          raw_gedcom: Json | null
          repository_id: string | null
          source_text: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          author?: string | null
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          publication_info?: string | null
          raw_gedcom?: Json | null
          repository_id?: string | null
          source_text?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          author?: string | null
          created_at?: string
          gedcom_xref?: string | null
          id?: string
          publication_info?: string | null
          raw_gedcom?: Json | null
          repository_id?: string | null
          source_text?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "repository"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_settings: {
        Row: {
          allow_self_signup: boolean
          backup_enabled: boolean
          backup_frequency: Database["public"]["Enums"]["backup_frequency"]
          backup_retention: number
          created_at: string
          default_generations_down: number
          default_generations_up: number
          default_root_person_id: string | null
          id: number
          living_threshold_years: number
          media_allowed_mime: string[]
          media_max_bytes: number
          strip_exif_gps: boolean
          tree_description: string | null
          tree_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_self_signup?: boolean
          backup_enabled?: boolean
          backup_frequency?: Database["public"]["Enums"]["backup_frequency"]
          backup_retention?: number
          created_at?: string
          default_generations_down?: number
          default_generations_up?: number
          default_root_person_id?: string | null
          id?: number
          living_threshold_years?: number
          media_allowed_mime?: string[]
          media_max_bytes?: number
          strip_exif_gps?: boolean
          tree_description?: string | null
          tree_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_self_signup?: boolean
          backup_enabled?: boolean
          backup_frequency?: Database["public"]["Enums"]["backup_frequency"]
          backup_retention?: number
          created_at?: string
          default_generations_down?: number
          default_generations_up?: number
          default_root_person_id?: string | null
          id?: number
          living_threshold_years?: number
          media_allowed_mime?: string[]
          media_max_bytes?: number
          strip_exif_gps?: boolean
          tree_description?: string | null
          tree_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tree_settings_default_root_person_id_fkey"
            columns: ["default_root_person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_account: {
        Args: never
        Returns: {
          created_at: string
          display_name: string | null
          id: string
          person_id: string | null
          role: Database["public"]["Enums"]["account_role"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "account"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      citation_is_visible: { Args: { p_citation_id: string }; Returns: boolean }
      event_is_visible: { Args: { p_event_id: string }; Returns: boolean }
      event_type_sort_ordinal: {
        Args: { p_type: Database["public"]["Enums"]["event_type"] }
        Returns: number
      }
      expand_relatives: {
        Args: { p_person: string; p_relation: string }
        Returns: Json
      }
      fact_is_visible: { Args: { p_fact_id: string }; Returns: boolean }
      family_is_visible: { Args: { p_family_id: string }; Returns: boolean }
      genealogy_date_sort_key: {
        Args: { p_day: number; p_month: number; p_year: number }
        Returns: string
      }
      get_neighborhood: {
        Args: { p_down?: number; p_focus: string; p_up?: number }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_approved: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      media_link_is_visible: {
        Args: { p_media_link_id: string }
        Returns: boolean
      }
      note_is_visible: { Args: { p_note_id: string }; Returns: boolean }
      onboarding_match_search: {
        Args: {
          p_birth_month?: number
          p_birth_year: number
          p_given_name: string
          p_surname: string
          p_threshold?: number
        }
        Returns: {
          person_id: string
          score: number
        }[]
      }
      person_is_living: { Args: { p_person_id: string }; Returns: boolean }
      person_is_visible: { Args: { p_person_id: string }; Returns: boolean }
    }
    Enums: {
      account_role: "viewer" | "moderator" | "admin"
      account_status: "active" | "pending" | "suspended"
      audit_action: "insert" | "update" | "delete"
      backup_frequency: "daily" | "weekly" | "monthly"
      calendar:
        | "gregorian"
        | "julian"
        | "hebrew"
        | "french_republican"
        | "unknown"
      child_relation:
        | "biological"
        | "adopted"
        | "step"
        | "foster"
        | "guardian"
        | "sealed"
        | "unknown"
      citation_owner: "person" | "event" | "fact" | "family" | "person_name"
      event_owner: "person" | "family"
      event_type:
        | "birth"
        | "death"
        | "marriage"
        | "divorce"
        | "burial"
        | "cremation"
        | "christening"
        | "baptism"
        | "bar_mitzvah"
        | "bat_mitzvah"
        | "confirmation"
        | "first_communion"
        | "adoption"
        | "graduation"
        | "immigration"
        | "emigration"
        | "naturalization"
        | "census"
        | "residence"
        | "occupation"
        | "retirement"
        | "will"
        | "probate"
        | "engagement"
        | "marriage_banns"
        | "annulment"
        | "other"
      export_status: "pending" | "running" | "completed" | "failed"
      export_type: "manual_gedcom" | "manual_full" | "scheduled_full"
      fact_owner: "person" | "family"
      fact_type:
        | "eye_color"
        | "hair_color"
        | "height"
        | "weight"
        | "physical_description"
        | "ethnic_origin"
        | "skin_color"
        | "religion"
        | "nationality"
        | "occupation"
        | "education"
        | "caste"
        | "title_of_nobility"
        | "number_of_children"
        | "number_of_marriages"
        | "property"
        | "national_id"
        | "ssn"
        | "medical"
        | "other"
      fact_visibility:
        | "everyone_approved"
        | "close_family"
        | "moderators_only"
        | "hidden"
      genealogy_date_kind:
        | "exact"
        | "about"
        | "estimated"
        | "calculated"
        | "before"
        | "after"
        | "between"
        | "from_to"
        | "interpreted"
        | "phrase"
        | "unknown"
      geocode_source: "nominatim" | "manual" | "none"
      import_mode: "initial" | "replace_all" | "match_update"
      import_status:
        | "uploaded"
        | "parsing"
        | "importing"
        | "completed"
        | "failed"
        | "cancelled"
      invitation_status: "pending" | "accepted" | "expired"
      media_owner: "person" | "event" | "fact" | "family" | "source" | "place"
      name_type:
        | "birth"
        | "married"
        | "maiden"
        | "also_known_as"
        | "nickname"
        | "religious"
        | "immigrant"
        | "other"
      note_owner:
        | "person"
        | "event"
        | "fact"
        | "family"
        | "family_child"
        | "source"
        | "citation"
        | "media"
      notification_type:
        | "self_claim_linked"
        | "access_requested"
        | "claim_attempt_cap"
        | "import_finished"
        | "import_failed"
        | "hide_request"
      partner_role: "husband" | "wife" | "partner" | "unknown"
      person_visibility:
        | "everyone_approved"
        | "close_family"
        | "moderators_only"
        | "hidden"
      request_status: "pending" | "approved" | "rejected"
      sex: "male" | "female" | "unknown" | "other"
      union_type: "married" | "partnership" | "civil_union" | "unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_role: ["viewer", "moderator", "admin"],
      account_status: ["active", "pending", "suspended"],
      audit_action: ["insert", "update", "delete"],
      backup_frequency: ["daily", "weekly", "monthly"],
      calendar: [
        "gregorian",
        "julian",
        "hebrew",
        "french_republican",
        "unknown",
      ],
      child_relation: [
        "biological",
        "adopted",
        "step",
        "foster",
        "guardian",
        "sealed",
        "unknown",
      ],
      citation_owner: ["person", "event", "fact", "family", "person_name"],
      event_owner: ["person", "family"],
      event_type: [
        "birth",
        "death",
        "marriage",
        "divorce",
        "burial",
        "cremation",
        "christening",
        "baptism",
        "bar_mitzvah",
        "bat_mitzvah",
        "confirmation",
        "first_communion",
        "adoption",
        "graduation",
        "immigration",
        "emigration",
        "naturalization",
        "census",
        "residence",
        "occupation",
        "retirement",
        "will",
        "probate",
        "engagement",
        "marriage_banns",
        "annulment",
        "other",
      ],
      export_status: ["pending", "running", "completed", "failed"],
      export_type: ["manual_gedcom", "manual_full", "scheduled_full"],
      fact_owner: ["person", "family"],
      fact_type: [
        "eye_color",
        "hair_color",
        "height",
        "weight",
        "physical_description",
        "ethnic_origin",
        "skin_color",
        "religion",
        "nationality",
        "occupation",
        "education",
        "caste",
        "title_of_nobility",
        "number_of_children",
        "number_of_marriages",
        "property",
        "national_id",
        "ssn",
        "medical",
        "other",
      ],
      fact_visibility: [
        "everyone_approved",
        "close_family",
        "moderators_only",
        "hidden",
      ],
      genealogy_date_kind: [
        "exact",
        "about",
        "estimated",
        "calculated",
        "before",
        "after",
        "between",
        "from_to",
        "interpreted",
        "phrase",
        "unknown",
      ],
      geocode_source: ["nominatim", "manual", "none"],
      import_mode: ["initial", "replace_all", "match_update"],
      import_status: [
        "uploaded",
        "parsing",
        "importing",
        "completed",
        "failed",
        "cancelled",
      ],
      invitation_status: ["pending", "accepted", "expired"],
      media_owner: ["person", "event", "fact", "family", "source", "place"],
      name_type: [
        "birth",
        "married",
        "maiden",
        "also_known_as",
        "nickname",
        "religious",
        "immigrant",
        "other",
      ],
      note_owner: [
        "person",
        "event",
        "fact",
        "family",
        "family_child",
        "source",
        "citation",
        "media",
      ],
      notification_type: [
        "self_claim_linked",
        "access_requested",
        "claim_attempt_cap",
        "import_finished",
        "import_failed",
        "hide_request",
      ],
      partner_role: ["husband", "wife", "partner", "unknown"],
      person_visibility: [
        "everyone_approved",
        "close_family",
        "moderators_only",
        "hidden",
      ],
      request_status: ["pending", "approved", "rejected"],
      sex: ["male", "female", "unknown", "other"],
      union_type: ["married", "partnership", "civil_union", "unknown"],
    },
  },
} as const

