

# Pivot: Parliament Speech Analytics Platform

## New Concept

The project shifts from "catching politicians on phones" to a **speech analytics platform** that monitors plenary sessions from ARTV (`canal.parlamento.pt/plenario`) and analyzes:

- **Who speaks and how much** (speaking time per deputy)
- **Filler word density** per deputy and per session (e.g., "portanto", "digamos", "ou seja", "pronto", "basicamente", "efetivamente")
- **Silent deputies** who rarely or never speak
- **Most active deputies** ranked by total speaking time
- **Party-level aggregates** comparing filler word ratios and speaking activity
- **Overall parliament filler word saturation**

---

## Data Source: ARTV Plenario

The ARTV site at `canal.parlamento.pt/plenario` provides dated recordings of plenary sessions (Legislatura XVII). The external Python worker will:
1. Download/stream audio from plenary recordings
2. Use speech-to-text (e.g., Whisper) to transcribe
3. Use speaker diarization to identify who is speaking
4. Match speakers to the politicians database (via name/voice profile)
5. Analyze transcripts for filler words
6. Submit results to the platform via API

---

## Database Changes

**Keep existing tables** (`politicians`, `sessions`) with modifications. Replace `detections` with new speech-focused tables.

### Modified: `sessions` table
Add columns:
- `total_speaking_minutes` (real) -- total speech time in the session
- `total_filler_count` (integer) -- total filler words detected
- `artv_video_url` (text) -- direct link to the ARTV recording
- `transcript_status` (text, default 'pending') -- pending/processing/completed/failed

### New: `speeches` table (replaces `detections`)
Each row represents one deputy's contribution in a session:
- `id` (uuid, PK)
- `session_id` (uuid, FK -> sessions)
- `politician_id` (uuid, FK -> politicians)
- `speaking_duration_seconds` (integer) -- how long they spoke
- `filler_word_count` (integer) -- total fillers in their speech
- `total_word_count` (integer) -- total words spoken
- `filler_ratio` (real) -- filler_word_count / total_word_count
- `transcript_excerpt` (text) -- sample of their speech
- `filler_words_detail` (jsonb) -- breakdown e.g. {"portanto": 12, "digamos": 5}
- `created_at` (timestamptz)

### New: `filler_words` table (reference)
- `id` (uuid, PK)
- `word` (text, unique) -- e.g., "portanto", "digamos", "ou seja"
- `category` (text) -- e.g., "hesitation", "connector", "filler"

### Drop: `detections` table
No longer needed -- replaced by `speeches`.

### Modified: `politicians` table
Add columns:
- `total_speaking_seconds` (integer, default 0)
- `total_filler_count` (integer, default 0)
- `total_speeches` (integer, default 0)
- `average_filler_ratio` (real, default 0)

---

## Updated Pages

### 1. Landing Page (`Index.tsx`)
- New branding: **"Palavras do Parlamento"** or similar
- Hero: "Quão vazio e o discurso parlamentar?"
- Live counters: total sessions analyzed, total filler words detected, avg filler ratio
- Latest session summaries instead of "detection cards"
- "How it works" updated: Monitor ARTV -> Transcribe -> Analyze fillers -> Rank deputies

### 2. Speeches Feed (replaces Detections)
- `/speeches` route (rename from `/detections`)
- Grid/list of speech contributions per session
- Each card: deputy name, party, duration, filler count, filler ratio bar
- Filter by politician, party, date, session
- Click to see transcript excerpt with filler words highlighted

### 3. Deputies Page (`Politicians.tsx`)
- Podium becomes: "Most active speakers" or "Highest filler ratio"
- Toggle between rankings: most active, most silent, highest filler ratio, lowest filler ratio
- Each card shows: speaking time, filler ratio, number of speeches
- New section: "Silent deputies" -- those with 0 or minimal speeches

### 4. Stats Dashboard (`Stats.tsx`)
- Filler words over time (trend line)
- Filler ratio by party (bar chart)
- Most used filler words (horizontal bar chart)
- Speaking time distribution by party
- Most active vs. most silent deputies
- Parliament-wide filler saturation metric

### 5. Session Detail Page (new: `/sessions/:id`)
- Full breakdown of a single plenary session
- Timeline of speakers
- Filler word density per speaker in that session
- Link to ARTV recording

---

## Updated Components

- **`DetectionCard` -> `SpeechCard`**: Shows deputy, duration, filler count/ratio, transcript excerpt
- **`Navbar`**: Update labels and icons (Mic instead of Smartphone, "Discursos" instead of "Deteções")
- **Mock data**: Replace with speech-oriented mock data

---

## Backend Functions

### `scrape-politicians` (Firecrawl)
Unchanged -- still scrapes parlamento.pt for deputy data.

### `receive-speech-data` (replaces `receive-detection`)
API endpoint for the Python worker to submit speech analysis results:
- Accepts: session info, array of speech contributions per politician
- Validates auth token
- Upserts session, creates speech records, updates politician aggregates

### `post-to-twitter` (updated)
Posts session summaries or notable stats (e.g., "Deputy X used 47 filler words in 3 minutes") instead of phone clips.

---

## Implementation Order

1. **Database migration**: Drop `detections`, create `speeches` and `filler_words` tables, add columns to `politicians` and `sessions`
2. **Mock data**: Replace with speech analytics mock data
3. **Components**: Rename `DetectionCard` to `SpeechCard`, update Navbar branding
4. **Pages**: Rewrite all 4 pages with new speech analytics focus
5. **New page**: Session detail page at `/sessions/:id`
6. **Edge function**: Build `receive-speech-data` endpoint
7. **Edge function**: Build `scrape-politicians` with Firecrawl

---

## Technical Notes

- The `filler_words_detail` column uses JSONB to store per-word breakdowns without needing a join table for every filler occurrence
- Portuguese filler words to track: "portanto", "digamos", "ou seja", "pronto", "basicamente", "efetivamente", "de facto", "na verdade", "quer dizer", "tipo", "ok", "bem", "olhe", "enfim"
- The `filler_ratio` is pre-computed on insert for fast querying and ranking
- Politician aggregate columns (`total_speaking_seconds`, etc.) are updated via the `receive-speech-data` edge function to avoid expensive aggregation queries on every page load
- ARTV recordings are linked but not stored -- the platform references the ARTV URLs

