-- Add bid (Parliament internal deputy ID) column to politicians
-- Used to construct photo URLs and link back to parlamento.pt deputy pages
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS bid integer UNIQUE;          -- parlamento.pt depId
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS full_name text;              -- nome completo (vs display name)
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS constituency text;           -- círculo eleitoral
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS legislature text DEFAULT 'XVI'; -- legislatura

-- Upsert target for scraper: unique on (bid) when set, else (name, party)
CREATE UNIQUE INDEX IF NOT EXISTS idx_politicians_bid
  ON public.politicians(bid) WHERE bid IS NOT NULL;

-- Storage bucket for politician photos (public read, service-role write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('politician-photos', 'politician-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Politician photos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'politician-photos');

CREATE POLICY IF NOT EXISTS "Service role can upload politician photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'politician-photos');
