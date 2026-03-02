-- Enable realtime for transcript_events and speeches (idempotent - will error silently if already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'transcript_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_events;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'speeches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.speeches;
  END IF;
END $$;