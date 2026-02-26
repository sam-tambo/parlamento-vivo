
-- Create politicians table
CREATE TABLE public.politicians (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  party TEXT NOT NULL,
  photo_url TEXT,
  parlamento_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sessions table
CREATE TABLE public.sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  artv_stream_url TEXT,
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create detections table
CREATE TABLE public.detections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  politician_id UUID NOT NULL REFERENCES public.politicians(id) ON DELETE CASCADE,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  confidence_score REAL,
  video_clip_url TEXT,
  screenshot_url TEXT,
  tweeted BOOLEAN NOT NULL DEFAULT false,
  tweet_url TEXT,
  session_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.politicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detections ENABLE ROW LEVEL SECURITY;

-- Politicians are publicly readable
CREATE POLICY "Politicians are publicly readable"
  ON public.politicians FOR SELECT
  USING (true);

-- Sessions are publicly readable
CREATE POLICY "Sessions are publicly readable"
  ON public.sessions FOR SELECT
  USING (true);

-- Detections are publicly readable
CREATE POLICY "Detections are publicly readable"
  ON public.detections FOR SELECT
  USING (true);

-- Create indexes
CREATE INDEX idx_detections_politician ON public.detections(politician_id);
CREATE INDEX idx_detections_session_date ON public.detections(session_date);
CREATE INDEX idx_detections_detected_at ON public.detections(detected_at DESC);
CREATE INDEX idx_politicians_party ON public.politicians(party);
