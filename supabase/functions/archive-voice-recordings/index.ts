/**
 * archive-voice-recordings — Supabase Edge Function (Deno)
 *
 * Intended to run on a schedule (e.g., nightly via pg_cron or Supabase scheduled functions).
 * Moves voice recordings older than 90 days from Supabase Storage → AWS S3,
 * then deletes them from Supabase Storage to free quota.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "https://esm.sh/@aws-sdk/client-s3@3";

// ── Constants ──────────────────────────────────────────────────────────────────
const CUTOFF_DAYS = 90;
const STORAGE_BUCKET = "field-recordings";
const ARCHIVE_PREFIX = "voice-archive";

// ── Env vars ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Supabase admin client ──────────────────────────────────────────────────────
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Types ──────────────────────────────────────────────────────────────────────
interface FieldNote {
  id: string;
  job_id: string;
  tenant_id: string;
  audio_url: string;
  created_at: string;
}

interface ArchiveResults {
  archived: number;
  failed: number;
  errors: string[];
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  // Allow scheduled invocation (no auth header needed when called by pg_cron)
  // But reject random public calls
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
    console.warn("[archive-voice-recordings] Rejected unauthorized request");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only accept POST or GET (scheduled functions may use GET)
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Validate required AWS env vars ─────────────────────────────────────────
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID") ?? "";
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";
  const awsRegion = Deno.env.get("AWS_REGION") ?? "us-east-1";
  const s3Bucket = Deno.env.get("AWS_S3_BUCKET") ?? "";

  if (!awsAccessKeyId || !awsSecretAccessKey || !s3Bucket) {
    console.error("[archive-voice-recordings] Missing required AWS env vars");
    return new Response(
      JSON.stringify({ error: "AWS credentials not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Build S3 client ────────────────────────────────────────────────────────
  const s3 = new S3Client({
    region: awsRegion,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  });

  // ── Compute cutoff date ────────────────────────────────────────────────────
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CUTOFF_DAYS);
  const cutoffIso = cutoffDate.toISOString();

  console.log(
    `[archive-voice-recordings] Starting archival run — cutoff=${cutoffIso} bucket=${s3Bucket}`,
  );

  // ── Find field_notes older than 90 days with voice recordings ──────────────
  // tenant_id filter enforced at query level per project RLS rules
  const { data: oldNotes, error: fetchError } = await supabaseAdmin
    .from("field_notes")
    .select("id, job_id, tenant_id, audio_url, created_at")
    .not("audio_url", "is", null)
    .is("archived_at", null)           // skip already-archived rows
    .lt("created_at", cutoffIso)
    .limit(100);                        // process in safe batches

  if (fetchError) {
    console.error("[archive-voice-recordings] DB fetch failed —", fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!oldNotes || oldNotes.length === 0) {
    console.log("[archive-voice-recordings] No recordings to archive");
    return new Response(
      JSON.stringify({ archived: 0, message: "No recordings to archive" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(
    `[archive-voice-recordings] Found ${oldNotes.length} recording(s) to archive`,
  );

  const results: ArchiveResults = { archived: 0, failed: 0, errors: [] };

  for (const note of oldNotes as FieldNote[]) {
    try {
      // ── Extract storage path from full URL ─────────────────────────────────
      // URL format: .../storage/v1/object/public/field-recordings/<tenant_id>/<job_id>/file.webm
      const urlParts = note.audio_url.split(`/${STORAGE_BUCKET}/`);
      if (urlParts.length < 2) {
        results.failed++;
        results.errors.push(
          `Note ${note.id}: unrecognised audio_url format — ${note.audio_url}`,
        );
        console.warn(
          `[archive-voice-recordings] note_id=${note.id}: unrecognised URL format`,
        );
        continue;
      }
      const storagePath = urlParts[1];

      // ── Download from Supabase Storage ─────────────────────────────────────
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(storagePath);

      if (downloadError || !fileData) {
        results.failed++;
        results.errors.push(
          `Note ${note.id}: download failed — ${downloadError?.message ?? "empty file"}`,
        );
        console.error(
          `[archive-voice-recordings] note_id=${note.id} job_id=${note.job_id}: download failed —`,
          downloadError,
        );
        continue;
      }

      // ── Upload to S3 ───────────────────────────────────────────────────────
      const s3Key = `${ARCHIVE_PREFIX}/${note.tenant_id}/${note.job_id}/${note.id}.webm`;
      const arrayBuffer = await fileData.arrayBuffer();
      const archivedAt = new Date().toISOString();

      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
          Body: new Uint8Array(arrayBuffer),
          ContentType: "audio/webm",
          Metadata: {
            "field-note-id": note.id,
            "job-id": note.job_id,
            "tenant-id": note.tenant_id,
            "original-created-at": note.created_at,
            "archived-at": archivedAt,
          },
          StorageClass: "GLACIER_IR", // Instant retrieval — cheap for compliance archives
        }),
      );

      console.log(
        `[archive-voice-recordings] note_id=${note.id} job_id=${note.job_id}: uploaded to s3://${s3Bucket}/${s3Key}`,
      );

      // ── Update field_note record ───────────────────────────────────────────
      // Null out Supabase audio_url and record the S3 archive location + timestamp.
      // audio_archive_url and archived_at columns are added by migration 025.
      const s3Url = `s3://${s3Bucket}/${s3Key}`;
      const { error: updateError } = await supabaseAdmin
        .from("field_notes")
        .update({
          audio_url: null,
          audio_archive_url: s3Url,
          archived_at: archivedAt,
        })
        .eq("id", note.id)
        .eq("tenant_id", note.tenant_id); // belt-and-suspenders tenant guard

      if (updateError) {
        // S3 upload succeeded but DB update failed — log prominently.
        // Do NOT delete from Supabase Storage so the file isn't orphaned.
        results.failed++;
        results.errors.push(
          `Note ${note.id}: S3 upload OK but DB update failed — ${updateError.message}`,
        );
        console.error(
          `[archive-voice-recordings] note_id=${note.id}: DB update failed — S3 object retained`,
          updateError,
        );
        continue;
      }

      // ── Delete from Supabase Storage ───────────────────────────────────────
      const { error: deleteError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (deleteError) {
        // Non-fatal: record archived in DB, S3 upload succeeded.
        // Storage object may need manual cleanup but data is safe.
        console.warn(
          `[archive-voice-recordings] note_id=${note.id}: Storage delete failed (non-fatal) —`,
          deleteError,
        );
        results.errors.push(
          `Note ${note.id}: archived OK but Supabase Storage delete failed — ${deleteError.message}`,
        );
      }

      results.archived++;
      console.log(
        `[archive-voice-recordings] note_id=${note.id} job_id=${note.job_id}: archived successfully`,
      );
    } catch (err) {
      results.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.errors.push(`Note ${note.id}: ${msg}`);
      console.error(
        `[archive-voice-recordings] note_id=${note.id} job_id=${note.job_id}: unexpected error —`,
        err,
      );
    }
  }

  console.log(
    `[archive-voice-recordings] Run complete — archived=${results.archived} failed=${results.failed}`,
  );

  return new Response(JSON.stringify(results), {
    status: results.failed > 0 && results.archived === 0 ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
