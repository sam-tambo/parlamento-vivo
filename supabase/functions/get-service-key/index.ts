// TEMPORARY — delete after retrieving the key
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (_req) => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "NOT_FOUND";
  return new Response(JSON.stringify({ service_role_key: key }), {
    headers: { "Content-Type": "application/json" },
  });
});
