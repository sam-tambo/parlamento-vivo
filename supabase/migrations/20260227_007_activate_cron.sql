-- ============================================================
-- Migration 007: Activate pg_cron → always-on serverless capture
-- ============================================================
-- This makes plenario-cron fire every minute entirely within
-- Supabase infrastructure — no browser, no GitHub Actions, no server.
--
-- Flow:
--   pg_cron (every 1 min)
--     → net.http_post → plenario-cron edge function
--         → discover ARTV HLS URL
--         → fetch new segments (cursor-tracked)
--         → POST to transcribe (HF Whisper)
--         → insert transcript_events → Realtime → UI
--
-- Requirements (both enabled by default on Supabase):
--   pg_cron  — https://supabase.com/docs/guides/database/extensions/pg_cron
--   pg_net   — https://supabase.com/docs/guides/database/extensions/pg_net
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if re-running this migration
SELECT cron.unschedule('plenario-transcription-loop')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'plenario-transcription-loop'
  );

-- Schedule: every minute, all day, all week.
-- plenario-cron itself gates on parliament hours and stream availability.
-- verify_jwt = false so no auth header needed.
SELECT cron.schedule(
  'plenario-transcription-loop',
  '* * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://ugyvgtzsvhmcohnooxqp.supabase.co/functions/v1/plenario-cron',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::text
    ) AS request_id;
  $$
);

-- Monitoring view: see last 10 cron runs and whether they succeeded
CREATE OR REPLACE VIEW public.cron_run_log AS
SELECT
  jr.runid,
  jr.jobid,
  j.jobname,
  jr.start_time,
  jr.end_time,
  EXTRACT(EPOCH FROM (jr.end_time - jr.start_time))::int AS duration_s,
  jr.status,
  jr.return_message
FROM cron.job_run_details jr
JOIN cron.job j ON j.jobid = jr.jobid
ORDER BY jr.start_time DESC
LIMIT 50;
