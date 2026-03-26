/**
 * process-voice Edge Function
 *
 * Receives a field_event_id + audio_url, transcribes with Deepgram,
 * stores the transcript in field_events, then invokes evaluate-compliance.
 *
 * Env vars required:
 *   DEEPGRAM_API_KEY
 *   SUPABASE_URL          (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { field_event_id: string; audio_url: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { field_event_id, audio_url } = body;
  if (!field_event_id || !audio_url) {
    return new Response(
      JSON.stringify({ error: "field_event_id and audio_url are required" }),
      { status: 400 },
    );
  }

  if (!DEEPGRAM_API_KEY) {
    console.error("DEEPGRAM_API_KEY not set");
    return new Response(JSON.stringify({ error: "Deepgram not configured" }), { status: 500 });
  }

  // ── 1. Transcribe via Deepgram ─────────────────────────────────────────────
  let transcript = "";
  let confidence = 0;

  try {
    const dgRes = await fetch(
      `https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: audio_url }),
      },
    );

    if (!dgRes.ok) {
      throw new Error(`Deepgram error ${dgRes.status}: ${await dgRes.text()}`);
    }

    const dgJson = await dgRes.json();
    const alt = dgJson?.results?.channels?.[0]?.alternatives?.[0];
    transcript = alt?.transcript ?? "";
    confidence = alt?.confidence ?? 0;
  } catch (err) {
    console.error("Deepgram transcription failed:", err);
    await sb
      .from("field_events")
      .update({ compliance_status: "fail", parsed_data: { error: String(err) } })
      .eq("id", field_event_id);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }

  // ── 2. Store transcript ────────────────────────────────────────────────────
  const { error: updateErr } = await sb
    .from("field_events")
    .update({
      transcript,
      transcript_confidence: confidence,
      compliance_status: "pending",
    })
    .eq("id", field_event_id);

  if (updateErr) {
    console.error("Failed to store transcript:", updateErr);
    return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
  }

  // ── 3. Fire evaluate-compliance (async — don't await) ─────────────────────
  sb.functions.invoke("evaluate-compliance", {
    body: { field_event_id, transcript },
  });

  return new Response(
    JSON.stringify({ success: true, field_event_id, transcript_length: transcript.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
