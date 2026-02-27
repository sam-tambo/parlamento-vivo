/**
 * Supabase Edge Function: scrape-politicians
 * ============================================
 * Fetches all 230 deputies from the Portuguese Parliament's flat list page
 * (Deputadoslista.aspx — no pagination) and upserts them into `politicians`.
 *
 * Data source:
 *   https://www.parlamento.pt/DeputadoGP/Paginas/Deputadoslista.aspx
 *
 * Photo URL pattern:
 *   https://app.parlamento.pt/webutils/getimage.aspx?id={BID}&type=deputado
 *
 * Call: POST /functions/v1/scrape-politicians
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const PARTY_MAP: Record<string, string> = {
  "AD": "AD", "PSD": "PSD", "CDS-PP": "CDS", "PPM": "PPM",
  "PS": "PS", "CH": "CH", "Chega": "CH",
  "IL": "IL", "BE": "BE", "CDU": "PCP", "PCP": "PCP",
  "L": "L", "Livre": "L", "PAN": "PAN", "NI": "NI",
};

const PHOTO_URL = (bid: number) =>
  `https://app.parlamento.pt/webutils/getimage.aspx?id=${bid}&type=deputado`;
const DEPUTY_PAGE = (bid: number) =>
  `https://www.parlamento.pt/DeputadoGP/Paginas/Biografia.aspx?BID=${bid}`;

// Flat list page — all 230 deputies without pagination
const DEPUTIES_LIST_URL =
  "https://www.parlamento.pt/DeputadoGP/Paginas/Deputadoslista.aspx";

interface Deputy {
  name: string;
  party: string;
  photo_url: string;
  parlamento_url: string;
}

// ─── Strategy 1: Direct HTML scrape of flat list page ──────────────────────

async function fetchFromFlatList(): Promise<Deputy[]> {
  console.log("[scrape] Fetching flat deputies list…");
  const resp = await fetch(DEPUTIES_LIST_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ParlamentoVivo/1.0)" },
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    console.error(`[scrape] Flat list returned ${resp.status}`);
    return [];
  }

  const html = await resp.text();
  console.log(`[scrape] Got ${html.length} bytes of HTML`);
  return parseDeputiesHtml(html);
}

// ─── Strategy 2: Firecrawl fallback ─────────────────────────────────────────

async function fetchWithFirecrawl(): Promise<Deputy[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return [];

  console.log("[scrape] Trying Firecrawl fallback…");
  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: DEPUTIES_LIST_URL,
      formats: ["html"],
      waitFor: 5000,
    }),
  });

  if (!resp.ok) return [];

  const result = await resp.json();
  const html = result?.data?.html || result?.html || "";
  if (!html) return [];

  return parseDeputiesHtml(html);
}

// ─── HTML parser ────────────────────────────────────────────────────────────

function parseDeputiesHtml(html: string): Deputy[] {
  const deputies: Deputy[] = [];
  const seen = new Set<string>();

  // Pattern: <a ... href="...Biografia.aspx?BID=XXXX">Name</a>
  // Followed by party in a <span> with class "TextoRegular"
  const bidPattern = /href="[^"]*Biografia\.aspx\?BID=(\d+)"[^>]*>([^<]+)<\/a>/gi;

  // Extract all BID+name pairs with their positions
  const matches: { bid: number; name: string; index: number }[] = [];
  let m;
  while ((m = bidPattern.exec(html)) !== null) {
    const bid = parseInt(m[1]);
    const name = m[2].trim();
    if (name.length >= 3 && !name.includes("[ver")) {
      matches.push({ bid, name, index: m.index });
    }
  }

  console.log(`[scrape] Found ${matches.length} BID links`);

  // For each deputy, look for the party label nearby
  for (const dep of matches) {
    if (seen.has(dep.name)) continue;

    // Search for party in the next ~2000 chars after the name link
    const window = html.substring(dep.index, dep.index + 2000);
    
    // Look for "Grupo Parlamentar / Partido" followed by party text
    let party = "?";
    const gpMatch = window.match(
      /Grupo Parlamentar \/ Partido<\/div>\s*<span[^>]*class="TextoRegular"[^>]*>([^<]+)<\/span>/i,
    );
    if (gpMatch) {
      const raw = gpMatch[1].trim();
      party = PARTY_MAP[raw] ?? raw;
    }

    seen.add(dep.name);
    deputies.push({
      name: dep.name,
      party,
      photo_url: PHOTO_URL(dep.bid),
      parlamento_url: DEPUTY_PAGE(dep.bid),
    });
  }

  return deputies;
}

// ─── Main handler ─────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── Fetch deputies ──────────────────────────────────────────────────
    let deputies = await fetchFromFlatList();

    if (deputies.length < 50) {
      console.log(
        `[scrape] Direct fetch got only ${deputies.length}, trying Firecrawl…`,
      );
      const fallback = await fetchWithFirecrawl();
      if (fallback.length > deputies.length) deputies = fallback;
    }

    if (deputies.length === 0) {
      return Response.json(
        {
          success: false,
          error: "Could not fetch any deputies",
          deputies_found: 0,
        },
        { status: 500, headers: CORS },
      );
    }

    console.log(`[scrape] Total deputies to upsert: ${deputies.length}`);

    // ── Upsert into politicians table ───────────────────────────────────
    const BATCH_SIZE = 50;
    let totalUpserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < deputies.length; i += BATCH_SIZE) {
      const batch = deputies.slice(i, i + BATCH_SIZE).map((d) => ({
        name: d.name,
        party: d.party,
        photo_url: d.photo_url,
        parlamento_url: d.parlamento_url,
      }));

      const { error } = await supabase
        .from("politicians")
        .upsert(batch, { onConflict: "name" });

      if (error) {
        console.error(
          `[scrape] Upsert error (batch ${Math.floor(i / BATCH_SIZE)}):`,
          error.message,
        );
        errors.push(error.message);
      } else {
        totalUpserted += batch.length;
      }
    }

    console.log(`[scrape] Done! Upserted ${totalUpserted}/${deputies.length}`);

    return Response.json(
      {
        success: true,
        deputies_found: deputies.length,
        deputies_upserted: totalUpserted,
        errors: errors.length > 0 ? errors : undefined,
        sample: deputies.slice(0, 5).map((d) => ({
          name: d.name,
          party: d.party,
          photo_url: d.photo_url,
        })),
      },
      { headers: CORS },
    );
  } catch (err) {
    console.error("[scrape] Fatal error:", err);
    return Response.json(
      { success: false, error: String(err) },
      { status: 500, headers: CORS },
    );
  }
});
