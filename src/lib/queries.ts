// Supabase query helpers + React Query hooks
// Falls back to mock data when Supabase tables are empty (pre-worker deployment)

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  mockPoliticians,
  mockSpeeches,
  mockTopFillerWords,
  mockFillerRankByParty,
  mockSpeakingByParty,
  mockFillerTrend,
} from "@/lib/mock-data";

// ─── Politicians ────────────────────────────────────────────────────────────

export interface Politician {
  id: string;
  name: string;
  party: string;
  photo_url: string | null;
  parlamento_url: string | null;
  total_speaking_seconds: number;
  total_filler_count: number;
  total_speeches: number;
  average_filler_ratio: number;
}

export function usePoliticians() {
  return useQuery({
    queryKey: ["politicians"],
    queryFn: async (): Promise<Politician[]> => {
      const { data, error } = await supabase
        .from("politicians")
        .select("*")
        .order("total_speaking_seconds", { ascending: false });
      if (error) throw error;
      if (data && data.length > 0) return data as Politician[];
      return mockPoliticians as Politician[];
    },
    staleTime: 30_000,
  });
}

// ─── Speeches ────────────────────────────────────────────────────────────────

export interface Speech {
  id: string;
  session_id: string;
  politician_id: string;
  speaking_duration_seconds: number;
  filler_word_count: number;
  total_word_count: number;
  filler_ratio: number;
  transcript_excerpt: string | null;
  filler_words_detail: Record<string, number> | null;
  created_at: string;
  politician: Politician;
  session_date?: string;
}

export function useSpeeches(partyFilter?: string | null) {
  return useQuery({
    queryKey: ["speeches", partyFilter],
    queryFn: async (): Promise<Speech[]> => {
      let q = supabase
        .from("speeches")
        .select("*, politician:politicians(*), session:sessions(date)")
        .order("created_at", { ascending: false })
        .limit(100);

      const { data, error } = await q;
      if (error) throw error;

      if (data && data.length > 0) {
        const mapped = data.map((s: any) => ({
          ...s,
          session_date: s.session?.date ?? null,
          filler_words_detail: s.filler_words_detail as Record<string, number> | null,
        })) as Speech[];
        if (partyFilter) return mapped.filter(s => s.politician.party === partyFilter);
        return mapped;
      }

      // Fallback to mock
      const mock = mockSpeeches.map(s => ({
        ...s,
        session_id: "mock-session",
        politician_id: s.politician.id,
        created_at: s.session_date + "T10:00:00Z",
        politician: s.politician as Politician,
        session_date: s.session_date,
      })) as Speech[];
      if (partyFilter) return mock.filter(s => s.politician.party === partyFilter);
      return mock;
    },
    staleTime: 15_000,
  });
}

// ─── Live transcript events ───────────────────────────────────────────────────

export interface TranscriptEvent {
  id: string;
  session_id: string | null;
  politician_id: string | null;
  text_segment: string;
  filler_count: number;
  total_words: number;
  filler_words_found: Record<string, number>;
  start_seconds: number | null;
  duration_seconds: number | null;
  created_at: string;
  politician?: Politician | null;
}

