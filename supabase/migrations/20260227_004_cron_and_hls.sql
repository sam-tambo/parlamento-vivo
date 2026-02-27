-- ============================================================
-- Migration 004: pg_cron schedule + HLS URL helper
-- ============================================================
-- Requires pg_cron extension (enabled by default on Supabase Pro).
-- On Supabase Free tier use the Dashboard cron scheduler instead:
--   Dashboard → Edge Functions → plenario-cron → Schedules → Add
--   Expression: */1 * * * *  (every minute; Supabase min is 1 min)
-- ============================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Give pg_cron permission to call Supabase edge functions via net extension
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Schedule: call plenario-cron every minute ────────────────────────────────
-- (Supabase edge functions can be called from pg_cron via pg_net HTTP requests)
-- Replace <PROJECT_REF> and <ANON_KEY> with your values,
-- OR set via Supabase Dashboard → Integrations → pg_cron after applying migration.

-- Uncomment and fill in to activate:
/*
SELECT cron.schedule(
  'plenario-transcription-loop',   -- job name
  '* * * * *',                     -- every minute (Supabase minimum)
  $$
    SELECT net.http_post(
      url     := 'https://<PROJECT_REF>.functions.supabase.co/plenario-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <ANON_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
*/

-- ── Helper: store discovered HLS URL for a live session ──────────────────────
-- Call this once after running `python worker/scraper.py` to find the HLS URL.
-- Example:
--   UPDATE sessions
--   SET artv_stream_url = 'https://live.canal.parlamento.pt/hls/plenario.m3u8'
--   WHERE status = 'live' AND date = CURRENT_DATE;

-- ── RPC: update_session_hls_url ───────────────────────────────────────────────
-- Convenience function the Python scraper calls once to register the HLS URL.
CREATE OR REPLACE FUNCTION update_session_hls_url(
  p_session_id uuid,
  p_hls_url    text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.sessions
  SET artv_stream_url = p_hls_url,
      transcript_status = 'processing'
  WHERE id = p_session_id;
$$;

-- ── View: live_session_status ─────────────────────────────────────────────────
-- Quick overview of the current live session for monitoring.
CREATE OR REPLACE VIEW public.live_session_status AS
SELECT
  s.id,
  s.date,
  s.status,
  s.artv_stream_url,
  s.start_time,
  s.total_filler_count,
  s.total_speaking_minutes,
  s.transcript_status,
  COUNT(te.id)                                    AS event_count,
  MAX(te.created_at)                              AS last_event_at,
  ROUND(
    SUM(te.filler_count)::numeric /
    NULLIF(SUM(te.total_words), 0) * 100, 2
  )                                               AS live_filler_pct
FROM public.sessions s
LEFT JOIN public.transcript_events te ON te.session_id = s.id
WHERE s.status = 'live'
GROUP BY s.id;
