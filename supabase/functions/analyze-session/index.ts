/**
 * Supabase Edge Function: analyze-session
 * ========================================
 * POST { session_id: string }
 *
 * Fetches parsed session data from Supabase, calls the Anthropic Claude API
 * to generate a citizen-readable summary, key decisions, notable moments and
 * party positions, then writes results back to the sessions and party_positions tables.
 *
 * Secrets required (Supabase → Project Settings → Edge Function Secrets):
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   SUPABASE_URL        — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected (use service role for writes)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_MODEL = "claude-sonnet-4-6";

// ─── Supabase client ──────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function callClaude(prompt: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    console.error("[claude] HTTP", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(
  session: Record<string, any>,
  interventions: Record<string, any>[],
  votes: Record<string, any>[],
): string {
  const date    = session.date ?? "?";
  const sessNum = session.session_number ?? "?";
  const leg     = session.legislatura ?? "?";
  const pres    = session.president_name ?? "Presidente da AR";
  const nDeps   = session.deputies_present ?? "?";

  // Build concise intervention summary (cap at 80 entries to avoid token overflow)
  const byParty: Record<string, string[]> = {};
  const ivLines = interventions.slice(0, 80).map((iv) => {
    const name  = iv.deputy_name ?? "?";
    const party = iv.party ?? "?";
    const wc    = iv.word_count ?? 0;
    const fc    = iv.filler_word_count ?? 0;
    const flags: string[] = [];
    if (iv.was_mic_cutoff) flags.push("⚠️ mic cortado");
    if (iv.applause_from?.length) flags.push(`👏 ${iv.applause_from.join(", ")}`);
    if (iv.protests_from?.length) flags.push(`📢 protestos de ${iv.protests_from.join(", ")}`);
    if (party !== "?") (byParty[party] = byParty[party] ?? []).push(name);
    const snippet = (iv.text ?? "").slice(0, 250);
    return `- ${name} (${party}, ${wc}w, ${fc} fillers)${flags.length ? " [" + flags.join(", ") + "]" : ""}: ${snippet}…`;
  });

  const parties = Object.keys(byParty).sort().join(", ");

  const voteLines = votes.map((v) => {
    const desc    = (v.description ?? "?").slice(0, 100);
    const result  = v.result ?? "?";
    const favor   = (v.favor ?? []).join(", ") || "—";
    const against = (v.against ?? []).join(", ") || "—";
    const abstain = (v.abstain ?? []).join(", ") || "—";
    const dis     = v.dissidents ?? [];
    return `- ${desc} → ${result} | favor: ${favor} | contra: ${against} | abs: ${abstain}${dis.length ? "; dissidentes: " + JSON.stringify(dis) : ""}`;
  });

  return `Analisa esta sessão plenária da Assembleia da República Portuguesa como um jornalista cívico experiente.

# Metadados da Sessão
- Legislatura: ${leg} | Sessão nº: ${sessNum} | Data: ${date}
- Presidente: ${pres}
- Deputados presentes: ${nDeps}
- Partidos presentes: ${parties}

# Intervenções (resumo)
${ivLines.join("\n") || "(sem intervenções registadas)"}

# Votações
${voteLines.join("\n") || "(sem votações registadas)"}

---

Responde EXCLUSIVAMENTE com JSON válido no seguinte formato (sem markdown, sem texto extra):

{
  "summary_pt": "Resumo em português para cidadãos (máx. 300 palavras). Explica o que aconteceu de forma clara e imparcial. Menciona os temas principais, as decisões tomadas e os momentos notáveis.",
  "summary_en": "English translation of the summary (max 200 words). Clear and factual.",
  "key_decisions": [
    {
      "description": "Descrição breve da decisão",
      "result": "aprovado | rejeitado | retirado",
      "significance": "Porque é importante para os cidadãos (1 frase)"
    }
  ],
  "notable_moments": [
    {
      "type": "mic_cutoff | heated_exchange | party_split | record_filler | dissent",
      "description": "O que aconteceu (1-2 frases)",
      "deputies_involved": ["Nome do deputado"]
    }
  ],
  "party_positions": [
    {
      "topic": "Nome do tema (ex: Habitação, Saúde, Orçamento)",
      "party": "Sigla do partido",
      "position_summary": "Posição do partido (1 frase)",
      "vote_alignment": "favor | against | abstain | mixed | not_present"
    }
  ]
}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supa = getSupabase();

    // Fetch session
    const { data: session } = await supa
      .from("sessions")
      .select("*")
      .eq("id", session_id)
      .maybeSingle();

    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
    }

    // Fetch interventions
    const { data: interventions = [] } = await supa
      .from("interventions")
      .select("deputy_name,party,type,text,word_count,filler_word_count,was_mic_cutoff,applause_from,protests_from")
      .eq("session_id", session_id)
      .order("sequence_number", { ascending: true })
      .limit(200);

    // Fetch votes
    const { data: votes = [] } = await supa
      .from("votes")
      .select("description,result,favor,against,abstain,dissidents")
      .eq("session_id", session_id)
      .order("sequence_number", { ascending: true });

    // Build prompt and call Claude
    const prompt   = buildPrompt(session, interventions ?? [], votes ?? []);
    const rawText  = await callClaude(prompt);

    if (!rawText) {
      return new Response(JSON.stringify({ error: "Claude API call failed" }), { status: 502 });
    }

    // Parse JSON (strip markdown fences if present)
    let analysis: Record<string, any>;
    let cleaned = rawText;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.split("\n").slice(1).join("\n");
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3).trimEnd();
    }
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: "Claude returned invalid JSON", raw: rawText.slice(0, 200) }), { status: 500 });
    }

    // Update session
    await supa.from("sessions").update({
      summary_pt:      analysis.summary_pt,
      summary_en:      analysis.summary_en,
      key_decisions:   analysis.key_decisions ?? [],
      notable_moments: analysis.notable_moments ?? [],
      analysis_status: "analyzed",
    }).eq("id", session_id);

    // Upsert party positions
    const positions = (analysis.party_positions ?? []) as Array<Record<string, string>>;
    if (positions.length > 0) {
      const rows = positions
        .filter((p) => p.party && p.topic)
        .map((p) => ({
          id:               crypto.randomUUID(),
          session_id,
          topic:            p.topic,
          party:            p.party,
          position_summary: p.position_summary ?? null,
          vote_alignment:   p.vote_alignment ?? null,
        }));
      await supa.from("party_positions").insert(rows);
    }

    return new Response(
      JSON.stringify({ ok: true, session_id, parties_analyzed: positions.length }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
    );
  } catch (err) {
    console.error("[analyze-session]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
