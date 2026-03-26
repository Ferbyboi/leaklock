/**
 * Zod validators for niche compliance schemas (Task 14).
 * Validates each niche JSON structure at startup to catch drift early.
 */
import { z } from "zod";

// ── Base schema that all niches must satisfy ───────────────────────────────────

export const AlertThresholdsSchema = z.object({
  critical: z.array(z.string()).min(1),
  warning:  z.array(z.string()),
  info:     z.array(z.string()),
});

export const NicheSchemaValidator = z.object({
  tenant_type:            z.string().min(1),
  version:                z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver"),
  regulatory_source:      z.string().min(5),
  ai_system_prompt:       z.string().min(50),
  photo_analysis_prompt:  z.string().min(30),
  validation_rules:       z.record(z.string(), z.unknown()).refine(
    (r) => Object.keys(r).length > 0,
    "validation_rules must have at least one entry"
  ),
  alert_thresholds:       AlertThresholdsSchema,
  required_daily_checks:  z.array(z.string()).min(1),
  retention_years:        z.number().int().positive(),
});

export type NicheSchema = z.infer<typeof NicheSchemaValidator>;

// ── Restaurant-specific validation rules ──────────────────────────────────────

export const RestaurantValidationRulesSchema = z.object({
  chicken_min_internal_f:       z.number(),
  ground_beef_min_internal_f:   z.number(),
  fish_min_internal_f:          z.number(),
  cold_holding_max_f:           z.number().max(41),
  hot_holding_min_f:            z.number().min(135),
  reheating_min_f:              z.number(),
  grease_trap_max_fill_pct:     z.number().max(25),
  sanitizer_chlorine_min_ppm:   z.number(),
  sanitizer_chlorine_max_ppm:   z.number(),
}).passthrough();

// ── HVAC-specific ─────────────────────────────────────────────────────────────

export const HVACValidationRulesSchema = z.object({
  commercial_refrig_leak_threshold_pct:   z.number(),
  industrial_process_leak_threshold_pct:  z.number(),
  comfort_cooling_leak_threshold_pct:     z.number(),
  record_retention_years:                 z.number().int().min(3),
}).passthrough();

// ── Parsed field event output schemas (used in voice pipeline) ────────────────

export const ParsedRestaurantItemSchema = z.object({
  name:           z.string(),
  temp_f:         z.number(),
  zone:           z.enum(["safe", "danger"]),
  asset_location: z.string().optional(),
});

export const ParsedHVACDataSchema = z.object({
  refrigerant_type: z.string(),
  qty_lbs:          z.number().nonnegative(),
  action:           z.enum(["added", "recovered"]),
  tech_epa_cert:    z.string().optional(),
  pressure_psi:     z.number().optional(),
  asset_id:         z.string().optional(),
  leak_rate_pct:    z.number().optional(),
  work_performed:   z.string().optional(),
});

export const ParsedTreeSafetyDataSchema = z.object({
  safety: z.object({
    tie_off:              z.boolean(),
    ground_zone_cleared:  z.boolean(),
    ppe_confirmed:        z.boolean(),
    power_line_proximity_ft: z.number().nullable().optional(),
  }),
  work: z.object({
    description:  z.string(),
    equipment:    z.array(z.string()),
    tree_species: z.string().nullable().optional(),
  }),
  tech_name: z.string().nullable().optional(),
});

export const ParsedChemicalApplicationSchema = z.object({
  product:        z.string(),
  epa_reg_number: z.string().optional(),
  qty:            z.number().nonnegative(),
  unit:           z.string(),
  dilution_ratio: z.string().optional(),
  method:         z.enum(["spray", "granular", "drip", "broadcast"]).optional(),
  zone:           z.string().optional(),
  weather:        z.object({
    temp_f:        z.number().optional(),
    wind_mph:      z.number().optional(),
    humidity_pct:  z.number().optional(),
    precipitation: z.boolean().optional(),
  }).optional(),
  applied_at:       z.string().optional(),
  applicator_cert:  z.string().optional(),
});

export const ParsedSalonDataSchema = z.object({
  type:           z.enum(["sanitation", "formula", "treatment"]),
  station_number: z.string().nullable().optional(),
  stylist_name:   z.string().nullable().optional(),
  client_name:    z.string().nullable().optional(),
  requires_waiver: z.boolean(),
  treatment_data: z.object({
    products:          z.array(z.string()),
    ratios:            z.array(z.string()),
    processing_time_min: z.number().nullable().optional(),
    developer_volume:  z.string().nullable().optional(),
  }).nullable().optional(),
  sanitation_data: z.object({
    method:           z.string(),
    product:          z.string(),
    contact_time_sec: z.number().nullable().optional(),
  }).nullable().optional(),
});

// ── Validate all schemas at module load (startup check) ───────────────────────

export function validateNicheSchema(raw: unknown): NicheSchema {
  return NicheSchemaValidator.parse(raw);
}
