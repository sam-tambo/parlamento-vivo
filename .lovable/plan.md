

## Fix Build Errors in Edge Functions

The errors are all caused by `createClient()` being called without generic type parameters, so the Supabase JS client infers table types as `never`. The fix is to use `createClient<any>(...)` in both edge functions so all `.from()` queries return `any` instead of `never`.

### Changes

**1. `supabase/functions/transcribe/index.ts`**
- Line 34: Change `import { createClient } from "jsr:@supabase/supabase-js@2";` — no change needed here
- Line 246: Change `type SupabaseClient = ReturnType<typeof createClient>;` to use the `any` generic
- Line 357-359: Change `createClient(...)` to `createClient<any>(...)`

**2. `supabase/functions/scrape-plenario/index.ts`**  
- Line 70: Change `type SupabaseClient = ReturnType<typeof createClient>;` to `type SupabaseClient = ReturnType<typeof createClient<any>>;`
- All `createClient(...)` calls: Change to `createClient<any>(...)`

This is a 2-file, ~4-line change that resolves all 19 build errors by telling the Supabase client to use `any` for database types (edge functions don't have access to the generated types file).

### Dashboard Feature

After fixing the build errors, create an HF usage monitoring dashboard:

**3. New database table: `hf_usage_log`**
- `id`, `function_name`, `model_used`, `audio_bytes`, `duration_seconds`, `tokens_estimated`, `cost_estimated`, `created_at`
- Populated by the `transcribe` edge function after each successful HF call

**4. Update `supabase/functions/transcribe/index.ts`**
- After successful transcription, insert a row into `hf_usage_log` with audio size, model used, elapsed time, and estimated cost
- Cost estimation: HF Inference API Pro charges ~$0.06/hr of audio; ~30s chunks ≈ $0.0008/call

**5. New page: `src/pages/HFDashboard.tsx`**
- Query `hf_usage_log` for usage stats
- Show: total calls today/week/month, total audio processed, estimated cost breakdown
- Charts using recharts: calls over time, cumulative cost, audio volume
- Add route `/hf-dashboard` in App.tsx

