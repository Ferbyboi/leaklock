-- Migration 027: Demo / test seed data
-- ─────────────────────────────────────────────────────────────────────────────
-- Safe to run multiple times — every INSERT uses ON CONFLICT DO NOTHING.
-- All rows belong to the fixed demo tenant:
--   tenant_id = '00000000-0000-0000-0000-000000000001'
--
-- Covers:
--   • 1  tenant  (plan = 'pro')
--   • 1  client
--   • 5  jobs    (varied statuses)
--   • 5  field_notes  (one per job, parse_status = 'complete')
--   • 5  draft_invoices (2 with missing line items to trigger discrepancies)
--   • 5  estimates
--   • 3  reconciliation_results (2 discrepancy, 1 clean)
--   • 2  alerts (1 critical, 1 warning — linked to the discrepancy jobs)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Demo tenant ───────────────────────────────────────────────────────────
INSERT INTO tenants (
    id,
    name,
    plan,
    subscription_status,
    tenant_type,
    seat_limit,
    onboarding_complete,
    created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Demo Plumbing Co.',
    'pro',
    'active',
    'plumbing',
    5,
    true,
    now() - interval '30 days'
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Demo client ───────────────────────────────────────────────────────────
INSERT INTO clients (id, tenant_id, name, address, crm_id)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'Acme Properties LLC',
    '742 Evergreen Terrace, Springfield, IL 62701',
    'crm-client-demo-001'
)
ON CONFLICT (id) DO NOTHING;


-- ── 3. Jobs ──────────────────────────────────────────────────────────────────
-- job-001: pending, unreviewed
INSERT INTO jobs (id, tenant_id, client_id, crm_job_id, status, match_status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'crm-job-demo-001',
    'pending_invoice',
    'unreviewed',
    now() - interval '10 days'
)
ON CONFLICT (id) DO NOTHING;

-- job-002: pending, discrepancy flagged — will get a critical alert
INSERT INTO jobs (id, tenant_id, client_id, crm_job_id, status, match_status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'crm-job-demo-002',
    'pending_invoice',
    'discrepancy',
    now() - interval '8 days'
)
ON CONFLICT (id) DO NOTHING;

-- job-003: approved by auditor, discrepancy previously flagged — warning alert
INSERT INTO jobs (id, tenant_id, client_id, crm_job_id, status, match_status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'crm-job-demo-003',
    'approved',
    'discrepancy',
    now() - interval '6 days'
)
ON CONFLICT (id) DO NOTHING;

-- job-004: fully reconciled, clean match
INSERT INTO jobs (id, tenant_id, client_id, crm_job_id, status, match_status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'crm-job-demo-004',
    'reconciled',
    'clean',
    now() - interval '4 days'
)
ON CONFLICT (id) DO NOTHING;

-- job-005: pending, field notes not yet processed
INSERT INTO jobs (id, tenant_id, client_id, crm_job_id, status, match_status, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'crm-job-demo-005',
    'pending_invoice',
    'unreviewed',
    now() - interval '1 day'
)
ON CONFLICT (id) DO NOTHING;


-- ── 4. Field notes (Input B — The Reality) ───────────────────────────────────
INSERT INTO field_notes (id, tenant_id, job_id, raw_text, parsed_items, parse_status, parsed_at)
VALUES (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    'Replaced main shutoff valve, installed new pressure regulator, snaked main drain.',
    '[
      {"item": "Main shutoff valve replacement", "qty": 1, "unit_price_cents": 18500, "confidence": 0.97},
      {"item": "Pressure regulator installation", "qty": 1, "unit_price_cents": 22000, "confidence": 0.95},
      {"item": "Main drain snake", "qty": 1, "unit_price_cents": 9500, "confidence": 0.99}
    ]'::jsonb,
    'complete',
    now() - interval '10 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO field_notes (id, tenant_id, job_id, raw_text, parsed_items, parse_status, parsed_at)
VALUES (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    'Fixed two leaking under-sink supply lines, replaced garbage disposal, added expansion tank.',
    '[
      {"item": "Under-sink supply line repair (x2)", "qty": 2, "unit_price_cents": 7500, "confidence": 0.98},
      {"item": "Garbage disposal replacement", "qty": 1, "unit_price_cents": 34500, "confidence": 0.96},
      {"item": "Expansion tank installation", "qty": 1, "unit_price_cents": 28000, "confidence": 0.94}
    ]'::jsonb,
    'complete',
    now() - interval '8 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO field_notes (id, tenant_id, job_id, raw_text, parsed_items, parse_status, parsed_at)
VALUES (
    '00000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000103',
    'Water heater flush and anode rod replacement. Also rodded floor drain.',
    '[
      {"item": "Water heater flush", "qty": 1, "unit_price_cents": 12500, "confidence": 0.99},
      {"item": "Anode rod replacement", "qty": 1, "unit_price_cents": 8500, "confidence": 0.97},
      {"item": "Floor drain rodding", "qty": 1, "unit_price_cents": 11000, "confidence": 0.95}
    ]'::jsonb,
    'complete',
    now() - interval '6 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO field_notes (id, tenant_id, job_id, raw_text, parsed_items, parse_status, parsed_at)
