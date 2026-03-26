/**
 * generate-report Edge Function
 *
 * Receives { job_id, tenant_id }, assembles full job data from the DB,
 * posts it to the backend report generator, uploads the returned PDF to
 * Supabase Storage, and returns a signed URL valid for 1 hour.
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
}

interface BackendReportResponse {
  /** Base64-encoded PDF bytes, or a URL to the generated PDF */
  pdf_base64?: string;
  pdf_url?: string;
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

  const { job_id, tenant_id } = body;

  if (!job_id || !tenant_id) {
    return new Response(
      JSON.stringify({ error: "job_id and tenant_id are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!BACKEND_URL) {
    console.error(`[generate-report] job_id=${job_id}: BACKEND_URL not configured`);
    return new Response(
      JSON.stringify({ error: "Backend not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Fetch job record ───────────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("id", job_id)
    .eq("tenant_id", tenant_id)   // enforce tenant isolation
    .single();

  if (jobErr || !job) {
    console.error(`[generate-report] job_id=${job_id}: Job not found —`, jobErr);
    return new Response(
      JSON.stringify({ error: "Job not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 3. Fetch reconciliation results ──────────────────────────────────────
  const { data: reconciliationResults, error: recErr } = await supabaseAdmin
    .from("reconciliation_results")
    .select("*")
    .eq("job_id", job_id)
    .eq("tenant_id", tenant_id);

  if (recErr) {
    console.error(`[generate-report] job_id=${job_id}: Failed to fetch reconciliation results —`, recErr);
    return new Response(
      JSON.stringify({ error: recErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 4. Fetch field notes ──────────────────────────────────────────────────
  const { data: fieldNotes, error: notesErr } = await supabaseAdmin
    .from("job_field_notes")
    .select("*")
    .eq("job_id", job_id)
    .eq("tenant_id", tenant_id);

  if (notesErr) {
    console.error(`[generate-report] job_id=${job_id}: Failed to fetch field notes —`, notesErr);
    return new Response(
      JSON.stringify({ error: notesErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 5. Call backend report generator ─────────────────────────────────────
  // Forward the caller's auth token so the backend can enforce its own authz.
  const authHeader = req.headers.get("authorization") ?? "";

  let pdfBytes: Uint8Array;
  try {
    const backendRes = await fetch(`${BACKEND_URL}/reports/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        job,
        reconciliation_results: reconciliationResults ?? [],
        field_notes: fieldNotes ?? [],
      }),
    });

    if (!backendRes.ok) {
      const errText = await backendRes.text();
      throw new Error(`Backend report generation returned ${backendRes.status}: ${errText}`);
    }

    const backendJson: BackendReportResponse = await backendRes.json();

    if (backendJson.pdf_base64) {
      // Decode base64 → binary
      const binaryStr = atob(backendJson.pdf_base64);
      pdfBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        pdfBytes[i] = binaryStr.charCodeAt(i);
      }
    } else if (backendJson.pdf_url) {
      // Backend returned a pre-generated URL — fetch the raw bytes
      const pdfRes = await fetch(backendJson.pdf_url);
      if (!pdfRes.ok) {
        throw new Error(`Failed to download PDF from backend URL: ${pdfRes.status}`);
      }
      pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    } else {
      throw new Error("Backend response contained neither pdf_base64 nor pdf_url");
    }
  } catch (err) {
    console.error(`[generate-report] job_id=${job_id}: Backend call failed —`, err);
    return new Response(
      JSON.stringify({ error: `Report generation failed: ${String(err)}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 6. Upload PDF to Supabase Storage ─────────────────────────────────────
  const storagePath = `reports/${tenant_id}/${job_id}.pdf`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("reports")
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,   // overwrite if a previous report exists for this job
    });

  if (uploadErr) {
    console.error(`[generate-report] job_id=${job_id}: Storage upload failed —`, uploadErr);
    return new Response(
      JSON.stringify({ error: `PDF upload failed: ${uploadErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 7. Create a signed URL (1 hour) ──────────────────────────────────────
  const { data: signedData, error: signErr } = await supabaseAdmin.storage
    .from("reports")
    .createSignedUrl(storagePath, 3600);   // 3600 seconds = 1 hour

  if (signErr || !signedData) {
    console.error(`[generate-report] job_id=${job_id}: createSignedUrl failed —`, signErr);
    return new Response(
      JSON.stringify({ error: `Failed to create signed URL: ${signErr?.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Permanent public path (only accessible via service role or RLS-cleared reads)
  const pdf_url = `${SUPABASE_URL}/storage/v1/object/reports/${storagePath}`;

  return new Response(
    JSON.stringify({
      success: true,
      job_id,
      pdf_url,
      signed_url: signedData.signedUrl,
      signed_url_expires_in: 3600,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
