import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const hour = now.getUTCHours(); // ARTV is in Portugal (WET/WEST = UTC+0/+1)
    const today = now.toISOString().split("T")[0];

    const results: string[] = [];

    // ── Step 1: Check if ARTV plenario is likely live (weekdays 10-17 Lisbon time) ──
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    // Approximate Lisbon time (UTC+0 in winter, UTC+1 in summer)
    const lisbonHour = hour; // Close enough for WET; adjust +1 for WEST if needed

    if (isWeekday && lisbonHour >= 10 && lisbonHour < 17) {
      // Check if we already have a session for today
      const { data: existingSession } = await supabase
        .from("sessions")
        .select("id, status")
        .eq("date", today)
        .maybeSingle();

      if (!existingSession) {
        // Create a new session record for today's potential plenary
        const { data: newSession, error } = await supabase.from("sessions").insert({
          date: today,
          status: "live",
          transcript_status: "pending",
          artv_stream_url: "https://canal.parlamento.pt/plenario",
          start_time: `${String(lisbonHour).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
        }).select("id").single();

        if (error) {
          console.error("Failed to create session:", error);
        } else {
          results.push(`Created session ${newSession.id} for ${today}`);
        }
      } else if (existingSession.status === "live") {
        results.push(`Session for ${today} already live (${existingSession.id})`);
      }
    } else {
      // Outside monitoring hours — mark any live sessions as ended
      const { data: liveSessions } = await supabase
        .from("sessions")
        .select("id")
        .eq("date", today)
        .eq("status", "live");

      if (liveSessions?.length) {
        for (const s of liveSessions) {
          await supabase.from("sessions").update({
            status: "ended",
            end_time: `${String(lisbonHour).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
          }).eq("id", s.id);
          results.push(`Marked session ${s.id} as ended`);
        }
      }
    }

    // ── Step 2: Process pending transcriptions ──
    const { data: pendingSessions } = await supabase
      .from("sessions")
      .select("id, artv_video_url, artv_stream_url")
      .eq("transcript_status", "pending")
      .eq("status", "ended")
      .limit(3);

    if (pendingSessions?.length) {
      const hfToken = Deno.env.get("HF_TOKEN");
      if (!hfToken) {
        results.push("HF_TOKEN not set — skipping transcription");
      } else {
        for (const session of pendingSessions) {
          const audioUrl = session.artv_video_url || session.artv_stream_url;
          if (!audioUrl) {
            results.push(`Session ${session.id}: no audio URL, skipping`);
            continue;
          }

          // Mark as processing
          await supabase.from("sessions").update({ transcript_status: "processing" }).eq("id", session.id);

          // Call the transcribe function
          try {
            const transcribeUrl = `${supabaseUrl}/functions/v1/transcribe`;
            const res = await fetch(transcribeUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                mode: "transcribe",
                audio_url: audioUrl,
                session_id: session.id,
              }),
            });

            const resBody = await res.text();
            if (res.ok) {
              results.push(`Session ${session.id}: transcription started`);
            } else {
              results.push(`Session ${session.id}: transcription failed — ${resBody}`);
              await supabase.from("sessions").update({ transcript_status: "failed" }).eq("id", session.id);
            }
          } catch (err) {
            results.push(`Session ${session.id}: transcription error — ${err.message}`);
            await supabase.from("sessions").update({ transcript_status: "failed" }).eq("id", session.id);
          }
        }
      }
    } else {
      results.push("No pending transcriptions");
    }

    return new Response(JSON.stringify({ ok: true, time: now.toISOString(), results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Plenario cron error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