VALUES (
    '00000000-0000-0000-0000-000000000204',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    'Replaced kitchen faucet and both shut-off valves under sink.',
    '[
      {"item": "Kitchen faucet replacement", "qty": 1, "unit_price_cents": 21500, "confidence": 0.98},
      {"item": "Under-sink shut-off valve replacement (x2)", "qty": 2, "unit_price_cents": 9500, "confidence": 0.99}
    ]'::jsonb,
    'complete',
    now() - interval '4 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO field_notes (id, tenant_id, job_id, raw_text, parsed_items, parse_status, parsed_at)
VALUES (
    '00000000-0000-0000-0000-000000000205',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000105',
    'Unclogged bathroom drain, replaced wax ring on toilet, tightened supply line.',
    '[
      {"item": "Bathroom drain unclog", "qty": 1, "unit_price_cents": 8500, "confidence": 0.99},
      {"item": "Toilet wax ring replacement", "qty": 1, "unit_price_cents": 13500, "confidence": 0.97},
      {"item": "Supply line tighten / reseal", "qty": 1, "unit_price_cents": 4500, "confidence": 0.92}
    ]'::jsonb,
    'complete',
    now() - interval '1 day'
)
ON CONFLICT (id) DO NOTHING;


-- ── 5. Estimates (Input A — The Promise) ─────────────────────────────────────
INSERT INTO estimates (id, tenant_id, job_id, line_items, total_cents)
VALUES (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    '[
      {"description": "Main shutoff valve replacement", "qty": 1, "unit_price_cents": 18500},
      {"description": "Pressure regulator installation",  "qty": 1, "unit_price_cents": 22000},
      {"description": "Main drain snake",                 "qty": 1, "unit_price_cents": 9500}
    ]'::jsonb,
    50000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO estimates (id, tenant_id, job_id, line_items, total_cents)
VALUES (
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    '[
      {"description": "Under-sink supply line repair (x2)", "qty": 2, "unit_price_cents": 7500},
      {"description": "Garbage disposal replacement",       "qty": 1, "unit_price_cents": 34500},
      {"description": "Expansion tank installation",        "qty": 1, "unit_price_cents": 28000}
    ]'::jsonb,
    77500
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO estimates (id, tenant_id, job_id, line_items, total_cents)
VALUES (
    '00000000-0000-0000-0000-000000000303',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000103',
    '[
      {"description": "Water heater flush",   "qty": 1, "unit_price_cents": 12500},
      {"description": "Anode rod replacement","qty": 1, "unit_price_cents": 8500},
      {"description": "Floor drain rodding",  "qty": 1, "unit_price_cents": 11000}
    ]'::jsonb,
    32000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO estimates (id, tenant_id, job_id, line_items, total_cents)
VALUES (
    '00000000-0000-0000-0000-000000000304',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    '[
      {"description": "Kitchen faucet replacement",                   "qty": 1, "unit_price_cents": 21500},
      {"description": "Under-sink shut-off valve replacement (x2)",   "qty": 2, "unit_price_cents": 9500}
    ]'::jsonb,
    40500
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO estimates (id, tenant_id, job_id, line_items, total_cents)
VALUES (
    '00000000-0000-0000-0000-000000000305',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000105',
    '[
      {"description": "Bathroom drain unclog",            "qty": 1, "unit_price_cents": 8500},
      {"description": "Toilet wax ring replacement",      "qty": 1, "unit_price_cents": 13500},
      {"description": "Supply line tighten / reseal",     "qty": 1, "unit_price_cents": 4500}
    ]'::jsonb,
    26500
)
ON CONFLICT (id) DO NOTHING;


-- ── 6. Draft invoices (Input C — The Bill) ───────────────────────────────────
-- job-101: missing "Main drain snake" → revenue leak
INSERT INTO draft_invoices (id, tenant_id, job_id, line_items, total_cents, crm_invoice_id)
VALUES (
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    '[
      {"description": "Main shutoff valve replacement", "qty": 1, "unit_price_cents": 18500},
      {"description": "Pressure regulator installation","qty": 1, "unit_price_cents": 22000}
    ]'::jsonb,
    40500,
    'inv-demo-001'
)
ON CONFLICT (id) DO NOTHING;

-- job-102: missing "Expansion tank installation" → revenue leak
INSERT INTO draft_invoices (id, tenant_id, job_id, line_items, total_cents, crm_invoice_id)
VALUES (
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    '[
      {"description": "Under-sink supply line repair (x2)", "qty": 2, "unit_price_cents": 7500},
      {"description": "Garbage disposal replacement",       "qty": 1, "unit_price_cents": 34500}
    ]'::jsonb,
    49500,
    'inv-demo-002'
)
ON CONFLICT (id) DO NOTHING;

