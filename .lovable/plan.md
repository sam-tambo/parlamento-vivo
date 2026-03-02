

## Database and Edge Function Alignment Plan

After comparing the current database state with the migrations from `main`, here is what's missing and needs to be applied.

---

### Current State

**Tables exist:** `politicians`, `sessions`, `speeches`, `filler_words`, `transcript_events`
**Realtime enabled:** `speeches`, `transcript_events` (done)
**Edge functions deployed:** `transcribe`, `plenario-cron`, `hls-proxy`, `scrape-plenario`, `scrape-politicians`

---

### What's Missing from the Database

The following schema objects from migrations 004-011 were never applied:

**1. `sessions` table — missing columns:**
- `last_hls_sequence` (bigint) — HLS cursor for plenario-cron
- `last_hls_segment` (text) — HLS cursor
- `legislatura` (text) — tag sessions by legislature
- `dar_url` (text) — URL to DAR transcript
- `session_number` (integer) — official plenary session number

**2. `politicians` table — missing columns:**
- `total_words` (integer, default 0) — needed for filler-ratio denominator
- `bid` (integer, unique) — parlamento.pt deputy internal ID
- `full_name` (text)
- `constituency` (text)
- `legislature` (text, default 'XVI')

**3. Missing RLS policies:**
- `sessions`: INSERT and UPDATE policies for service role
- `speeches`: INSERT and UPDATE policies for service role
- `speeches.politician_id`: needs to be made nullable

**4. Missing database functions:**
- `refresh_politician_stats(uuid)` — recompute one politician's stats from transcript_events
- `refresh_all_politician_stats()` — backfill all politician stats (callable from browser)
- `trg_update_politician_stats()` — trigger function
- `update_session_hls_url(uuid, text)` — convenience RPC for HLS URL registration

**5. Missing triggers:**
- `trg_transcript_events_stats_insert` on transcript_events
- `trg_transcript_events_stats_update` on transcript_events

**6. Missing views:**
- `live_session_status` — monitoring view for current live session

**7. Missing table:**
- `plenario_import_jobs` — tracks async historic import jobs with progress

**8. Missing indexes:**
- `idx_sessions_legislatura`
- `idx_politicians_bid`

---

### What's Missing from `config.toml`

The `scrape-plenario` and `scrape-politicians` edge functions are not registered in `config.toml`. They need entries with `verify_jwt = false`.

---

### Implementation Plan

**Task 1: Single comprehensive database migration**

One idempotent migration that applies all missing schema from migrations 004, 005, 006, 008, 010, and 011:
- Add all missing columns to `sessions` and `politicians`
- Make `speeches.politician_id` nullable
- Create `plenario_import_jobs` table with RLS
- Create all database functions (`refresh_politician_stats`, `refresh_all_politician_stats`, `update_session_hls_url`)
- Create triggers on `transcript_events`
- Create `live_session_status` view
- Add missing RLS policies (service role INSERT/UPDATE on sessions, speeches)
- Add realtime for `plenario_import_jobs`
- Grant EXECUTE on RPC functions to anon/authenticated
- Run initial stats backfill

Note: pg_cron/pg_net extensions (migration 007) will be skipped as they require Pro tier and may not be available in Lovable Cloud.

**Task 2: Update `config.toml`**

Add entries for `scrape-plenario` and `scrape-politicians` with `verify_jwt = false`.

---

### Technical Details

```text
sessions table changes:
  + last_hls_sequence  bigint
  + last_hls_segment   text
  + legislatura        text
  + dar_url            text
  + session_number     integer

politicians table changes:
  + total_words        integer NOT NULL DEFAULT 0
  + bid                integer UNIQUE
  + full_name          text
  + constituency       text
  + legislature        text DEFAULT 'XVI'

speeches table changes:
  politician_id:  NOT NULL → nullable

New table: plenario_import_jobs
  id, legislatura, status, total_sessions, sessions_processed,
  speeches_inserted, current_session, error_message, started_at,
  completed_at, created_at

New functions:
  refresh_politician_stats(uuid) → void
  refresh_all_politician_stats() → jsonb
  trg_update_politician_stats() → trigger
  update_session_hls_url(uuid, text) → void

New view:
  live_session_status (sessions LEFT JOIN transcript_events)
```

