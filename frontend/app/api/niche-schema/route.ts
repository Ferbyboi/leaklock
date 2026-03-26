import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { readFileSync } from "fs";
import { join } from "path";

// ── Hardcoded niche schemas (in-process, zero I/O on hot path) ────────────────
// This mirrors the JSON files under /niche_schemas/ at the repo root.
// required_daily_checks is the key array consumed by the widgets.

interface CheckItem {
  id: string;
  label: string;
  frequency: string;
}

interface NicheSchemaPayload {
  tenant_type: string;
  version: string;
  required_daily_checks: CheckItem[];
}

const INLINE_SCHEMAS: Record<string, NicheSchemaPayload> = {
  restaurant: {
    tenant_type: "restaurant",
    version: "1.0.0",
    required_daily_checks: [
      { id: "line_check",       label: "Line check temps logged",                          frequency: "twice_daily" },
      { id: "walk_in_temps",    label: "Walk-in cooler/freezer temps logged",              frequency: "twice_daily" },
      { id: "handwash_station", label: "Handwash stations stocked and accessible",         frequency: "daily"       },
      { id: "sanitizer_test",   label: "Sanitizer concentration tested and logged",        frequency: "daily"       },
      { id: "date_labels",      label: "All items properly date-labeled",                  frequency: "daily"       },
      { id: "equipment_clean",  label: "Equipment surfaces cleaned and sanitized",         frequency: "daily"       },
    ],
  },
  hvac: {
    tenant_type: "hvac",
    version: "1.0.0",
    required_daily_checks: [
      { id: "equipment_inspection", label: "Visual equipment inspection completed",                  frequency: "daily"       },
      { id: "refrigerant_log",      label: "Refrigerant add/recover logged with EPA cert",           frequency: "per_service" },
      { id: "pressure_test",        label: "Pressure test results logged",                           frequency: "per_service" },
    ],
  },
  plumbing: {
    tenant_type: "plumbing",
    version: "1.0.0",
    required_daily_checks: [
      { id: "equipment_inspection", label: "Equipment and tools inspected",                frequency: "daily"       },
      { id: "pressure_test",        label: "Pressure test results logged",                 frequency: "per_service" },
      { id: "leak_check",           label: "Post-service leak check confirmed",            frequency: "per_service" },
    ],
  },
  tree_service: {
    tenant_type: "tree_service",
    version: "1.0.0",
    required_daily_checks: [
      { id: "safety_briefing",     label: "Daily safety briefing completed",                frequency: "daily"   },
      { id: "ppe_check",           label: "All PPE inspected and worn",                     frequency: "per_job" },
      { id: "power_line_survey",   label: "Power line proximity surveyed",                  frequency: "per_job" },
      { id: "ground_zone",         label: "Ground zone cleared and marked",                 frequency: "per_job" },
      { id: "equipment_inspection",label: "Chainsaw/chipper inspection logged",             frequency: "daily"   },
    ],
  },
  landscaping: {
    tenant_type: "landscaping",
    version: "1.0.0",
    required_daily_checks: [
      { id: "chemical_log",       label: "All chemical applications logged with EPA reg number", frequency: "per_application" },
      { id: "weather_check",      label: "Weather conditions checked before application",        frequency: "per_application" },
      { id: "equipment_rinse",    label: "Sprayer equipment rinsed and logged",                  frequency: "daily"           },
      { id: "irrigation_check",   label: "Irrigation system pressure checked",                   frequency: "weekly"          },
    ],
  },
  barber: {
    tenant_type: "barber",
    version: "1.0.0",
    required_daily_checks: [
      { id: "station_sanitation",   label: "All stations sanitized and logged",                         frequency: "per_client"          },
      { id: "implement_disinfection",label: "Implements in EPA disinfectant between clients",            frequency: "per_client"          },
      { id: "chemical_inventory",   label: "Chemical inventory checked and stored properly",            frequency: "daily"               },
      { id: "waiver_queue",         label: "All chemical treatment waivers signed before service",      frequency: "per_chemical_service" },
    ],
  },
  salon: {
    tenant_type: "salon",
    version: "1.0.0",
    required_daily_checks: [
      { id: "station_sanitation",   label: "All stations sanitized and logged",                         frequency: "per_client"          },
      { id: "implement_disinfection",label: "Implements in EPA disinfectant between clients",            frequency: "per_client"          },
      { id: "chemical_inventory",   label: "Chemical inventory checked and stored properly",            frequency: "daily"               },
      { id: "waiver_queue",         label: "All chemical treatment waivers signed before service",      frequency: "per_chemical_service" },
    ],
  },
};

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Auth check
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = req.nextUrl.searchParams.get("tenant_id");
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  // Fetch tenant_type from DB (tenant_id in the query is already filtered by RLS)
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("tenant_type")
    .eq("id", tenantId)
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const tenantType = tenant.tenant_type as string;

  // 1. Try inline schema first (fast, no filesystem I/O)
  if (INLINE_SCHEMAS[tenantType]) {
    return NextResponse.json(INLINE_SCHEMAS[tenantType]);
  }

  // 2. Fall back to reading JSON files from the repo root /niche_schemas/
  //    (Only reached if a new niche is added to the DB before the inline map is updated)
  const SCHEMA_FILE_MAP: Record<string, string> = {
    restaurant:   "restaurant_health.json",
    hvac:         "hvac_compliance.json",
    tree_service: "tree_safety.json",
    landscaping:  "landscaping_epa.json",
    barber:       "barber_sanitation.json",
    salon:        "barber_sanitation.json",
  };

  const filename = SCHEMA_FILE_MAP[tenantType];
  if (filename) {
    try {
      // process.cwd() in Next.js App Router is the project root
      const filePath = join(process.cwd(), "..", "niche_schemas", filename);
      const raw = readFileSync(filePath, "utf-8");
      return NextResponse.json(JSON.parse(raw));
    } catch {
      // File not found / parse error
    }
  }

  return NextResponse.json(
    { error: `No schema found for tenant_type: ${tenantType}` },
    { status: 404 },
  );
}
