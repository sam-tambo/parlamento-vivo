# Parlamento Vivo

**Parlamento Vivo** monitors the Portuguese Parliament in real time, detecting and scoring the _palavras de enchimento_ (filler words) used by MPs during plenary and committee sessions — live, automatically, no human in the loop.

---

## What it does

| Feature | How |
|---|---|
| Watches the live ARTV/Canal Parlamento stream | hls.js via browser **or** serverless pg_cron — no browser required |
| Transcribes every 30 seconds of speech | OpenAI Whisper (large-v3) via HuggingFace Inference API |
| Detects Portuguese filler words | Custom catalog of 30+ words across 4 categories |
| Identifies the speaking MP | pyannote.audio voice diarization + voice embeddings |
| Shows results in real time | Supabase Realtime → React feed |
| Profiles all 230 XVI Legislature deputies | Scraped from parlamento.pt OData API, photos in Supabase Storage |
| Scores and ranks MPs by filler rate | Historical stats, per-session leaderboard, trend charts |

---

## Architecture

```
canal.parlamento.pt (ARTV live stream — LiveExtend CDN)
        │
        ▼
┌───────────────────────────────────────────┐
│  Browser path (user has tab open)         │
│  hls.js → <video> → captureStream()       │
│  AudioContext 16kHz → WAV → /transcribe   │
└───────────────┬───────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────┐
│  Server path (always-on, no browser)      │
│  pg_cron (every 1 min)                    │
│    → plenario-cron edge fn               │
│      · 5-stage HLS URL discovery         │
│      · EXT-X-MEDIA-SEQUENCE cursor       │
│      · /transcribe in 30s batches        │
└───────────────┬───────────────────────────┘
                │
                ▼
        /transcribe edge fn
        HuggingFace Whisper large-v3
        → filler detection → INSERT transcript_events
                │
                ▼
        Supabase Realtime → React UI
```

### Edge Functions

| Function | Purpose |
|---|---|
| `transcribe` | Downloads HLS segments, sends audio to Whisper, detects fillers, inserts `transcript_events` |
| `plenario-cron` | Called every minute by pg_cron; discovers ARTV HLS URL (5-stage), fetches only new segments, batches to `transcribe` |
| `hls-proxy` | CORS proxy for the LiveExtend CDN; rewrites playlist URLs so hls.js can play cross-origin in the browser |

### HLS URL discovery (5 stages, first hit wins)

1. **Cached** — `sessions.artv_stream_url` from previous run
2. **JSON API** — probes `canal.parlamento.pt/api/lives`, `/api/player/live`, etc.
3. **`__NEXT_DATA__`** — parses embedded Next.js JSON from page HTML
4. **HTML/JS scan** — regex across page source + player bundle scripts
5. **CDN candidates** — parallel probe of 14 known URLs (LiveExtend primary, parliament fallback, RTP CDN)

### Speaker identification pipeline

```
DAR-I XML transcripts (Diário da Assembleia da República)
  → parse named speaker intervals
  → download ARTV session video
  → pyannote.audio diarization
  → Whisper transcribes each diarized turn
  → fuzzy text match to DAR (≥40% similarity)
  → extract voice embedding → save to voice_profiles.json
```

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — today's session stats, top fillers, live status |
| `/ao-vivo` | Live stream player + real-time transcript feed + speaker card |
| `/politicos` | All 230 deputies with photo, party, filler rate |
| `/palavras` | Filler word catalog with categories and severity |
| `/comparar` | Side-by-side MP comparison |
| `/estatisticas` | Historical charts and trends |
| `/discursos` | Searchable speech archive |

---

## Filler word categories

| Category | Examples | Severity |
|---|---|---|
| **Hesitation** | _digamos_, _quer dizer_, _bem_, _ora_ | low–medium |
| **Connector** | _portanto_, _ou seja_, _na verdade_, _de facto_ | medium–high |
| **Filler** | _pronto_, _basicamente_, _tipo_, _efetivamente_ | medium–high |
| **Staller** | _de certa forma_, _no fundo_, _de alguma forma_ | medium–high |

---

## Tech stack

**Frontend**
- React 18 + TypeScript + Vite
- shadcn/ui + Tailwind CSS + Framer Motion
- hls.js (HLS playback + captureStream audio tap)
- Supabase JS client (queries + Realtime)

