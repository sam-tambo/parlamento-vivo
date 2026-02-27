import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PORTUGUESE_FILLERS = [
  "portanto", "digamos", "ou seja", "pronto", "basicamente",
  "efetivamente", "de facto", "na verdade", "quer dizer", "tipo",
  "ok", "bem", "olhe", "enfim",
];

function countFillers(text: string): { total: number; detail: Record<string, number>; totalWords: number } {
  const lower = text.toLowerCase();
  const totalWords = lower.split(/\s+/).filter(Boolean).length;
  const detail: Record<string, number> = {};
  let total = 0;

  for (const filler of PORTUGUESE_FILLERS) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) {
      detail[filler] = matches.length;
      total += matches.length;
    }
  }

  return { total, detail, totalWords };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();

    // Mode 1: Receive pre-processed results from external worker
    if (body.mode === "results") {
      const { session_id, speeches } = body;
      if (!session_id || !speeches?.length) {
        return new Response(JSON.stringify({ error: "session_id and speeches[] required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let totalFillers = 0;
      let totalSpeakingSeconds = 0;

      for (const s of speeches) {
        const fillerAnalysis = s.filler_words_detail
          ? { total: s.filler_word_count, detail: s.filler_words_detail, totalWords: s.total_word_count }
          : countFillers(s.transcript_excerpt || "");

        const speechRow = {
          session_id,
          politician_id: s.politician_id,
          speaking_duration_seconds: s.speaking_duration_seconds || 0,
          filler_word_count: fillerAnalysis.total,
          total_word_count: fillerAnalysis.totalWords,
          filler_ratio: fillerAnalysis.totalWords > 0 ? fillerAnalysis.total / fillerAnalysis.totalWords : 0,
          filler_words_detail: fillerAnalysis.detail,
          transcript_excerpt: s.transcript_excerpt || null,
        };

        const { error } = await supabase.from("speeches").insert(speechRow);
        if (error) console.error("Insert speech error:", error);

        totalFillers += fillerAnalysis.total;
        totalSpeakingSeconds += speechRow.speaking_duration_seconds;

        // Update politician aggregates
        await supabase.rpc("update_politician_aggregates_manual", {
          p_id: s.politician_id,
          add_seconds: speechRow.speaking_duration_seconds,
          add_fillers: fillerAnalysis.total,
          add_speeches: 1,
          new_ratio: speechRow.filler_ratio,
        }).then(({ error }) => {
          // If RPC doesn't exist, fall back to manual update
          if (error) {
            return supabase
              .from("politicians")
              .select("total_speaking_seconds, total_filler_count, total_speeches")
              .eq("id", s.politician_id)
              .single()
              .then(({ data: pol }) => {
                if (!pol) return;
                const newTotalSpeeches = (pol.total_speeches || 0) + 1;
                const newTotalSeconds = (pol.total_speaking_seconds || 0) + speechRow.speaking_duration_seconds;
                const newTotalFillers = (pol.total_filler_count || 0) + fillerAnalysis.total;
                return supabase.from("politicians").update({
                  total_speaking_seconds: newTotalSeconds,
                  total_filler_count: newTotalFillers,
                  total_speeches: newTotalSpeeches,
                  average_filler_ratio: newTotalFillers / Math.max(newTotalSpeeches, 1),
                }).eq("id", s.politician_id);
              });
          }
        });
      }

      // Update session
      await supabase.from("sessions").update({
        transcript_status: "completed",
        total_filler_count: totalFillers,
        total_speaking_minutes: totalSpeakingSeconds / 60,
      }).eq("id", session_id);

      return new Response(JSON.stringify({ ok: true, speeches_processed: speeches.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mode 2: Transcribe audio via HuggingFace Whisper API
    if (body.mode === "transcribe") {
      const { audio_url, session_id } = body;
      if (!audio_url) {
        return new Response(JSON.stringify({ error: "audio_url required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hfToken = Deno.env.get("HF_TOKEN");
      if (!hfToken) {
        return new Response(JSON.stringify({ error: "HF_TOKEN not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update session status
      if (session_id) {
        await supabase.from("sessions").update({ transcript_status: "processing" }).eq("id", session_id);
      }

      // Fetch audio
      const audioRes = await fetch(audio_url);
      const audioBlob = await audioRes.blob();

      // Call HuggingFace Whisper
      const hfRes = await fetch(
        "https://api-inference.huggingface.co/models/openai/whisper-medium",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${hfToken}` },
          body: audioBlob,
        }
      );

      if (!hfRes.ok) {
        const errText = await hfRes.text();
        console.error("HF API error:", errText);
        if (session_id) {
          await supabase.from("sessions").update({ transcript_status: "failed" }).eq("id", session_id);
        }
        return new Response(JSON.stringify({ error: "HF transcription failed", details: errText }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await hfRes.json();
      const transcript = result.text || "";

      // Analyze fillers
      const analysis = countFillers(transcript);

      return new Response(JSON.stringify({
        transcript,
        filler_analysis: analysis,
        session_id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid mode. Use 'results' or 'transcribe'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Transcribe error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
