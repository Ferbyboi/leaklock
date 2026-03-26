/**
 * evaluate-compliance Edge Function
 *
 * Receives a field_event_id + transcript (and optional photo_url).
 * Loads the tenant's niche schema, sends to Claude claude-sonnet-4-6 for structured
 * compliance evaluation, writes parsed_data + compliance_status back to
 * field_events, and inserts an alert if violations are found.
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL          (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface ComplianceResult {
  status: "pass" | "warning" | "fail";
  violations: Array<{ rule: string; detail: string; severity: "critical" | "warning" }>;
  parsed_items: Array<{ name: string; value: string | number; unit?: string }>;
  summary: string;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: {
    field_event_id: string;
    transcript?: string;
    photo_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { field_event_id, transcript, photo_url } = body;
  if (!field_event_id) {
    return new Response(JSON.stringify({ error: "field_event_id required" }), { status: 400 });
  }

  // ── 1. Load field_event + tenant info ─────────────────────────────────────
  const { data: event, error: fetchErr } = await sb
    .from("field_events")
    .select("tenant_id, niche_type, transcript, job_id")
    .eq("id", field_event_id)
    .single();

  if (fetchErr || !event) {
    return new Response(JSON.stringify({ error: "Event not found" }), { status: 404 });
  }

  // ── 2. Load tenant niche type ──────────────────────────────────────────────
  const { data: tenant } = await sb
    .from("tenants")
    .select("tenant_type")
    .eq("id", event.tenant_id)
    .single();

  const nicheType = event.niche_type ?? tenant?.tenant_type ?? "generic";
  const text = transcript ?? event.transcript ?? "";

  if (!text && !photo_url) {
    await sb
      .from("field_events")
      .update({ compliance_status: "pending" })
      .eq("id", field_event_id);
    return new Response(JSON.stringify({ skipped: "no content" }), { status: 200 });
  }

  // ── 3. Build niche-aware system prompt ────────────────────────────────────
  const systemPrompt = buildSystemPrompt(nicheType);

  // ── 4. Call Claude claude-sonnet-4-6 ─────────────────────────────────────────────
  let result: ComplianceResult;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: text
            ? `Field note transcript:\n\n${text}`
            : `Analyze the field photo at: ${photo_url}`,
        },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response
    const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) ?? raw.match(/(\{[\s\S]*\})/);
    result = jsonMatch ? JSON.parse(jsonMatch[1]) : {
      status: "pass",
      violations: [],
      parsed_items: [],
      summary: raw.slice(0, 200),
    };
  } catch (err) {
    console.error("Claude evaluation failed:", err);
    await sb
      .from("field_events")
      .update({ compliance_status: "fail", parsed_data: { error: String(err) } })
      .eq("id", field_event_id);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }

  // ── 5. Write results back ──────────────────────────────────────────────────
  await sb
    .from("field_events")
    .update({
      compliance_status: result.status,
      parsed_data: result,
    })
    .eq("id", field_event_id);

  // ── 6. Insert alerts for violations ───────────────────────────────────────
  for (const violation of result.violations) {
    await sb.from("alerts").insert({
      tenant_id: event.tenant_id,
      job_id: event.job_id,
      field_event_id,
      severity: violation.severity,
      alert_type: "compliance_violation",
      title: violation.rule,
      body: violation.detail,
    });
  }

  return new Response(
    JSON.stringify({ success: true, status: result.status, violations: result.violations.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});

function buildSystemPrompt(nicheType: string): string {
  const rules: Record<string, string> = {
    restaurant: `You evaluate food safety compliance per FDA Food Code.
Key rules: cold holding ≤ 41°F, hot holding ≥ 135°F, grease trap fill ≤ 25%.
Extract temperatures, equipment status, and sanitation observations.`,
    hvac: `You evaluate HVAC compliance per EPA 40 CFR Part 82 refrigerant regulations.
Key rules: commercial leak rate ≤ 20%, industrial ≤ 30%, record refrigerant type and charge amount.`,
    tree_service: `You evaluate arborist field safety per OSHA 1910.269 and ANSI Z133.1.
Key rules: 10ft minimum from power lines, PPE worn (hardhat, eye protection, chainsaw chaps).`,
    landscaping: `You evaluate landscaping compliance per EPA FIFRA pesticide regulations.
Key rules: wind speed ≤ 15 mph for spraying, 50ft buffer from water bodies, record chemical + rate.`,
    barber: `You evaluate barbershop sanitation per state cosmetology board rules.
Key rules: tools sanitized ≥ 600 seconds contact time, client waivers for chemical services.`,
  };

  const nicheRules = rules[nicheType] ?? "Evaluate general field safety and work quality compliance.";

  return `You are a compliance evaluation engine. Analyze field notes or photos and output structured JSON.

${nicheRules}

Always respond with valid JSON in this exact schema:
\`\`\`json
{
  "status": "pass" | "warning" | "fail",
  "violations": [
    { "rule": "rule name", "detail": "specific finding", "severity": "critical" | "warning" }
  ],
  "parsed_items": [
    { "name": "item name", "value": "measured value", "unit": "optional unit" }
  ],
  "summary": "one sentence summary"
}
\`\`\`

Be precise. Only flag actual violations based on specific numbers or observations in the notes.`;
}