export function useTranscriptEvents(sessionId?: string | null) {
  return useQuery({
    queryKey: ["transcript_events", sessionId],
    queryFn: async (): Promise<TranscriptEvent[]> => {
      let q = supabase
        .from("transcript_events")
        .select("*, politician:politicians(*)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (sessionId) q = q.eq("session_id", sessionId);

      const { data, error } = await q;
      if (error) return [];
      return (data ?? []) as unknown as TranscriptEvent[];
    },
    staleTime: 0,
    refetchInterval: 5000,
  });
}

/** Subscribe to new transcript_events via Supabase Realtime */
export function useTranscriptRealtime(
  onEvent: (event: TranscriptEvent) => void,
  sessionId?: string | null
) {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("transcript_events_live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transcript_events",
          ...(sessionId ? { filter: `session_id=eq.${sessionId}` } : {}),
        },
        async (payload) => {
          const ev = payload.new as unknown as TranscriptEvent;
          // Fetch politician if present
          if (ev.politician_id) {
            const { data } = await supabase
              .from("politicians")
              .select("*")
              .eq("id", ev.politician_id)
              .single();
            ev.politician = data as Politician | null;
          }
          onEvent(ev);
          qc.invalidateQueries({ queryKey: ["transcript_events"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, onEvent, qc]);
}

// ─── Active session ───────────────────────────────────────────────────────────

export interface Session {
  id: string;
  date: string;
  status: string;
  artv_stream_url: string | null;
  start_time: string | null;
  end_time: string | null;
  total_filler_count: number | null;
  total_speaking_minutes: number | null;
  transcript_status: string;
}

export function useActiveSession() {
  return useQuery({
    queryKey: ["active_session"],
    queryFn: async (): Promise<Session | null> => {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("status", "live")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as Session | null;
    },
    refetchInterval: 30_000,
  });
}

// ─── Stats aggregates ─────────────────────────────────────────────────────────

export function usePartyStats() {
  return useQuery({
    queryKey: ["party_stats"],
    queryFn: async () => {
      const { data } = await supabase.from("politicians").select("*");
      if (data && data.length > 0) {
        return buildPartyStats(data as Politician[]);
      }
      return { fillerByParty: mockFillerRankByParty, speakingByParty: mockSpeakingByParty };
    },
    staleTime: 60_000,
  });
}

function buildPartyStats(politicians: Politician[]) {
  const parties = [...new Set(politicians.map(p => p.party))];
  const fillerByParty = parties.map(party => {
    const pols = politicians.filter(p => p.party === party);
    const avg = pols.length > 0
      ? pols.reduce((s, p) => s + p.average_filler_ratio, 0) / pols.length
      : 0;
    return { party, avgFillerRatio: Math.round(avg * 1000) / 10 };
  });
  const speakingByParty = parties.map(party => {
    const total = politicians.filter(p => p.party === party).reduce((s, p) => s + p.total_speaking_seconds, 0);
    return { party, totalMinutes: Math.round(total / 60) };
  });
  return { fillerByParty, speakingByParty };
}

export function useTopFillerWords() {
  return useQuery({
    queryKey: ["top_filler_words"],
    queryFn: async () => {
      // Aggregate from speeches filler_words_detail
      const { data } = await supabase
        .from("speeches")
        .select("filler_words_detail");
      if (data && data.length > 0) {
        const agg: Record<string, number> = {};
        for (const row of data) {
          const detail = row.filler_words_detail as Record<string, number> | null;
          if (!detail) continue;
          for (const [word, count] of Object.entries(detail)) {
            agg[word] = (agg[word] ?? 0) + count;
          }
        }
        return Object.entries(agg)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([word, count]) => ({ word, count }));
      }
      return mockTopFillerWords;
    },
    staleTime: 60_000,
  });
}

/**
 * Refreshes aggregated politician stats from transcript_events.
 * Called automatically on page load for recordings/politician pages.
 * The DB trigger keeps stats live for new inserts — this RPC catches up
 * any backlog (e.g. events inserted before the trigger existed).
 * staleTime of 5 min ensures we don't hammer the DB on every render.
 */
export function useRefreshPoliticianStats() {
  return useQuery({
    queryKey: ["refresh_politician_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("refresh_all_politician_stats");
      if (error) {
        // Non-fatal: stats will still be correct for new events via the trigger
        console.warn("[stats] refresh_all_politician_stats:", error.message);
        return null;
      }
      return data as { refreshed_politicians: number; refreshed_at: string } | null;
    },
    staleTime: 5 * 60_000,      // run at most once per 5 minutes per tab
    refetchOnWindowFocus: false,
  });
}

// ─── Plenário historic sessions ───────────────────────────────────────────────

export interface PlenarioSession {
  id: string;
  date: string;
  legislatura: string | null;
  dar_url: string | null;
  session_number: number | null;
  status: string;
  speech_count?: number;
}

export function usePlenarioSessions(legislatura = "XVII") {
  return useQuery({
    queryKey: ["plenario_sessions", legislatura],
    queryFn: async (): Promise<PlenarioSession[]> => {
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select("id, date, legislatura, dar_url, session_number, status")
        .eq("legislatura", legislatura)
        .order("date", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!sessions?.length) return [];

      const sessionIds = sessions.map(s => s.id);
      const { data: speechCounts } = await supabase
        .from("speeches")
        .select("session_id")
        .in("session_id", sessionIds);

      const countMap: Record<string, number> = {};
      for (const row of speechCounts ?? []) {
        countMap[row.session_id] = (countMap[row.session_id] ?? 0) + 1;
      }

      return sessions.map(s => ({
        ...(s as any),
        speech_count: countMap[s.id] ?? 0,
      })) as PlenarioSession[];
    },
    staleTime: 30_000,
  });
}

export interface PlenarioImportJob {
  id: string;
  legislatura: string;
  status: string;
  total_sessions: number;
  sessions_processed: number;
  speeches_inserted: number;
  current_session: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export function usePlenarioImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ["plenario_import_job", jobId],
    queryFn: async (): Promise<PlenarioImportJob | null> => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("plenario_import_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error) return null;
      return data as unknown as PlenarioImportJob;
    },
    enabled: !!jobId,
    refetchInterval: 3000,
    staleTime: 0,
  });
}

export function useFillerTrend() {
  return useQuery({
    queryKey: ["filler_trend"],
    queryFn: async () => {
      const { data } = await supabase
        .from("speeches")
        .select("filler_ratio, created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      if (data && data.length > 0) {
        // Group by date
        const byDate: Record<string, number[]> = {};
        for (const row of data) {
          const d = row.created_at.slice(0, 10);
          if (!byDate[d]) byDate[d] = [];
          byDate[d].push(row.filler_ratio);
        }
        return Object.entries(byDate).map(([date, ratios]) => ({
          date: new Date(date).toLocaleDateString("pt-PT", { weekday: "short" }),
          fillerRatio: +(ratios.reduce((s, r) => s + r, 0) / ratios.length * 100).toFixed(2),
        }));
      }
      return mockFillerTrend;
    },
    staleTime: 60_000,
  });
}
