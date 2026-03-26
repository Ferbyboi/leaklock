/**
 * send-notification Edge Function
 *
 * Receives { tenant_id, job_id, notification_type, payload } and fans out
 * notifications across every enabled channel (email / SMS / Slack) as
 * configured in the user's notification_prefs.
 *
 * notification_type values:
 *   'revenue_leak' | 'job_approved' | 'reconciliation_complete'
 *
 * Env vars required:
 *   BACKEND_URL              — base URL of the FastAPI backend
 *   TWILIO_ACCOUNT_SID       — Twilio account SID for SMS
 *   TWILIO_AUTH_TOKEN        — Twilio auth token for SMS
 *   TWILIO_FROM_NUMBER       — Twilio sender phone number (E.164 format)
 *   SLACK_WEBHOOK_URL        — Incoming Webhook URL for Slack
 *   SUPABASE_URL             (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Env vars ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";

// ── Supabase admin client ─────────────────────────────────────────────────────
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Types ─────────────────────────────────────────────────────────────────────
type NotificationType = "revenue_leak" | "job_approved" | "reconciliation_complete";

interface RequestBody {
  tenant_id: string;
  job_id: string;
  notification_type: NotificationType;
  /** Arbitrary extra data — e.g., estimated_leak_cents, invoice_number, etc. */
  payload?: Record<string, unknown>;
}

interface UserNotificationPrefs {
  email_alerts: boolean;
  sms_alerts: boolean;
  slack_alerts: boolean;
  alert_threshold_cents: number;
  email?: string | null;
  phone?: string | null;
}

interface ChannelResult {
  channel: "email" | "sms" | "slack";
  sent: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a human-readable subject line for the given notification type. */
function buildSubject(type: NotificationType, jobId: string): string {
  const map: Record<NotificationType, string> = {
    revenue_leak: `REVENUE LEAK DETECTED — Job ${jobId}`,
    job_approved: `Job Approved — Job ${jobId}`,
    reconciliation_complete: `Reconciliation Complete — Job ${jobId}`,
  };
  return map[type] ?? `LeakLock Alert — Job ${jobId}`;
}

/** Build Slack Block Kit message for the given notification type. */
function buildSlackBlocks(
  type: NotificationType,
  jobId: string,
  tenantId: string,
  payload: Record<string, unknown>,
): unknown[] {
  const emoji: Record<NotificationType, string> = {
    revenue_leak: ":rotating_light:",
    job_approved: ":white_check_mark:",
    reconciliation_complete: ":bar_chart:",
  };

  const header = `${emoji[type] ?? ":bell:"} *${buildSubject(type, jobId)}*`;

  const fields: Array<{ type: string; text: string }> = [
    { type: "mrkdwn", text: `*Job ID:*\n${jobId}` },
    { type: "mrkdwn", text: `*Tenant:*\n${tenantId}` },
  ];

  if (payload.estimated_leak_cents !== undefined) {
    const dollars = ((payload.estimated_leak_cents as number) / 100).toFixed(2);
    fields.push({ type: "mrkdwn", text: `*Estimated Leak:*\n$${dollars}` });
  }

  if (payload.invoice_number) {
    fields.push({ type: "mrkdwn", text: `*Invoice:*\n${payload.invoice_number}` });
  }

  return [
    { type: "header", text: { type: "plain_text", text: buildSubject(type, jobId), emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "section", fields },
    { type: "divider" },
  ];
}

// ── Channel senders ───────────────────────────────────────────────────────────

async function sendEmail(
  jobId: string,
  tenantId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
  recipientEmail: string,
): Promise<ChannelResult> {
  if (!BACKEND_URL) {
    return { channel: "email", sent: false, error: "BACKEND_URL not configured" };
  }

  try {
    const res = await fetch(`${BACKEND_URL}/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipientEmail,
        subject: buildSubject(type, jobId),
        job_id: jobId,
        tenant_id: tenantId,
        notification_type: type,
        payload,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Backend email endpoint returned ${res.status}: ${errText}`);
    }

    return { channel: "email", sent: true };
  } catch (err) {
    console.error(`[send-notification] job_id=${jobId}: Email send failed —`, err);
    return { channel: "email", sent: false, error: String(err) };
  }
}

async function sendSms(
  jobId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
  toPhone: string,
): Promise<ChannelResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { channel: "sms", sent: false, error: "Twilio credentials not configured" };
  }

  const body = buildSubject(type, jobId) +
    (payload.estimated_leak_cents !== undefined
      ? ` — Estimated leak: $${((payload.estimated_leak_cents as number) / 100).toFixed(2)}`
      : "");

  try {
    // Twilio Messages API uses application/x-www-form-urlencoded
    const params = new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM_NUMBER,
      Body: body,
    });

    const twilioUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const res = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`Twilio returned ${res.status}: ${errJson.message ?? res.statusText}`);
    }

    return { channel: "sms", sent: true };
  } catch (err) {
    console.error(`[send-notification] job_id=${jobId}: SMS send failed —`, err);
    return { channel: "sms", sent: false, error: String(err) };
  }
}

