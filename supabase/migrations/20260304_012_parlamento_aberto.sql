-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012: Parlamento Aberto — full transparency schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds structured session data from DAR (Diário da Assembleia da República):
-- legislaturas, agenda_items, interventions, votes, vote_declarations,
-- party_positions, and AI-generated analysis fields on sessions.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. legislaturas ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.legislaturas (
  id           text        PRIMARY KEY,          -- e.g. "XVII"
  description  text,
  start_date   date,
  end_date     date
);

ALTER TABLE public.legislaturas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='legislaturas' AND policyname='Legislaturas are publicly readable'
  ) THEN
    CREATE POLICY "Legislaturas are publicly readable"
      ON public.legislaturas FOR SELECT USING (true);
  END IF;
END $$;

-- Seed known legislaturas
INSERT INTO public.legislaturas (id, description, start_date, end_date) VALUES
  ('XVII', 'XVII Legislatura', '2024-03-23', NULL),
  ('XVI',  'XVI Legislatura',  '2022-03-30', '2024-03-22'),
  ('XV',   'XV Legislatura',   '2019-10-25', '2022-03-29'),
  ('XIV',  'XIV Legislatura',  '2015-10-23', '2019-10-24')
ON CONFLICT (id) DO NOTHING;

-- ── 2. sessoes_legislativas ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sessoes_legislativas (
  id              text    PRIMARY KEY,   -- e.g. "XVII-1"
  legislatura_id  text    REFERENCES public.legislaturas(id),
  number          integer,
  start_date      date,
  end_date        date
);

ALTER TABLE public.sessoes_legislativas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='sessoes_legislativas' AND policyname='Sessoes legislativas are publicly readable'
  ) THEN
    CREATE POLICY "Sessoes legislativas are publicly readable"
      ON public.sessoes_legislativas FOR SELECT USING (true);
  END IF;
END $$;

-- ── 3. sessions — AI analysis columns ─────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS summary_pt        text,
  ADD COLUMN IF NOT EXISTS summary_en        text,
  ADD COLUMN IF NOT EXISTS key_decisions     jsonb,
  ADD COLUMN IF NOT EXISTS notable_moments   jsonb,
  ADD COLUMN IF NOT EXISTS analysis_status   text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS full_text         text,
  ADD COLUMN IF NOT EXISTS deputies_present  integer,
  ADD COLUMN IF NOT EXISTS president_name    text;

-- Full-text search index on sessions (Portuguese)
CREATE INDEX IF NOT EXISTS idx_sessions_fts
  ON public.sessions
  USING gin(to_tsvector('portuguese',
    coalesce(full_text, '') || ' ' || coalesce(summary_pt, '')
  ));

