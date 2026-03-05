export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agenda_items: {
        Row: {
          created_at: string
          id: string
          initiatives: Json | null
          item_number: number | null
          session_id: string | null
          title: string
          topic_category: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          initiatives?: Json | null
          item_number?: number | null
          session_id?: string | null
          title: string
          topic_category?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          initiatives?: Json | null
          item_number?: number | null
          session_id?: string | null
          title?: string
          topic_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agenda_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "agenda_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      filler_words: {
        Row: {
          category: string
          id: string
          word: string
        }
        Insert: {
          category?: string
          id?: string
          word: string
        }
        Update: {
          category?: string
          id?: string
          word?: string
        }
        Relationships: []
      }
      hf_usage_log: {
        Row: {
          audio_bytes: number
          cost_estimated: number | null
          created_at: string
          duration_seconds: number | null
          function_name: string
          id: string
          model_used: string | null
          tokens_estimated: number | null
        }
        Insert: {
          audio_bytes?: number
          cost_estimated?: number | null
          created_at?: string
          duration_seconds?: number | null
          function_name?: string
          id?: string
          model_used?: string | null
          tokens_estimated?: number | null
        }
        Update: {
          audio_bytes?: number
          cost_estimated?: number | null
          created_at?: string
          duration_seconds?: number | null
          function_name?: string
          id?: string
          model_used?: string | null
          tokens_estimated?: number | null
        }
        Relationships: []
      }
      interventions: {
        Row: {
          agenda_item_id: string | null
          applause_from: string[] | null
          created_at: string
          deputy_id: string | null
          deputy_name: string | null
          estimated_duration_seconds: number | null
          filler_word_count: number | null
          filler_words_detail: Json | null
          id: string
          interrupted_by: string[] | null
          key_claims: Json | null
          party: string | null
          protests_from: string[] | null
          sentiment_score: number | null
          sequence_number: number | null
          session_id: string | null
          text: string
          topic_tags: string[] | null
          type: string | null
          was_mic_cutoff: boolean | null
          word_count: number | null
        }
        Insert: {
          agenda_item_id?: string | null
          applause_from?: string[] | null
          created_at?: string
          deputy_id?: string | null
          deputy_name?: string | null
          estimated_duration_seconds?: number | null
          filler_word_count?: number | null
          filler_words_detail?: Json | null
          id?: string
          interrupted_by?: string[] | null
          key_claims?: Json | null
          party?: string | null
          protests_from?: string[] | null
          sentiment_score?: number | null
          sequence_number?: number | null
          session_id?: string | null
          text: string
          topic_tags?: string[] | null
          type?: string | null
          was_mic_cutoff?: boolean | null
          word_count?: number | null
        }
        Update: {
          agenda_item_id?: string | null
          applause_from?: string[] | null
          created_at?: string
          deputy_id?: string | null
          deputy_name?: string | null
          estimated_duration_seconds?: number | null
          filler_word_count?: number | null
          filler_words_detail?: Json | null
          id?: string
          interrupted_by?: string[] | null
          key_claims?: Json | null
          party?: string | null
          protests_from?: string[] | null
          sentiment_score?: number | null
          sequence_number?: number | null
          session_id?: string | null
          text?: string
          topic_tags?: string[] | null
          type?: string | null
          was_mic_cutoff?: boolean | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interventions_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "deputy_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "interventions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      legislaturas: {
        Row: {
          description: string | null
          end_date: string | null
          id: string
          start_date: string | null
        }
        Insert: {
          description?: string | null
          end_date?: string | null
          id: string
          start_date?: string | null
        }
        Update: {
          description?: string | null
          end_date?: string | null
          id?: string
          start_date?: string | null
        }
        Relationships: []
      }
      party_positions: {
        Row: {
          created_at: string
          id: string
          party: string
          position_summary: string | null
          session_id: string | null
          topic: string
          vote_alignment: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          party: string
          position_summary?: string | null
          session_id?: string | null
          topic: string
          vote_alignment?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          party?: string
          position_summary?: string | null
          session_id?: string | null
          topic?: string
          vote_alignment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_positions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "party_positions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      plenario_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          current_session: string | null
          error_message: string | null
          id: string
          legislatura: string
          sessions_processed: number
          speeches_inserted: number
          started_at: string | null
          status: string
          total_sessions: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_session?: string | null
          error_message?: string | null
          id?: string
          legislatura: string
          sessions_processed?: number
          speeches_inserted?: number
          started_at?: string | null
          status?: string
          total_sessions?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_session?: string | null
          error_message?: string | null
          id?: string
          legislatura?: string
          sessions_processed?: number
          speeches_inserted?: number
          started_at?: string | null
          status?: string
          total_sessions?: number
        }
        Relationships: []
      }
      politicians: {
        Row: {
          average_filler_ratio: number
          bid: number | null
          constituency: string | null
          created_at: string
          full_name: string | null
          id: string
          legislature: string | null
          name: string
          parlamento_url: string | null
          party: string
          photo_url: string | null
          total_filler_count: number
          total_speaking_seconds: number
          total_speeches: number
          total_words: number
        }
        Insert: {
          average_filler_ratio?: number
          bid?: number | null
          constituency?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          legislature?: string | null
          name: string
          parlamento_url?: string | null
          party: string
          photo_url?: string | null
          total_filler_count?: number
          total_speaking_seconds?: number
          total_speeches?: number
          total_words?: number
        }
        Update: {
          average_filler_ratio?: number
          bid?: number | null
          constituency?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          legislature?: string | null
          name?: string
          parlamento_url?: string | null
          party?: string
          photo_url?: string | null
          total_filler_count?: number
          total_speaking_seconds?: number
          total_speeches?: number
          total_words?: number
        }
        Relationships: []
      }
      sessions: {
        Row: {
          analysis_status: string | null
          artv_stream_url: string | null
          artv_video_url: string | null
          created_at: string
          dar_url: string | null
          date: string
          deputies_present: number | null
          end_time: string | null
          full_text: string | null
          id: string
          key_decisions: Json | null
          last_hls_segment: string | null
          last_hls_sequence: number | null
          legislatura: string | null
          notable_moments: Json | null
          president_name: string | null
          session_number: number | null
          start_time: string | null
          status: string
          summary_en: string | null
          summary_pt: string | null
          total_filler_count: number | null
          total_speaking_minutes: number | null
          transcript_status: string
        }
        Insert: {
          analysis_status?: string | null
          artv_stream_url?: string | null
          artv_video_url?: string | null
          created_at?: string
          dar_url?: string | null
          date: string
          deputies_present?: number | null
          end_time?: string | null
          full_text?: string | null
          id?: string
          key_decisions?: Json | null
          last_hls_segment?: string | null
          last_hls_sequence?: number | null
          legislatura?: string | null
          notable_moments?: Json | null
          president_name?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string
          summary_en?: string | null
          summary_pt?: string | null
          total_filler_count?: number | null
          total_speaking_minutes?: number | null
          transcript_status?: string
        }
        Update: {
          analysis_status?: string | null
          artv_stream_url?: string | null
          artv_video_url?: string | null
          created_at?: string
          dar_url?: string | null
          date?: string
          deputies_present?: number | null
          end_time?: string | null
          full_text?: string | null
          id?: string
          key_decisions?: Json | null
          last_hls_segment?: string | null
          last_hls_sequence?: number | null
          legislatura?: string | null
          notable_moments?: Json | null
          president_name?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string
          summary_en?: string | null
          summary_pt?: string | null
          total_filler_count?: number | null
          total_speaking_minutes?: number | null
          transcript_status?: string
        }
        Relationships: []
      }
      sessoes_legislativas: {
        Row: {
          end_date: string | null
          id: string
          legislatura_id: string | null
          number: number | null
          start_date: string | null
        }
        Insert: {
          end_date?: string | null
          id: string
          legislatura_id?: string | null
          number?: number | null
          start_date?: string | null
        }
        Update: {
          end_date?: string | null
          id?: string
          legislatura_id?: string | null
          number?: number | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessoes_legislativas_legislatura_id_fkey"
            columns: ["legislatura_id"]
            isOneToOne: false
            referencedRelation: "legislaturas"
            referencedColumns: ["id"]
          },
        ]
      }
      speeches: {
        Row: {
          created_at: string
          filler_ratio: number
          filler_word_count: number
          filler_words_detail: Json | null
          id: string
          politician_id: string | null
          session_id: string
          speaking_duration_seconds: number
          total_word_count: number
          transcript_excerpt: string | null
        }
        Insert: {
          created_at?: string
          filler_ratio?: number
          filler_word_count?: number
          filler_words_detail?: Json | null
          id?: string
          politician_id?: string | null
          session_id: string
          speaking_duration_seconds?: number
          total_word_count?: number
          transcript_excerpt?: string | null
        }
        Update: {
          created_at?: string
          filler_ratio?: number
          filler_word_count?: number
          filler_words_detail?: Json | null
          id?: string
          politician_id?: string | null
          session_id?: string
          speaking_duration_seconds?: number
          total_word_count?: number
          transcript_excerpt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speeches_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "deputy_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speeches_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speeches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "speeches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_events: {
        Row: {
          created_at: string
          duration_seconds: number | null
          filler_count: number
          filler_words_found: Json | null
          id: string
          politician_id: string | null
          session_id: string | null
          start_seconds: number | null
          text_segment: string
          total_words: number
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          filler_count?: number
          filler_words_found?: Json | null
          id?: string
          politician_id?: string | null
          session_id?: string | null
          start_seconds?: number | null
          text_segment: string
          total_words?: number
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          filler_count?: number
          filler_words_found?: Json | null
          id?: string
          politician_id?: string | null
          session_id?: string | null
          start_seconds?: number | null
          text_segment?: string
          total_words?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_events_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "deputy_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_events_politician_id_fkey"
            columns: ["politician_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "transcript_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      vote_declarations: {
        Row: {
          created_at: string
          deputy_id: string | null
          id: string
          party: string | null
          summary: string | null
          text: string | null
          vote_id: string | null
        }
        Insert: {
          created_at?: string
          deputy_id?: string | null
          id?: string
          party?: string | null
          summary?: string | null
          text?: string | null
          vote_id?: string | null
        }
        Update: {
          created_at?: string
          deputy_id?: string | null
          id?: string
          party?: string | null
          summary?: string | null
          text?: string | null
          vote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vote_declarations_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "deputy_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_declarations_deputy_id_fkey"
            columns: ["deputy_id"]
            isOneToOne: false
            referencedRelation: "politicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_declarations_vote_id_fkey"
            columns: ["vote_id"]
            isOneToOne: false
            referencedRelation: "votes"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          abstain: string[] | null
          against: string[] | null
          agenda_item_id: string | null
          created_at: string
          description: string | null
          dissidents: Json | null
          favor: string[] | null
          id: string
          initiative_reference: string | null
          result: string | null
          sequence_number: number | null
          session_id: string | null
        }
        Insert: {
          abstain?: string[] | null
          against?: string[] | null
          agenda_item_id?: string | null
          created_at?: string
          description?: string | null
          dissidents?: Json | null
          favor?: string[] | null
          id?: string
          initiative_reference?: string | null
          result?: string | null
          sequence_number?: number | null
          session_id?: string | null
        }
        Update: {
          abstain?: string[] | null
          against?: string[] | null
          agenda_item_id?: string | null
          created_at?: string
          description?: string | null
          dissidents?: Json | null
          favor?: string[] | null
          id?: string
          initiative_reference?: string | null
          result?: string | null
          sequence_number?: number | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "votes_agenda_item_id_fkey"
            columns: ["agenda_item_id"]
            isOneToOne: false
            referencedRelation: "agenda_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_session_status"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      deputy_activity: {
        Row: {
          constituency: string | null
          id: string | null
          mic_cutoffs: number | null
          name: string | null
          party: string | null
          sessions_active: number | null
          total_filler_words: number | null
          total_interventions: number | null
          total_words: number | null
        }
        Relationships: []
      }
      live_session_status: {
        Row: {
          artv_stream_url: string | null
          date: string | null
          event_count: number | null
          last_event_at: string | null
          last_hls_sequence: number | null
          session_id: string | null
          start_time: string | null
          status: string | null
          total_fillers: number | null
          total_words: number | null
          transcript_status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      refresh_all_politician_stats: { Args: never; Returns: Json }
      refresh_politician_stats: {
        Args: { p_politician_id: string }
        Returns: undefined
      }
      search_sessions_fts: {
        Args: {
          filter_leg?: string
          filter_party?: string
          query_text: string
          result_limit?: number
        }
        Returns: {
          date: string
          id: string
          legislatura: string
          session_number: number
          snippet: string
          summary_pt: string
        }[]
      }
      update_session_hls_url: {
        Args: { p_hls_url: string; p_session_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
