"""PDF Audit Report generation endpoint.

Generates a compliance audit PDF for a job, including:
  - Job summary and client info
  - Field notes and photos
  - Three-way match results with missing items
  - Compliance violations from field events
  - Auditor notes and decision

Uses reportlab for PDF generation.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import sentry_sdk
from fastapi import APIRouter, HTTPException, Security
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.auth import get_supabase, require_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"])

# ── Styles ────────────────────────────────────────────────────────────────────

_styles = getSampleStyleSheet()

_TITLE = ParagraphStyle(
    "Title",
    parent=_styles["Heading1"],
    fontSize=18,
    spaceAfter=6,
    textColor=colors.HexColor("#111827"),
)
_H2 = ParagraphStyle(
    "H2",
    parent=_styles["Heading2"],
    fontSize=12,
    spaceBefore=12,
    spaceAfter=4,
    textColor=colors.HexColor("#374151"),
)
_BODY = ParagraphStyle(
    "Body",
    parent=_styles["Normal"],
    fontSize=10,
    spaceAfter=3,
    textColor=colors.HexColor("#4B5563"),
)
_LABEL = ParagraphStyle(
    "Label",
    parent=_styles["Normal"],
    fontSize=9,
    textColor=colors.HexColor("#9CA3AF"),
)
_ALERT = ParagraphStyle(
    "Alert",
    parent=_styles["Normal"],
    fontSize=10,
    spaceAfter=3,
    textColor=colors.HexColor("#DC2626"),
)


def _fmt_cents(cents: int) -> str:
    return f"${cents / 100:,.2f}"


# ── Shared table style helper ──────────────────────────────────────────────────

def _niche_table(rows: list[list], col_widths: list[float]) -> Table:
    """Build a lightly-styled reportlab Table for niche data rows."""
    t = Table(rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFF6FF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1D4ED8")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFF")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BFDBFE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ── Niche-specific PDF sections ───────────────────────────────────────────────

def add_niche_section(story: list, niche_type: str, job_data: dict) -> None:
    """Append niche-specific reportlab flowables to *story*.

    Each niche renders a labelled section heading plus one or more tables
    populated from job_data keys that the respective field-note parser
    extracts (e.g. hood_inspection, refrigerant_log, tree_inventory …).
    Falls back to placeholder rows when the data key is absent so the
    section is always present in the PDF.

    Supported niche_type values:
        restaurant   — hood inspection checklist + temperature log
        hvac         — refrigerant log + pressure readings
        tree_service — tree species/DBH inventory + hazard assessment
        landscaping  — plant species list + irrigation zones
        barber       — service menu items + chemical applications

    Args:
        story:      Mutable list of reportlab flowables (modified in-place).
        niche_type: Lowercase string identifying the business niche.
        job_data:   The job dict fetched from Supabase (may contain niche keys).
    """
    niche_type = (niche_type or "").strip().lower()

    if niche_type == "restaurant":
        story.append(Paragraph("Restaurant — Hood Inspection & Temperature Log", _H2))

        # ── Hood inspection checklist ─────────────────────────────────────────
        hood_items = job_data.get("hood_inspection") or []
        hood_rows = [["Inspection Point", "Result", "Technician Notes"]]
        if hood_items:
            for item in hood_items:
                hood_rows.append([
                    item.get("point", "—"),
                    item.get("result", "—"),
                    item.get("notes", ""),
                ])
        else:
            for point in [
                "Grease filter condition",
                "Canopy / plenum cleanliness",
                "Exhaust fan operation",
                "Make-up air balance",
                "Fire suppression system",
            ]:
                hood_rows.append([point, "Not recorded", ""])
        story.append(_niche_table(hood_rows, [2.5 * inch, 1.2 * inch, 2.3 * inch]))
        story.append(Spacer(1, 6))

        # ── Temperature log ───────────────────────────────────────────────────
        temp_rows_src = job_data.get("temperature_log") or []
        temp_rows = [["Location / Equipment", "Temp (°F)", "Time", "Pass/Fail"]]
        if temp_rows_src:
            for entry in temp_rows_src:
                temp_rows.append([
                    entry.get("location", "—"),
                    str(entry.get("temp_f", "—")),
                    entry.get("time", "—"),
                    entry.get("pass_fail", "—"),
                ])
        else:
            for loc in ["Walk-in cooler", "Prep line cooler", "Hot-hold unit", "Dishwasher final rinse"]:
                temp_rows.append([loc, "Not recorded", "—", "—"])
        story.append(Paragraph("Temperature Log", _LABEL))
        story.append(_niche_table(temp_rows, [2.5 * inch, 1.0 * inch, 1.2 * inch, 1.3 * inch]))
        story.append(Spacer(1, 8))

    elif niche_type == "hvac":
        story.append(Paragraph("HVAC — Refrigerant Log & Pressure Readings", _H2))

        # ── Refrigerant log ───────────────────────────────────────────────────
        refrig_items = job_data.get("refrigerant_log") or []
        refrig_rows = [["Refrigerant Type", "Added (oz)", "Recovered (oz)", "Reason"]]
        if refrig_items:
            for entry in refrig_items:
                refrig_rows.append([
                    entry.get("refrigerant_type", "—"),
                    str(entry.get("added_oz", "—")),
                    str(entry.get("recovered_oz", "—")),
                    entry.get("reason", "—"),
                ])
        else:
            refrig_rows.append(["Not recorded", "—", "—", "—"])
        story.append(_niche_table(refrig_rows, [1.8 * inch, 1.2 * inch, 1.5 * inch, 1.5 * inch]))
        story.append(Spacer(1, 6))

        # ── Pressure readings ─────────────────────────────────────────────────
        pressure_items = job_data.get("pressure_readings") or []
        pressure_rows = [["Circuit / Unit", "Suction PSI", "Discharge PSI", "Subcooling °F", "Superheat °F"]]
        if pressure_items:
            for entry in pressure_items:
                pressure_rows.append([
                    entry.get("circuit", "—"),
                    str(entry.get("suction_psi", "—")),
                    str(entry.get("discharge_psi", "—")),
                    str(entry.get("subcooling_f", "—")),
                    str(entry.get("superheat_f", "—")),
                ])
        else:
            pressure_rows.append(["Not recorded", "—", "—", "—", "—"])
        story.append(Paragraph("Pressure Readings", _LABEL))
        story.append(_niche_table(
            pressure_rows,
            [1.5 * inch, 1.0 * inch, 1.1 * inch, 1.1 * inch, 1.1 * inch],
        ))
        story.append(Spacer(1, 8))

    elif niche_type == "tree_service":
        story.append(Paragraph("Tree Service — Tree Inventory & Hazard Assessment", _H2))

        # ── Tree species / DBH inventory ──────────────────────────────────────
        tree_items = job_data.get("tree_inventory") or []
        tree_rows = [["Tree ID", "Species", "DBH (in)", "Height (ft)", "Work Performed"]]
        if tree_items:
            for tree in tree_items:
                tree_rows.append([
                    str(tree.get("tree_id", "—")),
                    tree.get("species", "—"),
                    str(tree.get("dbh_in", "—")),
                    str(tree.get("height_ft", "—")),
                    tree.get("work_performed", "—"),
                ])
        else:
            tree_rows.append(["—", "Not recorded", "—", "—", "—"])
        story.append(_niche_table(
            tree_rows,
            [0.8 * inch, 1.5 * inch, 0.8 * inch, 0.9 * inch, 2.0 * inch],
        ))
        story.append(Spacer(1, 6))

        # ── Hazard assessment ─────────────────────────────────────────────────
        hazard_items = job_data.get("hazard_assessment") or []
        hazard_rows = [["Hazard Type", "Severity", "Recommended Action", "Resolved"]]
        if hazard_items:
            for hazard in hazard_items:
                hazard_rows.append([
                    hazard.get("hazard_type", "—"),
                    hazard.get("severity", "—"),
                    hazard.get("recommended_action", "—"),
                    "Yes" if hazard.get("resolved") else "No",
                ])
        else:
            hazard_rows.append(["Not recorded", "—", "—", "—"])
        story.append(Paragraph("Hazard Assessment", _LABEL))
        story.append(_niche_table(hazard_rows, [1.5 * inch, 1.0 * inch, 2.3 * inch, 0.7 * inch]))
        story.append(Spacer(1, 8))

    elif niche_type == "landscaping":
        story.append(Paragraph("Landscaping — Plant Species & Irrigation Zones", _H2))

        # ── Plant species list ─────────────────────────────────────────────────
        plant_items = job_data.get("plant_species") or []
        plant_rows = [["Common Name", "Botanical Name", "Qty", "Location / Bed", "Size"]]
        if plant_items:
            for plant in plant_items:
                plant_rows.append([
                    plant.get("common_name", "—"),
                    plant.get("botanical_name", "—"),
                    str(plant.get("qty", "—")),
                    plant.get("location", "—"),
                    plant.get("size", "—"),
                ])
        else:
            plant_rows.append(["Not recorded", "—", "—", "—", "—"])
        story.append(_niche_table(
            plant_rows,
            [1.3 * inch, 1.5 * inch, 0.5 * inch, 1.4 * inch, 0.8 * inch],
        ))
        story.append(Spacer(1, 6))

        # ── Irrigation zones ──────────────────────────────────────────────────
        zone_items = job_data.get("irrigation_zones") or []
        zone_rows = [["Zone #", "Zone Name", "Head Type", "Runtime (min)", "Notes"]]
        if zone_items:
            for zone in zone_items:
                zone_rows.append([
                    str(zone.get("zone_number", "—")),
                    zone.get("zone_name", "—"),
                    zone.get("head_type", "—"),
                    str(zone.get("runtime_min", "—")),
                    zone.get("notes", ""),
                ])
        else:
            for z in ["Zone 1", "Zone 2", "Zone 3"]:
                zone_rows.append(["—", z, "Not recorded", "—", ""])
        story.append(Paragraph("Irrigation Zones", _LABEL))
        story.append(_niche_table(
            zone_rows,
            [0.7 * inch, 1.3 * inch, 1.2 * inch, 1.2 * inch, 1.6 * inch],
        ))
        story.append(Spacer(1, 8))

    elif niche_type == "barber":
        story.append(Paragraph("Barber / Salon — Services Performed & Chemical Applications", _H2))

        # ── Service menu items ────────────────────────────────────────────────
        service_items = job_data.get("services_performed") or []
        service_rows = [["Service", "Duration (min)", "Price ($)", "Technician", "Notes"]]
        if service_items:
            for svc in service_items:
                service_rows.append([
                    svc.get("service", "—"),
                    str(svc.get("duration_min", "—")),
                    f"${svc.get('price_cents', 0) / 100:,.2f}" if svc.get("price_cents") is not None else "—",
                    svc.get("technician", "—"),
                    svc.get("notes", ""),
                ])
        else:
            for svc in ["Haircut", "Beard trim", "Shampoo & condition", "Color service"]:
                service_rows.append([svc, "—", "—", "—", "Not recorded"])
        story.append(_niche_table(
            service_rows,
            [1.6 * inch, 1.1 * inch, 0.9 * inch, 1.2 * inch, 1.2 * inch],
        ))
        story.append(Spacer(1, 6))

        # ── Chemical applications ─────────────────────────────────────────────
        chem_items = job_data.get("chemical_applications") or []
        chem_rows = [["Product Name", "Active Ingredient", "Amount Used", "Client Skin Test", "Applied By"]]
        if chem_items:
            for chem in chem_items:
                chem_rows.append([
                    chem.get("product_name", "—"),
                    chem.get("active_ingredient", "—"),
                    chem.get("amount_used", "—"),
                    "Yes" if chem.get("skin_test_passed") else "No",
                    chem.get("applied_by", "—"),
                ])
        else:
            chem_rows.append(["Not recorded", "—", "—", "—", "—"])
        story.append(Paragraph("Chemical Applications", _LABEL))
        story.append(_niche_table(
            chem_rows,
            [1.5 * inch, 1.3 * inch, 1.0 * inch, 1.0 * inch, 1.2 * inch],
        ))
        story.append(Spacer(1, 8))

    else:
        # Unknown niche — silently skip to avoid breaking reports for future niches
        logger.debug("add_niche_section: unrecognised niche_type '%s' — skipped", niche_type)


def _fmt_date(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%B %d, %Y")
    except Exception:
        return iso[:10]


# ── PDF builder ───────────────────────────────────────────────────────────────

def _build_pdf(job: dict[str, Any], tenant: dict[str, Any]) -> bytes:
    """Assemble the reportlab flowables and return PDF bytes.

    Section order:
      1. Header
      2. Job Summary
      3. Revenue Reconciliation (three-way match results)
      4. Field Notes
      5. Compliance Violations
      6. Niche-Specific Section  ← injected by add_niche_section()
      7. Footer
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    story = []

    # ── Header ────────────────────────────────────────────────────────────────
    story.append(Paragraph("LeakLock Compliance Audit Report", _TITLE))
    story.append(Paragraph(
        f"Generated {datetime.now(timezone.utc).strftime('%B %d, %Y at %H:%M UTC')}",
        _LABEL,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E5E7EB")))
    story.append(Spacer(1, 8))

    # ── Job summary ───────────────────────────────────────────────────────────
    story.append(Paragraph("Job Summary", _H2))
    summary_data = [
        ["Field", "Value"],
        ["Job ID", job.get("crm_job_id", job.get("id", "—"))[:16]],
        ["Client", job.get("client_name", "—")],
        ["Address", job.get("client_address") or "—"],
        ["Status", str(job.get("status", "—")).replace("_", " ").title()],
        ["Created", _fmt_date(job.get("created_at"))],
    ]
    t = Table(summary_data, colWidths=[2 * inch, 4 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F9FAFB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#374151")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))

    # ── Three-way match results ───────────────────────────────────────────────
    recon = job.get("reconciliation_results") or []
    if recon:
        story.append(Paragraph("Revenue Reconciliation", _H2))
        latest = recon[0]
        status = latest.get("status", "unknown")
        status_color = "#DC2626" if status == "discrepancy" else "#059669"
        story.append(Paragraph(
            f"Match Status: <font color='{status_color}'>{status.upper()}</font>",
            _BODY,
        ))
        missing = latest.get("missing_items") or []
        if missing:
            story.append(Paragraph("Missing / Unbilled Items:", _BODY))
            rows = [["Item", "Qty", "Est. Value"]]
            for item in missing:
                rows.append([
                    item.get("item", "—"),
                    str(item.get("qty", 1)),
                    _fmt_cents(item.get("estimated_leak_cents", 0)),
                ])
            rows.append(["", "TOTAL LEAK", _fmt_cents(latest.get("estimated_leak_cents", 0))])

            mt = Table(rows, colWidths=[3.5 * inch, 1 * inch, 1.5 * inch])
            mt.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FEF2F2")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#DC2626")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#FFF7F7")]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#FECACA")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(mt)

        auditor_action = latest.get("auditor_action")
        if auditor_action:
            story.append(Spacer(1, 6))
            story.append(Paragraph(
                f"Auditor Decision: <b>{auditor_action.replace('_', ' ').title()}</b>",
                _BODY,
            ))

        story.append(Spacer(1, 8))

    # ── Field notes ───────────────────────────────────────────────────────────
    field_notes = job.get("field_notes") or []
    if field_notes:
        story.append(Paragraph("Field Notes", _H2))
        for note in field_notes:
            if note.get("raw_text"):
                story.append(Paragraph(note["raw_text"], _BODY))
            status = note.get("parse_status", "")
            if status == "complete" and note.get("parsed_items"):
                items = note["parsed_items"]
                story.append(Paragraph(
                    f"Parsed {len(items)} item(s) from field notes.",
                    _LABEL,
                ))
            story.append(Spacer(1, 4))

    # ── Compliance violations ─────────────────────────────────────────────────
    field_events = job.get("field_events") or []
    violations = [
        e for e in field_events
        if e.get("compliance_status") in ("warning", "fail")
    ]
    if violations:
        story.append(Paragraph("Compliance Violations", _H2))
        for ev in violations:
            severity = ev.get("compliance_status", "warning").upper()
            story.append(Paragraph(
                f"<font color='#DC2626'>[{severity}]</font> "
                f"{ev.get('event_type', 'event').title()} captured on "
                f"{_fmt_date(ev.get('created_at'))}",
                _ALERT,
            ))
            parsed = ev.get("parsed_data") or {}
            for v in (parsed.get("violations") or []):
                story.append(Paragraph(
                    f"• {v.get('rule', '')} — {v.get('detail', '')}",
                    _BODY,
                ))
        story.append(Spacer(1, 8))

    # ── Niche-specific section ────────────────────────────────────────────────
    niche_type = tenant.get("tenant_type", "")
    if niche_type:
        add_niche_section(story, niche_type, job)

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#E5E7EB")))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"LeakLock Revenue Reconciliation  ·  Tenant: {tenant.get('name', 'N/A')}  "
        f"·  Report generated by AI audit engine",
        _LABEL,
    ))

    doc.build(story)
    return buf.getvalue()


# ── Route ─────────────────────────────────────────────────────────────────────

@router.get("/job/{job_id}/audit.pdf")
async def generate_audit_pdf(
    job_id: UUID,
    user: dict = Security(require_role("owner", "auditor")),
):
    """Generate and stream a compliance audit PDF for a job.

    Accessible to owners and auditors only.
    Returns application/pdf with Content-Disposition: attachment.
    """
    supabase = get_supabase()

    # Fetch job with related data in one query
    job_result = (
        supabase.table("jobs")
        .select(
            "*, "
            "field_notes(raw_text, parsed_items, parse_status, photo_urls), "
            "field_events(event_type, compliance_status, parsed_data, created_at), "
            "reconciliation_results("
            "  status, estimated_leak_cents, missing_items, "
            "  auditor_action, reviewed_at"
            ")"
        )
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )

    if not job_result.data:
        raise HTTPException(status_code=404, detail="Job not found")

    tenant_result = (
        supabase.table("tenants")
        .select("name, tenant_type")
        .eq("id", user["tenant_id"])
        .single()
        .execute()
    )
    tenant = tenant_result.data or {}

    try:
        pdf_bytes = _build_pdf(job_result.data, tenant)
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        logger.exception("PDF generation failed for job %s", job_id)
        raise HTTPException(status_code=500, detail="PDF generation failed")

    crm_id = job_result.data.get("crm_job_id", str(job_id)[:8])
    filename = f"leaklock-audit-{crm_id}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