**Backend**
- Supabase (Postgres + Row Level Security + Realtime + Storage)
- Deno edge functions (Transcribe / plenario-cron / hls-proxy)
- pg_cron — schedules `plenario-cron` every minute, entirely serverless
- pg_net — HTTP from inside Postgres to call edge functions

**AI / ML**
- OpenAI Whisper large-v3 via HuggingFace Inference API
- pyannote.audio 3.x — speaker diarization + voice embeddings

**Worker scripts (Python)**
- `scrape_deputados.py` — fetches all 230 XVI Legislature deputies from parlamento.pt OData API, downloads photos, upserts to Supabase
- `dar_profiles.py` — auto-builds voice profiles from DAR-I XML + ARTV video (no manual labelling)
- `diarization.py` — real-time speaker identification during live sessions
- `live_trigger.py` — CLI tool to manually trigger a capture cycle

---

## Required secrets

Set these in **Supabase → Project Settings → Edge Function Secrets**:

| Secret | Value |
|---|---|
| `HF_TOKEN` | HuggingFace API token with Inference API access |

Set these in **GitHub → Settings → Secrets → Actions** (for the optional GitHub Actions trigger):

| Secret | Value |
|---|---|
| `LOVABLE_SERVICE_KEY` | Supabase service role key |
| `SUPABASE_URL` | `https://ugyvgtzsvhmcohnooxqp.supabase.co` |

---

## Database migrations

| File | What it does |
|---|---|
| `20260226_003_transcript_events.sql` | `transcript_events`, `sessions`, `politicians` tables + RLS |
| `20260227_004_cron_and_hls.sql` | Initial cron + HLS helpers |
| `20260227_005_deputy_bid.sql` | Adds `bid`, `full_name`, `constituency`, `legislature` to politicians; creates `politician-photos` storage bucket |
| `20260227_006_session_hls_cursor.sql` | Adds `last_hls_sequence`, `artv_stream_url`, `total_speaking_minutes` to sessions |
| `20260227_007_activate_cron.sql` | Activates pg_cron + pg_net; schedules `plenario-transcription-loop` every minute |

Run migrations in the Supabase SQL editor in order. Migration 007 is what makes the system fully autonomous.

---

## Local development

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev

# (Optional) Run the deputy scraper
cd worker
pip install -r requirements.txt
python scrape_deputados.py          # fetch + photos + upsert all 230 deputies
python scrape_deputados.py --list   # verify what's in the DB

# (Optional) Build voice profiles from DAR transcripts
python dar_profiles.py auto --sessions 5   # process 5 recent sessions
python dar_profiles.py status              # coverage report

# (Optional) Trigger a manual capture cycle
python live_trigger.py
```

---

## How the live capture works (no microphone, no browser tab required)

1. **pg_cron** fires every minute inside Supabase (migration 007)
2. **plenario-cron** edge function wakes up, finds the ARTV HLS stream URL using 5-stage discovery
3. It compares the current `EXT-X-MEDIA-SEQUENCE` against the cursor stored in `sessions.last_hls_sequence` — only **new** `.ts` segments since the last run are processed (no duplicates)
4. New segments are sent to **`/transcribe`** in ~30-second batches
5. Whisper transcribes → filler detection runs → results inserted into `transcript_events`
6. **Supabase Realtime** pushes changes to any open browser tabs instantly

When a user also has the `/ao-vivo` page open, the browser simultaneously taps the stream via `captureStream()` on the hls.js `<video>` element, giving a parallel real-time feed.

---

## ARTV stream

The live stream is served by **LiveExtend** (`livextend.cloud`), not by the parliament's own servers. Primary URLs:

```
https://playout172.livextend.cloud/liveiframe/_definst_/liveartvabr/playlist.m3u8
https://playout175.livextend.cloud/livenlin4/_definst_/2liveartvpub2/playlist.m3u8
```

The `hls-proxy` edge function proxies all CDN requests and adds the `Referer: https://canal.parlamento.pt/` header required by the CDN.

---

## Roadmap

- [ ] Per-deputy voice profile coverage (target: all 230)
- [ ] Real-time speaker name shown on transcript cards
- [ ] Constituency map coloured by average filler rate
- [ ] Weekly email digest for press / civic orgs
- [ ] Public API for researchers
