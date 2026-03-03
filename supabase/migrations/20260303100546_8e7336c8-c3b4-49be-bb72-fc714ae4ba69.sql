CREATE TABLE public.hf_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL DEFAULT 'transcribe',
  model_used text,
  audio_bytes integer NOT NULL DEFAULT 0,
  duration_seconds real,
  tokens_estimated integer,
  cost_estimated real,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hf_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HF usage log is publicly readable"
  ON public.hf_usage_log FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert hf usage log"
  ON public.hf_usage_log FOR INSERT
  WITH CHECK (true);