-- ── 4. agenda_items ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agenda_items (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      uuid        REFERENCES public.sessions(id) ON DELETE CASCADE,
  item_number     integer,
  title           text        NOT NULL,
  topic_category  text,
  initiatives     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agenda_items_session
  ON public.agenda_items (session_id);

ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='agenda_items' AND policyname='Agenda items are publicly readable'
  ) THEN
    CREATE POLICY "Agenda items are publicly readable"
      ON public.agenda_items FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='agenda_items' AND policyname='Service role can manage agenda items'
  ) THEN
    CREATE POLICY "Service role can manage agenda items"
      ON public.agenda_items FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- ── 5. interventions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.interventions (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id                uuid        REFERENCES public.sessions(id) ON DELETE CASCADE,
  deputy_id                 uuid        REFERENCES public.politicians(id) ON DELETE SET NULL,
  agenda_item_id            uuid        REFERENCES public.agenda_items(id) ON DELETE SET NULL,
  deputy_name               text,       -- denormalized for unmatched speakers
  party                     text,
  type                      text        DEFAULT 'intervenção',
  -- intervenção | pedido_esclarecimento | resposta | aparte | encerramento
  sequence_number           integer,
  text                      text        NOT NULL,
  word_count                integer,
  estimated_duration_seconds integer,
  applause_from             text[],
  protests_from             text[],
  interrupted_by            text[],
  was_mic_cutoff            boolean     DEFAULT false,
  key_claims                jsonb,
  sentiment_score           float,
  topic_tags                text[],
  filler_word_count         integer     DEFAULT 0,
  filler_words_detail       jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interventions_session
  ON public.interventions (session_id);

CREATE INDEX IF NOT EXISTS idx_interventions_deputy
  ON public.interventions (deputy_id);

-- Full-text search on intervention text (Portuguese)
CREATE INDEX IF NOT EXISTS idx_interventions_fts
  ON public.interventions
  USING gin(to_tsvector('portuguese', text));

ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='interventions' AND policyname='Interventions are publicly readable'
  ) THEN
    CREATE POLICY "Interventions are publicly readable"
      ON public.interventions FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='interventions' AND policyname='Service role can manage interventions'
  ) THEN
    CREATE POLICY "Service role can manage interventions"
      ON public.interventions FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- ── 6. votes ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.votes (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id           uuid        REFERENCES public.sessions(id) ON DELETE CASCADE,
  agenda_item_id       uuid        REFERENCES public.agenda_items(id) ON DELETE SET NULL,
  initiative_reference text,
  description          text,
  result               text,        -- aprovado | rejeitado | retirado
  favor                text[],      -- parties in favour
  against              text[],      -- parties against
  abstain              text[],      -- parties abstaining
  dissidents           jsonb,       -- [{name, party, vote}]
  sequence_number      integer,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_votes_session
  ON public.votes (session_id);

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='votes' AND policyname='Votes are publicly readable'
  ) THEN
    CREATE POLICY "Votes are publicly readable"
      ON public.votes FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='votes' AND policyname='Service role can manage votes'
  ) THEN
    CREATE POLICY "Service role can manage votes"
      ON public.votes FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- ── 7. vote_declarations ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vote_declarations (
  id        uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vote_id   uuid    REFERENCES public.votes(id) ON DELETE CASCADE,
  deputy_id uuid    REFERENCES public.politicians(id) ON DELETE SET NULL,
  party     text,
  text      text,
  summary   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vote_declarations_vote
  ON public.vote_declarations (vote_id);

ALTER TABLE public.vote_declarations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='vote_declarations' AND policyname='Vote declarations are publicly readable'
  ) THEN
    CREATE POLICY "Vote declarations are publicly readable"
      ON public.vote_declarations FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='vote_declarations' AND policyname='Service role can manage vote declarations'
  ) THEN
    CREATE POLICY "Service role can manage vote declarations"
      ON public.vote_declarations FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- ── 8. party_positions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.party_positions (
  id               uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  topic            text    NOT NULL,
  party            text    NOT NULL,
  session_id       uuid    REFERENCES public.sessions(id) ON DELETE CASCADE,
  position_summary text,
  vote_alignment   text,   -- favor | against | abstain | mixed | not_present
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_party_positions_topic
  ON public.party_positions (topic);

CREATE INDEX IF NOT EXISTS idx_party_positions_party
  ON public.party_positions (party);

ALTER TABLE public.party_positions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='party_positions' AND policyname='Party positions are publicly readable'
  ) THEN
    CREATE POLICY "Party positions are publicly readable"
      ON public.party_positions FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='party_positions' AND policyname='Service role can manage party positions'
  ) THEN
    CREATE POLICY "Service role can manage party positions"
      ON public.party_positions FOR ALL WITH CHECK (true);
  END IF;
END $$;

-- ── 9. deputy_activity materialized view ─────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS public.deputy_activity AS
  SELECT
    p.id,
    p.name,
    p.party,
    p.constituency,
    COUNT(DISTINCT i.session_id)                                  AS sessions_active,
    COUNT(i.id)                                                   AS total_interventions,
    COALESCE(SUM(i.word_count), 0)                               AS total_words,
    COALESCE(SUM(CASE WHEN i.was_mic_cutoff THEN 1 ELSE 0 END), 0) AS mic_cutoffs,
    COALESCE(SUM(i.filler_word_count), 0)                        AS total_filler_words
  FROM public.politicians p
  LEFT JOIN public.interventions i ON i.deputy_id = p.id
  GROUP BY p.id, p.name, p.party, p.constituency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deputy_activity_id
  ON public.deputy_activity (id);

-- ── 10. Enable Realtime on new tables ─────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'interventions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.interventions;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'votes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
