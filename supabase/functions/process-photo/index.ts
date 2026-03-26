/**
 * process-photo Edge Function
 *
 * Receives { job_id, tenant_id, storage_path, file_type }, downloads the photo
 * from Supabase Storage, sends it to the backend OCR endpoint, stores the
 * resulting transcript in job_field_notes, then fires evaluate-compliance.
 *
 * Env vars required:
 *   BACKEND_URL                   — base URL of the FastAPI backend
 *   SUPABASE_URL                  (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Env vars ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "";

// ── Supabase admin client ─────────────────────────────────────────────────────
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface RequestBody {
  job_id: string;
  tenant_id: string;
  storage_path: string;
  file_type?: string;
}

interface OcrResponse {
  text: string;
  confidence?: number;
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 1. Parse & validate request body ─────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { job_id, tenant_id, storage_path, file_type } = body;

  if (!job_id || !tenant_id || !storage_path) {
    return new Response(
      JSON.stringify({ error: "job_id, tenant_id, and storage_path are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!BACKEND_URL) {
    console.error(`[process-photo] job_id=${job_id}: BACKEND_URL not configured`);
    return new Response(
      JSON.stringify({ error: "Backend not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Download photo from Supabase Storage ───────────────────────────────
  let imageBase64: string;
  try {
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
      .from("field-photos")
      .download(storage_path);

    if (downloadErr || !fileData) {
      throw new Error(downloadErr?.message ?? "Empty file returned from storage");
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    imageBase64 = btoa(String.fromCharCode(...uint8Array));
  } catch (err) {
    console.error(`[process-photo] job_id=${job_id}: Storage download failed —`, err);
    return new Response(
      JSON.stringify({ error: `Storage download failed: ${String(err)}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Call backend OCR endpoint ──────────────────────────────────────────
  let ocrText = "";
  let ocrConfidence: number | undefined;
  try {
    const ocrRes = await fetch(`${BACKEND_URL}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id,
        tenant_id,
        image_base64: imageBase64,
        file_type: file_type ?? "image/jpeg",
        storage_path,
      }),
    });

    if (!ocrRes.ok) {
      const errText = await ocrRes.text();
      throw new Error(`OCR endpoint returned ${ocrRes.status}: ${errText}`);
    }

    const ocrJson: OcrResponse = await ocrRes.json();
    ocrText = ocrJson.text ?? "";
    ocrConfidence = ocrJson.confidence;
  } catch (err) {
    console.error(`[process-photo] job_id=${job_id}: OCR failed —`, err);

    // Record failure in job_field_notes so the job isn't left in limbo
    await supabaseAdmin.from("job_field_notes").insert({
      job_id,
      tenant_id,
      source: "photo_ocr",
      content: "",
      raw_storage_path: storage_path,
      parse_status: "failed",
      error_detail: String(err),
    });

    return new Response(
      JSON.stringify({ error: `OCR failed: ${String(err)}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 4. Persist OCR transcript to job_field_notes ──────────────────────────
  const { data: noteRow, error: insertErr } = await supabaseAdmin
    .from("job_field_notes")
    .insert({
      job_id,
      tenant_id,
      source: "photo_ocr",
      content: ocrText,
      raw_storage_path: storage_path,
      ocr_confidence: ocrConfidence,
      parse_status: "pending",
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error(`[process-photo] job_id=${job_id}: DB insert failed —`, insertErr);
    return new Response(
      JSON.stringify({ error: insertErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const field_note_id: string = noteRow?.id ?? "";

  // ── 5. Fire evaluate-compliance (async — do not await) ────────────────────
  // Even if the text is empty we fire so evaluate-compliance can mark it appropriately.
  supabaseAdmin.functions.invoke("evaluate-compliance", {
    body: {
      field_event_id: field_note_id,  // evaluate-compliance expects field_event_id
      transcript: ocrText,
      job_id,
      tenant_id,
    },
  }).catch((err: unknown) => {
    // Fire-and-forget — log but don't fail this request
    console.error(`[process-photo] job_id=${job_id}: evaluate-compliance invoke failed —`, err);
  });

  return new Response(
    JSON.stringify({
      success: true,
      job_id,
      field_note_id,
      ocr_text_length: ocrText.length,
      ocr_confidence: ocrConfidence,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
