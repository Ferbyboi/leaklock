/**
 * schema_validator.ts
 *
 * Zod validation schema for all LeakLock niche compliance JSON files.
 * Validates all 5 niche schemas at module load — throws ZodError if any
 * file is missing a required field or has a type mismatch.
 *
 * Usage:
 *   import { validateNicheSchema, NicheSchema } from "./schema_validator";
 *   const schema = validateNicheSchema(rawJson);
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const DailyCheckZ = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  frequency: z.string().min(1),
});

const AlertThresholdsZ = z.object({
  critical: z.array(z.string()),
  warning: z.array(z.string()),
  info: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Main niche schema shape
// ---------------------------------------------------------------------------

export const NicheSchemaZ = z.object({
  tenant_type: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver"),
  regulatory_source: z.string().min(1),
  ai_system_prompt: z.string().min(1),
  photo_analysis_prompt: z.string().min(1),
  validation_rules: z.record(z.unknown()).refine(
    (rules) => typeof rules === "object" && rules !== null,
    "validation_rules must be a non-null object"
  ),
  alert_thresholds: AlertThresholdsZ,
  required_daily_checks: z.array(DailyCheckZ).min(1),
});

export type NicheSchema = z.infer<typeof NicheSchemaZ>;

// ---------------------------------------------------------------------------
// Base compliance schema (separate — merged universally, not a niche schema)
// ---------------------------------------------------------------------------

export const BaseComplianceZ = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  required_fields: z.array(z.string()).min(1),
  audit_log_required: z.literal(true),
  timestamp_format: z.string().min(1),
  data_retention_years: z.number().positive(),
});

export type BaseCompliance = z.infer<typeof BaseComplianceZ>;

// ---------------------------------------------------------------------------
// Public validator function
// ---------------------------------------------------------------------------

/**
 * Parse and validate an unknown value against the NicheSchemaZ shape.
 * Throws a ZodError with full path context on any validation failure.
 */
export function validateNicheSchema(schema: unknown): NicheSchema {
  return NicheSchemaZ.parse(schema);
}

/**
 * Parse and validate the base_compliance.json shape.
 * Throws a ZodError on any validation failure.
 */
export function validateBaseCompliance(schema: unknown): BaseCompliance {
  return BaseComplianceZ.parse(schema);
}

// ---------------------------------------------------------------------------
// Module-load validation — runs when this file is first imported
// ---------------------------------------------------------------------------

const SCHEMA_DIR = path.resolve(__dirname);

const NICHE_FILES: string[] = [
  "restaurant_health.json",
  "hvac_compliance.json",
  "tree_safety.json",
  "landscaping_epa.json",
  "barber_sanitation.json",
];

function loadAndValidateAll(): void {
  // Validate base_compliance first
  const basePath = path.join(SCHEMA_DIR, "base_compliance.json");
  if (!fs.existsSync(basePath)) {
    throw new Error(
      `[schema_validator] base_compliance.json not found at ${basePath}`
    );
  }
  const baseRaw = JSON.parse(fs.readFileSync(basePath, "utf-8")) as unknown;
  try {
    validateBaseCompliance(baseRaw);
  } catch (err) {
    throw new Error(
      `[schema_validator] base_compliance.json failed validation: ${String(err)}`
    );
  }

  // Validate each niche schema
  for (const filename of NICHE_FILES) {
    const filePath = path.join(SCHEMA_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `[schema_validator] Required niche schema file not found: ${filePath}`
      );
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    try {
      validateNicheSchema(raw);
    } catch (err) {
      throw new Error(
        `[schema_validator] ${filename} failed validation: ${String(err)}`
      );
    }
  }

  console.log(
    `[schema_validator] All ${NICHE_FILES.length} niche schemas + base_compliance validated successfully.`
  );
}

// Execute at import time — any missing field or wrong type throws immediately,
// preventing the parsing pipeline from starting with a broken schema set.
loadAndValidateAll();
