

## Plan: Add politician photo thumbnails

The `politicians` table already has a `photo_url` column, and `AvatarImage` is available from the avatar component. Currently, all avatars show only initials via `AvatarFallback`. The database is empty, but photos will come from the parlamento.pt scraper.

### Changes

1. **`src/pages/Politicians.tsx`** — Import `AvatarImage` and add it inside every `Avatar` (podium top-3 + deputy grid). `AvatarFallback` remains as fallback when no photo exists.

2. **`src/components/SpeechCard.tsx`** — Same: add `AvatarImage` using `politician.photo_url`.

3. **`src/pages/AoVivo.tsx`** — Add `AvatarImage` in the "current speaker" card, `TranscriptBlock`, and `SessionSpeakersCard` avatars.

All three files already import `Avatar` and `AvatarFallback`. The only addition is importing `AvatarImage` and inserting `<AvatarImage src={photo_url} />` before each `<AvatarFallback>`. The fallback initials display automatically when the image fails or is null.

### Build error fix

The `@supabase/realtime-js` import error in edge functions will also be addressed by removing the problematic npm import from the edge function code (Deno doesn't resolve npm packages the same way).

