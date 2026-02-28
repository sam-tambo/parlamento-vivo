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
      politicians: {
        Row: {
          average_filler_ratio: number
          created_at: string
          id: string
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
          created_at?: string
          id?: string
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
          created_at?: string
          id?: string
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
      plenario_import_jobs: {
        Row: {
          id: string
          legislatura: string
          status: string
          total_sessions: number
          sessions_processed: number
          speeches_inserted: number
          current_session: string | null
          error_message: string | null
          started_at: string
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          legislatura?: string
          status?: string
          total_sessions?: number
          sessions_processed?: number
          speeches_inserted?: number
          current_session?: string | null
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          legislatura?: string
          status?: string
          total_sessions?: number
          sessions_processed?: number
          speeches_inserted?: number
          current_session?: string | null
          error_message?: string | null
          started_at?: string
          completed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          artv_stream_url: string | null
          artv_video_url: string | null
          created_at: string
          dar_url: string | null
          date: string
          end_time: string | null
          id: string
          last_hls_segment: string | null
          last_hls_sequence: number | null
          legislatura: string | null
          session_number: number | null
          start_time: string | null
          status: string
          total_filler_count: number | null
          total_speaking_minutes: number | null
          transcript_status: string
        }
        Insert: {
          artv_stream_url?: string | null
          artv_video_url?: string | null
          created_at?: string
          dar_url?: string | null
          date: string
          end_time?: string | null
          id?: string
          last_hls_segment?: string | null
          last_hls_sequence?: number | null
          legislatura?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string
          total_filler_count?: number | null
          total_speaking_minutes?: number | null
          transcript_status?: string
        }
        Update: {
          artv_stream_url?: string | null
          artv_video_url?: string | null
          created_at?: string
          dar_url?: string | null
          date?: string
          end_time?: string | null
          id?: string
          last_hls_segment?: string | null
          last_hls_sequence?: number | null
          legislatura?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string
          total_filler_count?: number | null
          total_speaking_minutes?: number | null
          transcript_status?: string
        }
        Relationships: []
      }
      speeches: {
        Row: {
          created_at: string
          filler_ratio: number
          filler_word_count: number
          filler_words_detail: Json | null
          id: string
          politician_id: string
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
          politician_id: string
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
          politician_id?: string
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
            referencedRelation: "politicians"
            referencedColumns: ["id"]
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
          filler_words_found: Json
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
          filler_words_found?: Json
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
          filler_words_found?: Json
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
            referencedRelation: "politicians"
            referencedColumns: ["id"]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      refresh_all_politician_stats: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      refresh_politician_stats: {
        Args: { p_id: string }
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