async function sendSlack(
  jobId: string,
  tenantId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
): Promise<ChannelResult> {
  if (!SLACK_WEBHOOK_URL) {
    return { channel: "slack", sent: false, error: "SLACK_WEBHOOK_URL not configured" };
  }

  try {
    const blocks = buildSlackBlocks(type, jobId, tenantId, payload);

    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Slack webhook returned ${res.status}: ${errText}`);
    }

    return { channel: "slack", sent: true };
  } catch (err) {
    console.error(`[send-notification] job_id=${jobId}: Slack send failed —`, err);
    return { channel: "slack", sent: false, error: String(err) };
  }
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

  const { tenant_id, job_id, notification_type, payload = {} } = body;

  if (!tenant_id || !job_id || !notification_type) {
    return new Response(
      JSON.stringify({ error: "tenant_id, job_id, and notification_type are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const validTypes: NotificationType[] = ["revenue_leak", "job_approved", "reconciliation_complete"];
  if (!validTypes.includes(notification_type)) {
    return new Response(
      JSON.stringify({ error: `notification_type must be one of: ${validTypes.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Fetch user notification prefs (owner of this tenant) ───────────────
  const { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select(
      "email_alerts, sms_alerts, slack_alerts, alert_threshold_cents, email, phone",
    )
    .eq("tenant_id", tenant_id)
    .eq("role", "owner")          // notify the tenant owner
    .single();

  if (userErr || !user) {
    console.error(
      `[send-notification] job_id=${job_id}: Could not fetch user prefs —`,
      userErr,
    );
    return new Response(
      JSON.stringify({ error: "Could not load user notification preferences" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const prefs = user as UserNotificationPrefs;

  // ── 3. Threshold check — skip all channels if below threshold ────────────
  const estimatedLeakCents = typeof payload.estimated_leak_cents === "number"
    ? payload.estimated_leak_cents
    : null;

  const threshold = prefs.alert_threshold_cents ?? 0;

  // Only apply threshold check when a leak amount is present (revenue_leak events).
  // Other notification types (job_approved, reconciliation_complete) bypass the check.
  if (
    notification_type === "revenue_leak" &&
    estimatedLeakCents !== null &&
    estimatedLeakCents < threshold
  ) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: `estimated_leak_cents (${estimatedLeakCents}) below threshold (${threshold})`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── 4. Fan out to each enabled channel independently ─────────────────────
  const results: ChannelResult[] = [];
  const channelPromises: Promise<ChannelResult>[] = [];

  if (prefs.email_alerts && prefs.email) {
    channelPromises.push(
      sendEmail(job_id, tenant_id, notification_type, payload, prefs.email),
    );
  }

  if (prefs.sms_alerts && prefs.phone) {
    channelPromises.push(
      sendSms(job_id, notification_type, payload, prefs.phone),
    );
  }

  if (prefs.slack_alerts) {
    channelPromises.push(
      sendSlack(job_id, tenant_id, notification_type, payload),
    );
  }

  // Run all channels concurrently; individual failures are already captured
  // inside each helper and do not throw — so Promise.all is safe here.
  const settled = await Promise.all(channelPromises);
  results.push(...settled);

  if (results.length === 0) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: "No notification channels enabled or recipient info missing",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sentCount = results.filter((r) => r.sent).length;
  const failedCount = results.filter((r) => !r.sent).length;

  return new Response(
    JSON.stringify({
      success: sentCount > 0,
      job_id,
      sent_channels: results.filter((r) => r.sent).map((r) => r.channel),
      failed_channels: results.filter((r) => !r.sent).map((r) => ({
        channel: r.channel,
        error: r.error,
      })),
      summary: `${sentCount} sent, ${failedCount} failed`,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
