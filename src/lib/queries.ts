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
        // Filter out speeches where politician join returned null
        // (happens when politician_id is null after making the column nullable)
        const mapped = data
          .filter((s: any) => s.politician != null)
          .map((s: any) => ({
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
      const { data, error } = await (supabase as any).rpc("refresh_all_politician_stats");
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
      // Try querying with legislatura column (available after migration 011).
      // If the column doesn't exist yet, fall back to status-based filter so
      // the page still renders without crashing.
      let sessions: any[] | null = null;

      const { data: withLeg, error: legErr } = await (supabase as any)
        .from("sessions")
        .select("id, date, legislatura, dar_url, session_number, status")
        .eq("legislatura", legislatura)
        .order("date", { ascending: false })
        .limit(200);

      if (!legErr) {
        sessions = withLeg;
      } else {
        // Column doesn't exist yet — show all completed sessions as fallback
        const { data: fallback } = await supabase
          .from("sessions")
          .select("id, date, status")
          .eq("status", "completed")
          .order("date", { ascending: false })
          .limit(200);
        sessions = fallback ?? [];
      }

      if (!sessions?.length) return [];

      // Count speeches per session
      const sessionIds = sessions.map((s: any) => s.id);
      const { data: speechCounts } = await supabase
        .from("speeches")
        .select("session_id")
        .in("session_id", sessionIds);

      const countMap: Record<string, number> = {};
      for (const row of speechCounts ?? []) {
        countMap[row.session_id] = (countMap[row.session_id] ?? 0) + 1;
      }

      return sessions.map((s: any) => ({
        id: s.id,
        date: s.date,
        legislatura: s.legislatura ?? null,
        dar_url: s.dar_url ?? null,
        session_number: s.session_number ?? null,
        status: s.status,
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
      const { data, error } = await (supabase as any)
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

// ─── Parlamento Aberto — Sessions ────────────────────────────────────────────

export interface SessionFull {
  id: string;
  date: string;
  status: string;
  legislatura: string | null;
  session_number: number | null;
  dar_url: string | null;
  summary_pt: string | null;
  summary_en: string | null;
  key_decisions: Array<{ description: string; result: string; significance?: string }> | null;
  notable_moments: Array<{ type: string; description: string; deputies_involved?: string[] }> | null;
  analysis_status: string | null;
  deputies_present: number | null;
  president_name: string | null;
  full_text: string | null;
}

export function useSessions(leg: string = "XVII", limit: number = 50) {
  return useQuery({
    queryKey: ["sessions_aberto", leg, limit],
    queryFn: async (): Promise<SessionFull[]> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id,date,status,legislatura,session_number,dar_url,summary_pt,analysis_status,deputies_present,president_name")
        .eq("legislatura", leg)
        .order("date", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as SessionFull[];
    },
    staleTime: 60_000,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: ["session_detail", id],
    queryFn: async (): Promise<SessionFull | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SessionFull | null;
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ─── Interventions ────────────────────────────────────────────────────────────

export interface Intervention {
  id: string;
  session_id: string;
  deputy_id: string | null;
  deputy_name: string;
  party: string | null;
  type: string;
  sequence_number: number | null;
  text: string;
  word_count: number | null;
  estimated_duration_seconds: number | null;
  applause_from: string[] | null;
  protests_from: string[] | null;
  interrupted_by: string[] | null;
  was_mic_cutoff: boolean;
  filler_word_count: number;
  filler_words_detail: Record<string, number> | null;
  topic_tags: string[] | null;
}

export function useInterventions(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["interventions", sessionId],
    queryFn: async (): Promise<Intervention[]> => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("interventions")
        .select("*")
        .eq("session_id", sessionId)
        .order("sequence_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Intervention[];
    },
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}

// ─── Votes ────────────────────────────────────────────────────────────────────

export interface Vote {
  id: string;
  session_id: string;
  agenda_item_id: string | null;
  initiative_reference: string | null;
  description: string | null;
  result: string | null;
  favor: string[] | null;
  against: string[] | null;
  abstain: string[] | null;
  dissidents: Array<{ name: string; party: string; vote: string }> | null;
  sequence_number: number | null;
}

export function useVotes(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["votes", sessionId],
    queryFn: async (): Promise<Vote[]> => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("votes")
        .select("*")
        .eq("session_id", sessionId)
        .order("sequence_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Vote[];
    },
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}

// ─── Deputy activity (materialized view) ──────────────────────────────────────

export interface DeputyActivity {
  id: string;
  name: string;
  party: string;
  constituency: string | null;
  sessions_active: number;
  total_interventions: number;
  total_words: number;
  mic_cutoffs: number;
  total_filler_words: number;
}

export function useDeputyActivity() {
  return useQuery({
    queryKey: ["deputy_activity"],
    queryFn: async (): Promise<DeputyActivity[]> => {
      const { data, error } = await supabase
        .from("deputy_activity")
        .select("*")
        .order("total_words", { ascending: false })
        .limit(230);
      if (error) {
        // View may not exist yet — return empty
        console.warn("[deputy_activity]", error.message);
        return [];
      }
      return (data ?? []) as unknown as DeputyActivity[];
    },
    staleTime: 5 * 60_000,
  });
}

// ─── Full-text search ─────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  date: string;
  session_number: number | null;
  legislatura: string | null;
  summary_pt: string | null;
  snippet?: string;
}

export function useSearchSessions(query: string, party?: string, leg?: string) {
  return useQuery({
    queryKey: ["search_sessions", query, party, leg],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!query.trim()) return [];
      // Use edge function if available; fallback to basic ilike
      try {
        const params = new URLSearchParams({ q: query });
        if (party) params.set("party", party);
        if (leg)   params.set("leg",   leg);
        const { data, error } = await supabase.functions.invoke("search-sessions", {
          body: { q: query, party, leg },
        });
        if (!error && Array.isArray(data)) return data as SearchResult[];
      } catch {
        // fallback
      }
      // Simple fallback: ilike on summary_pt
      const { data } = await supabase
        .from("sessions")
        .select("id,date,session_number,legislatura,summary_pt")
        .ilike("summary_pt", `%${query}%`)
        .order("date", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as SearchResult[];
    },
    enabled: query.trim().length > 2,
    staleTime: 30_000,
  });
}

// ─── Party positions ──────────────────────────────────────────────────────────

export interface PartyPosition {
  id: string;
  topic: string;
  party: string;
  session_id: string;
  position_summary: string | null;
  vote_alignment: string | null;
}

export function usePartyPositions(party?: string, topic?: string) {
  return useQuery({
    queryKey: ["party_positions", party, topic],
    queryFn: async (): Promise<PartyPosition[]> => {
      let q = supabase.from("party_positions").select("*");
      if (party) q = q.eq("party", party);
      if (topic) q = q.ilike("topic", `%${topic}%`);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
      if (error) {
        console.warn("[party_positions]", error.message);
        return [];
      }
      return (data ?? []) as unknown as PartyPosition[];
    },
    staleTime: 2 * 60_000,
  });
}

// ─── Homepage aggregates ─────────────────────────────────────────────────────

export function useLatestVotes(limit: number = 10) {
  return useQuery({
    queryKey: ["latest_votes", limit],
    queryFn: async (): Promise<(Vote & { session_date?: string })[]> => {
      const { data, error } = await supabase
        .from("votes")
        .select("*, session:sessions(date)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        ...v,
        session_date: v.session?.date ?? null,
      })) as (Vote & { session_date?: string })[];
    },
    staleTime: 60_000,
  });
}

export function useGlobalStats() {
  return useQuery({
    queryKey: ["global_stats"],
    queryFn: async () => {
      const [sessionsRes, interventionsRes, votesRes] = await Promise.all([
        supabase.from("sessions").select("id", { count: "exact", head: true }),
        supabase.from("interventions").select("id", { count: "exact", head: true }),
        supabase.from("votes").select("id", { count: "exact", head: true }),
      ]);
      return {
        sessions: sessionsRes.count ?? 0,
        interventions: interventionsRes.count ?? 0,
        votes: votesRes.count ?? 0,
      };
    },
    staleTime: 5 * 60_000,
  });
}

// ─── Deputy profile ──────────────────────────────────────────────────────────

export interface DeputyProfile {
  id: string;
  name: string;
  full_name: string | null;
  party: string;
  constituency: string | null;
  photo_url: string | null;
  parlamento_url: string | null;
  total_speaking_seconds: number;
  total_filler_count: number;
  total_speeches: number;
  total_words: number;
  average_filler_ratio: number;
}

export function useDeputyProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["deputy_profile", id],
    queryFn: async (): Promise<DeputyProfile | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("politicians")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DeputyProfile | null;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useDeputyInterventions(deputyName: string | undefined, limit: number = 20) {
  return useQuery({
    queryKey: ["deputy_interventions", deputyName, limit],
    queryFn: async (): Promise<(Intervention & { session_date?: string })[]> => {
      if (!deputyName) return [];
      const { data, error } = await supabase
        .from("interventions")
        .select("*, session:sessions(date)")
        .eq("deputy_name", deputyName)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((iv: any) => ({
        ...iv,
        session_date: iv.session?.date ?? null,
      })) as (Intervention & { session_date?: string })[];
    },
    enabled: !!deputyName,
    staleTime: 60_000,
  });
}

export function useDeputyVoteDissidences(deputyName: string | undefined) {
  return useQuery({
    queryKey: ["deputy_dissidences", deputyName],
    queryFn: async (): Promise<{ total_votes: number; dissidences: number }> => {
      if (!deputyName) return { total_votes: 0, dissidences: 0 };
      // Get all votes and check dissidents array for this deputy
      const { data, error } = await supabase
        .from("votes")
        .select("dissidents")
        .not("dissidents", "is", null);
      if (error) return { total_votes: 0, dissidences: 0 };
      const allVotes = data ?? [];
      let dissidences = 0;
      for (const v of allVotes) {
        const diss = v.dissidents as Array<{ name: string }> | null;
        if (diss?.some(d => d.name === deputyName)) dissidences++;
      }
      // Total votes is approximate — count all votes
      const { count } = await supabase.from("votes").select("id", { count: "exact", head: true });
      return { total_votes: count ?? 0, dissidences };
    },
    enabled: !!deputyName,
    staleTime: 5 * 60_000,
  });
}

// ─── Vote declarations ───────────────────────────────────────────────────────

export interface VoteDeclaration {
  id: string;
  vote_id: string;
  session_id: string;
  deputy_name: string;
  party: string | null;
  declaration_text: string;
}

export function useVoteDeclarations(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["vote_declarations", sessionId],
    queryFn: async (): Promise<VoteDeclaration[]> => {
      if (!sessionId) return [];
      const { data, error } = await (supabase
        .from("vote_declarations")
        .select("*") as any)
        .eq("session_id", sessionId);
      if (error) {
        console.warn("[vote_declarations]", error.message);
        return [];
      }
      return (data ?? []) as unknown as VoteDeclaration[];
    },
    enabled: !!sessionId,
    staleTime: 60_000,
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
