
-- ============================================================
-- Comprehensive migration: align DB with main branch migrations 004-011
-- ============================================================

-- 1. sessions: add missing columns
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS last_hls_sequence bigint;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS last_hls_segment text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS legislatura text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS dar_url text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_number integer;

-- 2. politicians: add missing columns
ALTER TABLE public.politicians ADD COLUMN IF NOT EXISTS total_words integer NOT NULL DEFAULT 0;
ALTER TABLE public.politicians ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.politicians ADD COLUMN IF NOT EXISTS constituency text;
ALTER TABLE public.politicians ADD COLUMN IF NOT EXISTS legislature text DEFAULT 'XVI';

-- bid needs unique constraint; add column then constraint separately
ALTER TABLE public.politicians ADD COLUMN IF NOT EXISTS bid integer;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'politicians_bid_key'
  ) THEN
    ALTER TABLE public.politicians ADD CONSTRAINT politicians_bid_key UNIQUE (bid);
  END IF;
END $$;

-- 3. speeches: make politician_id nullable
ALTER TABLE public.speeches ALTER COLUMN politician_id DROP NOT NULL;

-- 4. Missing indexes
CREATE INDEX IF NOT EXISTS idx_sessions_legislatura ON public.sessions(legislatura);
CREATE INDEX IF NOT EXISTS idx_politicians_bid ON public.politicians(bid);

-- 5. RLS policies for service role INSERT/UPDATE on sessions and speeches
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'Service role can insert sessions') THEN
    CREATE POLICY "Service role can insert sessions" ON public.sessions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'Service role can update sessions') THEN
    CREATE POLICY "Service role can update sessions" ON public.sessions FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'speeches' AND policyname = 'Service role can insert speeches') THEN
    CREATE POLICY "Service role can insert speeches" ON public.speeches FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'speeches' AND policyname = 'Service role can update speeches') THEN
    CREATE POLICY "Service role can update speeches" ON public.speeches FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6. plenario_import_jobs table
CREATE TABLE IF NOT EXISTS public.plenario_import_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legislatura text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_sessions integer NOT NULL DEFAULT 0,
  sessions_processed integer NOT NULL DEFAULT 0,
  speeches_inserted integer NOT NULL DEFAULT 0,
  current_session text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plenario_import_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plenario_import_jobs' AND policyname = 'Import jobs are publicly readable') THEN
    CREATE POLICY "Import jobs are publicly readable" ON public.plenario_import_jobs FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plenario_import_jobs' AND policyname = 'Service role can manage import jobs') THEN
    CREATE POLICY "Service role can manage import jobs" ON public.plenario_import_jobs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Realtime for plenario_import_jobs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'plenario_import_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.plenario_import_jobs;
  END IF;
END $$;

-- 7. Database functions

-- refresh_politician_stats: recompute one politician's stats from transcript_events
CREATE OR REPLACE FUNCTION public.refresh_politician_stats(p_politician_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_filler   integer;
  v_total_words    integer;
  v_total_seconds  real;
  v_total_speeches integer;
  v_ratio          real;
BEGIN
  SELECT
    COALESCE(SUM(filler_count), 0),
    COALESCE(SUM(total_words), 0),
    COALESCE(SUM(duration_seconds), 0)
  INTO v_total_filler, v_total_words, v_total_seconds
  FROM public.transcript_events
  WHERE politician_id = p_politician_id;

  SELECT COUNT(DISTINCT id)
  INTO v_total_speeches
  FROM public.speeches
  WHERE politician_id = p_politician_id;

  IF v_total_words > 0 THEN
    v_ratio := v_total_filler::real / v_total_words::real;
  ELSE
    v_ratio := 0;
  END IF;

  UPDATE public.politicians SET
    total_filler_count     = v_total_filler,
    total_words            = v_total_words,
    total_speaking_seconds = v_total_seconds::integer,
    total_speeches         = v_total_speeches,
    average_filler_ratio   = v_ratio
  WHERE id = p_politician_id;
END;
$$;

-- refresh_all_politician_stats: backfill all politicians
CREATE OR REPLACE FUNCTION public.refresh_all_politician_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pol RECORD;
  v_count integer := 0;
BEGIN
  FOR v_pol IN SELECT id FROM public.politicians LOOP
    PERFORM public.refresh_politician_stats(v_pol.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

-- update_session_hls_url: convenience RPC
CREATE OR REPLACE FUNCTION public.update_session_hls_url(p_session_id uuid, p_hls_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sessions
  SET artv_stream_url = p_hls_url
  WHERE id = p_session_id;
END;
$$;

-- Trigger function: auto-update politician stats on transcript_events changes
CREATE OR REPLACE FUNCTION public.trg_update_politician_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.politician_id IS NOT NULL THEN
    PERFORM public.refresh_politician_stats(NEW.politician_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.politician_id IS NOT NULL AND OLD.politician_id IS DISTINCT FROM NEW.politician_id THEN
    PERFORM public.refresh_politician_stats(OLD.politician_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Grant EXECUTE to anon and authenticated
GRANT EXECUTE ON FUNCTION public.refresh_politician_stats(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_all_politician_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_session_hls_url(uuid, text) TO anon, authenticated;

-- 8. Triggers on transcript_events
DROP TRIGGER IF EXISTS trg_transcript_events_stats_insert ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_insert
  AFTER INSERT ON public.transcript_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_politician_stats();

DROP TRIGGER IF EXISTS trg_transcript_events_stats_update ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_update
  AFTER UPDATE ON public.transcript_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_politician_stats();

-- 9. live_session_status view
CREATE OR REPLACE VIEW public.live_session_status AS
SELECT
  s.id AS session_id,
  s.date,
  s.status,
  s.transcript_status,
  s.artv_stream_url,
  s.start_time,
  s.last_hls_sequence,
  COUNT(te.id) AS event_count,
  MAX(te.created_at) AS last_event_at,
  COALESCE(SUM(te.total_words), 0) AS total_words,
  COALESCE(SUM(te.filler_count), 0) AS total_fillers
FROM public.sessions s
LEFT JOIN public.transcript_events te ON te.session_id = s.id
WHERE s.status = 'live'
GROUP BY s.id, s.date, s.status, s.transcript_status, s.artv_stream_url, s.start_time, s.last_hls_sequence;
