

## Diagnosis

The `transcribe` edge function is returning **502 errors** because the HuggingFace Whisper Inference API rejects `multipart/form-data`. The error from HF is explicit:

> Content type "multipart/form-data; boundary=..." not supported.

The previous "fix" incorrectly changed from raw binary (`application/octet-stream`) to `FormData`. According to the current HF Inference Providers documentation, the ASR endpoint accepts **raw audio bytes** when no parameters are provided.

## Root Cause

In `supabase/functions/transcribe/index.ts`, the `transcribeWithHF` function wraps audio in `FormData` (lines 106-108), but HF's router expects raw bytes with `Content-Type: audio/mpeg` or `application/octet-stream`.

## Fix

Revert the `transcribeWithHF` function to send raw bytes:

```typescript
const resp = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${hfToken}`,
    "Content-Type": "audio/mpeg",
    "X-Wait-For-Model": "true",
  },
  body: audioBytes,
  signal: AbortSignal.timeout(60_000),
});
```

Changes:
- Remove `FormData` and `Blob` construction (lines 106-108)
- Set explicit `Content-Type: audio/mpeg` header
- Pass `audioBytes` directly as the request body
- Redeploy the `transcribe` edge function

This is a single-file change in `supabase/functions/transcribe/index.ts`, approximately 5 lines modified.

