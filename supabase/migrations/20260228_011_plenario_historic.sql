-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Historic plenário data support
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds schema support for importing historic session/speech data from the
-- Portuguese parliament (dados.parlamento.pt / parlamento.pt) into the DB.
--
-- Objects created:
--   1. sessions.legislatura     — tag sessions by legislature (e.g. "XVII")
--   2. sessions.dar_url         — URL of the DAR transcript for the session
--   3. sessions.session_number  — official plenary session number
--   4. plenario_import_jobs     — tracks async import jobs (progress UI)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. sessions — new columns ─────────────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS legislatura     text,
  ADD COLUMN IF NOT EXISTS dar_url         text,
  ADD COLUMN IF NOT EXISTS session_number  integer;

CREATE INDEX IF NOT EXISTS idx_sessions_legislatura
  ON public.sessions (legislatura);

-- ── 2. plenario_import_jobs — async import tracking ──────────────────────────

CREATE TABLE IF NOT EXISTS public.plenario_import_jobs (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legislatura         text        NOT NULL DEFAULT 'XVII',
  status              text        NOT NULL DEFAULT 'pending',
  total_sessions      integer     NOT NULL DEFAULT 0,
  sessions_processed  integer     NOT NULL DEFAULT 0,
  speeches_inserted   integer     NOT NULL DEFAULT 0,
  current_session     text,
  error_message       text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plenario_import_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'plenario_import_jobs'
      AND policyname = 'Import jobs are publicly readable'
  ) THEN
    CREATE POLICY "Import jobs are publicly readable"
      ON public.plenario_import_jobs FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'plenario_import_jobs'
      AND policyname = 'Service role can manage import jobs'
  ) THEN
    CREATE POLICY "Service role can manage import jobs"
      ON public.plenario_import_jobs FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- Enable Realtime so the frontend gets live progress updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'plenario_import_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.plenario_import_jobs;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
