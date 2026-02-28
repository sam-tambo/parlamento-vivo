-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: Complete schema fix (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Lovable Cloud database was missing several objects that edge functions
-- depend on. This migration creates everything with IF NOT EXISTS / DO blocks
-- so it is safe to run on any database state (fresh or partially migrated).
--
-- Objects created / fixed:
--   1. transcript_events table  ← the live feed table; MISSING from DB
--   2. sessions.last_hls_sequence / last_hls_segment  ← plenario-cron cursor
--   3. politicians.total_words  ← needed for filler-ratio calculations
--   4. RLS policies for all tables
--   5. Realtime publication for transcript_events
--   6. refresh_politician_stats() / refresh_all_politician_stats() functions
--   7. Auto-update triggers on transcript_events
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. transcript_events ─────────────────────────────────────────────────────
-- Core live-feed table. Each row is one ~30-second transcribed audio chunk.
-- The transcribe edge function INSERTs here; the frontend subscribes via
-- Supabase Realtime to display results instantly.

CREATE TABLE IF NOT EXISTS public.transcript_events (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id         uuid        REFERENCES public.sessions(id) ON DELETE CASCADE,
  politician_id      uuid        REFERENCES public.politicians(id) ON DELETE SET NULL,
  text_segment       text        NOT NULL,
  filler_count       integer     NOT NULL DEFAULT 0,
  total_words        integer     NOT NULL DEFAULT 0,
  filler_words_found jsonb       NOT NULL DEFAULT '{}'::jsonb,
  start_seconds      real,
  duration_seconds   real,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transcript_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transcript_events'
      AND policyname = 'Transcript events are publicly readable'
  ) THEN
    CREATE POLICY "Transcript events are publicly readable"
      ON public.transcript_events FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transcript_events'
      AND policyname = 'Service role can insert transcript events'
  ) THEN
    CREATE POLICY "Service role can insert transcript events"
      ON public.transcript_events FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transcript_events_session
  ON public.transcript_events (session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_events_politician
  ON public.transcript_events (politician_id);
CREATE INDEX IF NOT EXISTS idx_transcript_events_created
  ON public.transcript_events (created_at DESC);

-- Enable Supabase Realtime so the React frontend gets live updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname   = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'transcript_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_events;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL; -- publication doesn't exist in test envs
END $$;

-- ── 2. sessions — missing HLS cursor columns ──────────────────────────────────
-- plenario-cron tracks which HLS segments it has already processed.
-- Without these columns it re-transcribes the same segments every minute.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS last_hls_sequence bigint,
  ADD COLUMN IF NOT EXISTS last_hls_segment  text;

-- RLS: edge functions use the service role key, so they need INSERT + UPDATE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sessions'
      AND policyname = 'Service role can insert sessions'
  ) THEN
    CREATE POLICY "Service role can insert sessions"
      ON public.sessions FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sessions'
      AND policyname = 'Service role can update sessions'
  ) THEN
    CREATE POLICY "Service role can update sessions"
      ON public.sessions FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 3. politicians — add total_words for filler-ratio denominator ─────────────

ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS total_words integer NOT NULL DEFAULT 0;

-- ── 4. Auto-update politician stats after every transcript insert ─────────────
-- Keeps the leaderboard / politician pages accurate in real time without any
-- frontend polling — the DB trigger fires on every INSERT into transcript_events.

CREATE OR REPLACE FUNCTION public.refresh_politician_stats(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fillers bigint;
  v_words   bigint;
  v_secs    real;
  v_events  bigint;
BEGIN
  SELECT
    COALESCE(SUM(filler_count),     0),
    COALESCE(SUM(total_words),      0),
    COALESCE(SUM(duration_seconds), 0.0),
    COUNT(*)
  INTO v_fillers, v_words, v_secs, v_events
  FROM public.transcript_events
  WHERE politician_id = p_id;

  UPDATE public.politicians SET
    total_filler_count     = v_fillers,
    total_words            = v_words,
    total_speaking_seconds = v_secs::integer,
    total_speeches         = GREATEST(total_speeches, v_events),
    average_filler_ratio   = CASE
                               WHEN v_words > 0 THEN v_fillers::real / v_words
                               ELSE 0
                             END
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_update_politician_stats()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.politician_id IS NOT NULL THEN
    PERFORM public.refresh_politician_stats(NEW.politician_id);
  END IF;
  -- On UPDATE: if speaker changed, also refresh the old politician
  IF TG_OP = 'UPDATE'
     AND OLD.politician_id IS NOT NULL
     AND OLD.politician_id IS DISTINCT FROM NEW.politician_id
  THEN
    PERFORM public.refresh_politician_stats(OLD.politician_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transcript_events_stats_insert ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_insert
  AFTER INSERT ON public.transcript_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_politician_stats();

DROP TRIGGER IF EXISTS trg_transcript_events_stats_update ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_update
  AFTER UPDATE OF politician_id, filler_count, total_words, duration_seconds
  ON public.transcript_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_politician_stats();

-- ── 5. refresh_all_politician_stats() — callable from the browser ─────────────
-- Used by useRefreshPoliticianStats() in the frontend to backfill stats when
-- the recordings / leaderboard page loads.

CREATE OR REPLACE FUNCTION public.refresh_all_politician_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pid   uuid;
  v_count integer := 0;
BEGIN
  FOR v_pid IN (
    SELECT DISTINCT politician_id
    FROM   public.transcript_events
    WHERE  politician_id IS NOT NULL
  ) LOOP
    PERFORM public.refresh_politician_stats(v_pid);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'refreshed_politicians', v_count,
    'refreshed_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_all_politician_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_politician_stats(uuid) TO anon, authenticated;

-- ── 6. speeches.politician_id — make nullable ─────────────────────────────────
-- The original migration 002 created speeches.politician_id as NOT NULL.
-- This prevents storing speeches for unidentified speakers (e.g. from the
-- historic plenário scraper when a speaker name doesn't match any politician).
-- Making it nullable allows us to store all speeches and match them later.
ALTER TABLE public.speeches ALTER COLUMN politician_id DROP NOT NULL;

-- Add INSERT + UPDATE RLS policies for service role on speeches
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'speeches'
      AND policyname = 'Service role can insert speeches'
  ) THEN
    CREATE POLICY "Service role can insert speeches"
      ON public.speeches FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'speeches'
      AND policyname = 'Service role can update speeches'
  ) THEN
    CREATE POLICY "Service role can update speeches"
      ON public.speeches FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;
