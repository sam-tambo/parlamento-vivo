/**
 * Supabase Edge Function: search-sessions
 * ==========================================
 * GET / POST { q: string, party?: string, leg?: string, from?: string, limit?: number }
 *
 * Full-text search over session summaries and intervention text using
 * PostgreSQL's built-in Portuguese text search configuration.
 *
 * Returns: Array<{ id, date, session_number, legislatura, summary_pt, snippet }>
 *
 * Secrets required:
 *   SUPABASE_URL              — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    let q = "", party = "", leg = "", limitN = 20;

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      q       = body.q     ?? "";
      party   = body.party ?? "";
      leg     = body.leg   ?? "";
      limitN  = body.limit ?? 20;
    } else {
      const url = new URL(req.url);
      q       = url.searchParams.get("q")     ?? "";
      party   = url.searchParams.get("party") ?? "";
      leg     = url.searchParams.get("leg")   ?? "";
      limitN  = parseInt(url.searchParams.get("limit") ?? "20", 10);
    }

    if (!q.trim()) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const supa = getSupabase();

    // Use Postgres RPC for full-text search with ts_headline snippets
    const { data, error } = await supa.rpc("search_sessions_fts", {
      query_text: q,
      filter_party: party || null,
      filter_leg:   leg   || null,
      result_limit: Math.min(limitN, 50),
    });

    if (error) {
      // RPC may not exist yet — fall back to simple ilike
      console.warn("[search-sessions] RPC not found, using fallback:", error.message);

      let fbQuery = supa
        .from("sessions")
        .select("id, date, session_number, legislatura, summary_pt")
        .or(`summary_pt.ilike.%${q}%,full_text.ilike.%${q}%`)
        .order("date", { ascending: false })
        .limit(limitN);

      if (leg)   fbQuery = fbQuery.eq("legislatura", leg);

      const { data: fbData, error: fbError } = await fbQuery;
      if (fbError) throw fbError;

      return new Response(JSON.stringify(fbData ?? []), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response(JSON.stringify(data ?? []), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("[search-sessions]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