-- job-103: billed correctly (all three items present)
INSERT INTO draft_invoices (id, tenant_id, job_id, line_items, total_cents, crm_invoice_id)
VALUES (
    '00000000-0000-0000-0000-000000000403',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000103',
    '[
      {"description": "Water heater flush",   "qty": 1, "unit_price_cents": 12500},
      {"description": "Anode rod replacement","qty": 1, "unit_price_cents": 8500},
      {"description": "Floor drain rodding",  "qty": 1, "unit_price_cents": 11000}
    ]'::jsonb,
    32000,
    'inv-demo-003'
)
ON CONFLICT (id) DO NOTHING;

-- job-104: billed correctly (clean match)
INSERT INTO draft_invoices (id, tenant_id, job_id, line_items, total_cents, crm_invoice_id)
VALUES (
    '00000000-0000-0000-0000-000000000404',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    '[
      {"description": "Kitchen faucet replacement",                  "qty": 1, "unit_price_cents": 21500},
      {"description": "Under-sink shut-off valve replacement (x2)",  "qty": 2, "unit_price_cents": 9500}
    ]'::jsonb,
    40500,
    'inv-demo-004'
)
ON CONFLICT (id) DO NOTHING;

-- job-105: no draft invoice yet (field notes still fresh)
-- intentionally omitted to simulate a job with no invoice created yet


-- ── 7. Reconciliation results ─────────────────────────────────────────────────
-- result-001: discrepancy on job-101 ("Main drain snake" not billed)
INSERT INTO reconciliation_results (
    id, tenant_id, job_id, run_at, status,
    missing_items, extra_items, estimated_leak_cents,
    auditor_action, auditor_id, reviewed_at
)
VALUES (
    '00000000-0000-0000-0000-000000000501',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    now() - interval '10 days',
    'discrepancy',
    '[{"item": "Main drain snake", "qty": 1, "unit_price_cents": 9500}]'::jsonb,
    '[]'::jsonb,
    9500,
    null,
    null,
    null
)
ON CONFLICT (id) DO NOTHING;

-- result-002: discrepancy on job-102 ("Expansion tank installation" not billed)
INSERT INTO reconciliation_results (
    id, tenant_id, job_id, run_at, status,
    missing_items, extra_items, estimated_leak_cents,
    auditor_action, auditor_id, reviewed_at
)
VALUES (
    '00000000-0000-0000-0000-000000000502',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    now() - interval '8 days',
    'discrepancy',
    '[{"item": "Expansion tank installation", "qty": 1, "unit_price_cents": 28000}]'::jsonb,
    '[]'::jsonb,
    28000,
    null,
    null,
    null
)
ON CONFLICT (id) DO NOTHING;

-- result-003: clean match on job-104
INSERT INTO reconciliation_results (
    id, tenant_id, job_id, run_at, status,
    missing_items, extra_items, estimated_leak_cents,
    auditor_action, auditor_id, reviewed_at
)
VALUES (
    '00000000-0000-0000-0000-000000000503',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000104',
    now() - interval '4 days',
    'clean',
    '[]'::jsonb,
    '[]'::jsonb,
    0,
    null,
    null,
    null
)
ON CONFLICT (id) DO NOTHING;


-- ── 8. Alerts ─────────────────────────────────────────────────────────────────
-- alert-001: critical — job-101, large underbilling ($95 drain snake)
INSERT INTO alerts (
    id, tenant_id, job_id,
    severity, alert_type,
    title, body,
    metadata,
    created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000601',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    'critical',
    'revenue_leak',
    'Revenue Leak Detected — Job #crm-job-demo-001',
    'The draft invoice is missing "Main drain snake" ($95.00). Estimated unbilled revenue: $95.00. Invoice is on hold pending auditor review.',
    '{"estimated_leak_cents": 9500, "missing_items": ["Main drain snake"], "reconciliation_result_id": "00000000-0000-0000-0000-000000000501"}'::jsonb,
    now() - interval '10 days'
)
ON CONFLICT (id) DO NOTHING;

-- alert-002: warning — job-102, expansion tank not billed ($280)
INSERT INTO alerts (
    id, tenant_id, job_id,
    severity, alert_type,
    title, body,
    metadata,
    created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000602',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000102',
    'warning',
    'revenue_leak',
    'Revenue Leak Detected — Job #crm-job-demo-002',
    'The draft invoice is missing "Expansion tank installation" ($280.00). Estimated unbilled revenue: $280.00. Invoice is on hold pending auditor review.',
    '{"estimated_leak_cents": 28000, "missing_items": ["Expansion tank installation"], "reconciliation_result_id": "00000000-0000-0000-0000-000000000502"}'::jsonb,
    now() - interval '8 days'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
