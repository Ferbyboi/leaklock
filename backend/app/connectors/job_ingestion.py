"""Shared job ingestion helper used by all CRM webhook connectors.

Upserts a job, field notes, and draft invoice line items from a normalized
webhook payload. All DB writes include tenant_id for RLS compliance.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def ingest_normalized_job(normalized: dict, db) -> str:
    """Upsert job + field notes + draft invoice from a normalized payload.

    Returns the internal job UUID.  All DB writes include tenant_id.
    """
    tenant_id = normalized["tenant_id"]
    crm_job_id = normalized["crm_job_id"]

    job_result = (
        db.table("jobs")
        .upsert(
            {
                "tenant_id": tenant_id,
                "crm_job_id": crm_job_id,
                "status": normalized["status"],
            },
            on_conflict="tenant_id,crm_job_id",
        )
        .execute()
    )
    job_id: Optional[str] = (job_result.data or [{}])[0].get("id")
    if not job_id:
        raise RuntimeError(
            f"Failed to upsert job {crm_job_id} for tenant {tenant_id}"
        )

    # Field notes — use customer/address/technician as context
    tech_notes = (
        f"Technician: {normalized['technician_name']}\n"
        f"Address: {normalized['address']}\n"
        f"Customer: {normalized['customer_name']}"
    ).strip()

    db.table("field_notes").upsert(
        {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "raw_text": tech_notes,
            "photo_urls": [],
            "parse_status": "pending",
        },
        on_conflict="tenant_id,job_id",
    ).execute()

    # Draft invoice from line items
    if normalized["line_items"]:
        internal_items = [
            {
                "description": item["description"],
                "qty": item["quantity"],
                "unit_price_cents": int(item["unit_price"] * 100),
                "unit": "each",
            }
            for item in normalized["line_items"]
        ]
        db.table("draft_invoices").upsert(
            {
                "tenant_id": tenant_id,
                "job_id": job_id,
                "line_items": internal_items,
            },
            on_conflict="tenant_id,job_id",
        ).execute()

    return job_id
