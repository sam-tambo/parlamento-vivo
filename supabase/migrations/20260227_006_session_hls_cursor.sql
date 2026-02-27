-- Track which HLS segments have already been transcribed per session.
-- Without this, plenario-cron re-fetches the same "last 5 segments"
-- on every invocation, producing duplicated or overlapping transcripts.
--
-- last_hls_sequence  : EXT-X-MEDIA-SEQUENCE value of the last processed segment
-- last_hls_segment   : URL of the last processed .ts segment (secondary key)
-- artv_video_url     : archive VOD URL once the session ends (was missing from schema)

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS last_hls_sequence   bigint,
  ADD COLUMN IF NOT EXISTS last_hls_segment    text,
  ADD COLUMN IF NOT EXISTS artv_video_url      text,
  ADD COLUMN IF NOT EXISTS total_speaking_minutes real DEFAULT 0;

-- Service role can update sessions (needed by edge functions)
CREATE POLICY IF NOT EXISTS "Service role can update sessions"
  ON public.sessions FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can insert sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (true);
