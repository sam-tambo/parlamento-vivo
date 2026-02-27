-- transcript_events: real-time live feed from AI worker
-- Each row is one ~30s chunk of transcribed audio from the Plenário stream

CREATE TABLE IF NOT EXISTS public.transcript_events (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id        uuid        REFERENCES public.sessions(id) ON DELETE CASCADE,
  politician_id     uuid        REFERENCES public.politicians(id) ON DELETE SET NULL,
  text_segment      text        NOT NULL,
  filler_count      integer     NOT NULL DEFAULT 0,
  total_words       integer     NOT NULL DEFAULT 0,
  filler_words_found jsonb      DEFAULT '[]'::jsonb,
  start_seconds     real,
  duration_seconds  real,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transcript_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Transcript events are publicly readable"
  ON public.transcript_events FOR SELECT USING (true);

CREATE POLICY "Service role can insert transcript events"
  ON public.transcript_events FOR INSERT WITH CHECK (true);

CREATE INDEX idx_transcript_events_session   ON public.transcript_events(session_id);
CREATE INDEX idx_transcript_events_politician ON public.transcript_events(politician_id);
CREATE INDEX idx_transcript_events_created   ON public.transcript_events(created_at DESC);

-- Enable Supabase Realtime for live feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.speeches;

-- Seed 10 real Portuguese politicians from AR XV Legislatura
INSERT INTO public.politicians (name, party, parlamento_url) VALUES
  ('Pedro Nuno Santos',       'PS',  'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=5'),
  ('Luís Montenegro',         'PSD', 'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=3'),
  ('André Ventura',           'CH',  'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=4'),
  ('Rui Rocha',               'IL',  'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=6'),
  ('Mariana Mortágua',        'BE',  'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=7'),
  ('Paulo Raimundo',          'PCP', 'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=8'),
  ('Rui Tavares',             'L',   'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=9'),
  ('Inês de Sousa Real',      'PAN', 'https://www.parlamento.pt/DeputadoGP/Paginas/Deputado.aspx?BID=10'),
  ('Fernando Anastácio',      'PS',  NULL),
  ('Hugo Soares',             'PSD', NULL),
  ('Rita Matias',             'CH',  NULL),
  ('Bernardo Blanco',         'IL',  NULL),
  ('Pedro Filipe Soares',     'BE',  NULL),
  ('Alma Rivera',             'PCP', NULL),
  ('Isabel Mendes Lopes',     'L',   NULL)
ON CONFLICT DO NOTHING;
