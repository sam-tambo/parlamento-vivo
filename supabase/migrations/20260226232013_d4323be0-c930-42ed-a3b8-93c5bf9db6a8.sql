
-- Drop detections table
DROP TABLE IF EXISTS public.detections;

-- Add columns to politicians
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS total_speaking_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_filler_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_speeches integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_filler_ratio real NOT NULL DEFAULT 0;

-- Add columns to sessions
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS total_speaking_minutes real,
  ADD COLUMN IF NOT EXISTS total_filler_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artv_video_url text,
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'pending';

-- Create speeches table
CREATE TABLE public.speeches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  politician_id uuid NOT NULL REFERENCES public.politicians(id) ON DELETE CASCADE,
  speaking_duration_seconds integer NOT NULL DEFAULT 0,
  filler_word_count integer NOT NULL DEFAULT 0,
  total_word_count integer NOT NULL DEFAULT 0,
  filler_ratio real NOT NULL DEFAULT 0,
  transcript_excerpt text,
  filler_words_detail jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.speeches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Speeches are publicly readable"
  ON public.speeches FOR SELECT USING (true);

-- Create filler_words reference table
CREATE TABLE public.filler_words (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  word text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'filler'
);

ALTER TABLE public.filler_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Filler words are publicly readable"
  ON public.filler_words FOR SELECT USING (true);

-- Seed filler words
INSERT INTO public.filler_words (word, category) VALUES
  ('portanto', 'connector'),
  ('digamos', 'hesitation'),
  ('ou seja', 'connector'),
  ('pronto', 'filler'),
  ('basicamente', 'filler'),
  ('efetivamente', 'filler'),
  ('de facto', 'connector'),
  ('na verdade', 'connector'),
  ('quer dizer', 'hesitation'),
  ('tipo', 'filler'),
  ('ok', 'filler'),
  ('bem', 'hesitation'),
  ('olhe', 'filler'),
  ('enfim', 'filler');

-- Index for performance
CREATE INDEX idx_speeches_session_id ON public.speeches(session_id);
CREATE INDEX idx_speeches_politician_id ON public.speeches(politician_id);
CREATE INDEX idx_speeches_filler_ratio ON public.speeches(filler_ratio DESC);
