-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008: Automatic politician stats from transcript_events
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: politicians.total_filler_count / total_speaking_seconds / etc. were
-- only updated from the `speeches` table, not from the live `transcript_events`
-- that plenario-cron inserts. Any time a real capture runs, stats stayed at 0.
--
-- Solution:
--   1. Add total_words column to politicians (needed for filler_ratio calc).
--   2. refresh_politician_stats(UUID)  — recompute one politician from events.
--   3. DB trigger — calls (2) automatically after every transcript_event INSERT
--      or UPDATE, so stats are always current with zero frontend code.
--   4. refresh_all_politician_stats() — full backfill RPC, callable from the
--      browser so that viewing the recordings page also catches up any gaps.
--   5. Initial backfill — run immediately so existing data is reflected now.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add total_words to politicians (stores aggregate word count for ratio math)
ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS total_words INTEGER NOT NULL DEFAULT 0;

-- ─── 2. Per-politician refresh function ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_politician_stats(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fillers BIGINT;
  v_words   BIGINT;
  v_secs    REAL;
  v_events  BIGINT;
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
    total_speaking_seconds = v_secs::INTEGER,
    -- count segments as proxy for "speeches" when no separate speech record
    total_speeches         = GREATEST(total_speeches, v_events),
    average_filler_ratio   = CASE
                               WHEN v_words > 0 THEN v_fillers::REAL / v_words
                               ELSE 0
                             END
  WHERE id = p_id;
END;
$$;

-- ─── 3. Trigger function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_update_politician_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh the new (or updated) politician
  IF NEW.politician_id IS NOT NULL THEN
    PERFORM public.refresh_politician_stats(NEW.politician_id);
  END IF;

  -- On UPDATE: if politician_id changed, also refresh the old one
  IF TG_OP = 'UPDATE'
     AND OLD.politician_id IS NOT NULL
     AND OLD.politician_id IS DISTINCT FROM NEW.politician_id
  THEN
    PERFORM public.refresh_politician_stats(OLD.politician_id);
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 4. Triggers on transcript_events ────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_transcript_events_stats_insert ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_insert
  AFTER INSERT ON public.transcript_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_politician_stats();

DROP TRIGGER IF EXISTS trg_transcript_events_stats_update ON public.transcript_events;
CREATE TRIGGER trg_transcript_events_stats_update
  AFTER UPDATE OF politician_id, filler_count, total_words, duration_seconds
  ON public.transcript_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_update_politician_stats();

-- ─── 5. Full-backfill RPC (called from browser on recordings page load) ──────

CREATE OR REPLACE FUNCTION public.refresh_all_politician_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid     UUID;
  v_count   INTEGER := 0;
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
    'refreshed_at',          NOW()
  );
END;
$$;

-- Grant to anon + authenticated so the React app can call it without service key
GRANT EXECUTE ON FUNCTION public.refresh_all_politician_stats()     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_politician_stats(UUID)     TO anon, authenticated;

-- ─── 6. Initial backfill from existing transcript_events ─────────────────────

DO $$
DECLARE
  result JSONB;
BEGIN
  SELECT public.refresh_all_politician_stats() INTO result;
  RAISE NOTICE 'politician stats backfill: %', result;
END;
$$;
