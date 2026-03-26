"""Free Diagnostic Tool — public endpoint, no authentication required.

POST /diagnostic/analyze

Accepts a file upload (image of a paper log or text paste) and returns
a gap analysis using Tesseract OCR + Claude Sonnet.

No API key required. No sign-in required. Rate limited to 3 requests
per IP per hour to prevent abuse.

Response:
  {
    "gaps": [{"description": str, "severity": "critical|warning|info"}],
    "score": int (0-100, 100 = fully compliant),
    "summary": str,
    "cta_text": str
  }
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from typing import Optional

import sentry_sdk
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diagnostic", tags=["diagnostic"])

# ---------------------------------------------------------------------------
# Rate limiting (in-memory, per IP, 3 requests/hour)
# ---------------------------------------------------------------------------
_RATE_LIMIT = 3
_RATE_WINDOW = 3600  # 1 hour
_ip_log: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(ip: str) -> bool:
    now = time.time()
    cutoff = now - _RATE_WINDOW
    _ip_log[ip] = [t for t in _ip_log[ip] if t > cutoff]
    if len(_ip_log[ip]) >= _RATE_LIMIT:
        return False
    _ip_log[ip].append(now)
    return True


# ---------------------------------------------------------------------------
# Gap templates by niche keyword detection
# ---------------------------------------------------------------------------

_NICHE_GAPS = {
    "temperature": [
        {"rule": "temp_logging", "description": "Temperature logs found but missing danger zone classifications (FDA Food Code 3-501.16)", "severity": "critical"},
        {"rule": "timestamp", "description": "Temperature records lack proper timestamps — regulators require time of measurement (FDA Food Code 3-501.19)", "severity": "warning"},
    ],
    "refrigerant": [
        {"rule": "epa_cert", "description": "Refrigerant service records missing tech EPA 608 certification number (40 CFR Part 82.161)", "severity": "critical"},
        {"rule": "leak_rate", "description": "No leak rate calculation present — EPA requires annualized leak rate tracking for systems > 50 lbs (40 CFR Part 82.157)", "severity": "critical"},
    ],
    "safety": [
        {"rule": "ppe", "description": "PPE confirmation not documented — OSHA 1910.266 requires written PPE verification for each job site", "severity": "critical"},
        {"rule": "power_line", "description": "No power line proximity documentation — OSHA 1910.269 requires minimum 10ft clearance verification", "severity": "warning"},
    ],
    "chemical": [
        {"rule": "epa_reg", "description": "Chemical application records missing EPA registration number — FIFRA requires this for all pesticide applications", "severity": "critical"},
        {"rule": "weather", "description": "No weather conditions recorded at time of application — required for pesticide application compliance", "severity": "warning"},
    ],
    "sanitation": [
        {"rule": "interval", "description": "Sanitation interval not documented — state boards require tools sanitized every 15 minutes or between clients", "severity": "critical"},
        {"rule": "disinfectant", "description": "No EPA-registered disinfectant verification — state cosmetology board requires documented solution type and concentration", "severity": "warning"},
    ],
}

_UNIVERSAL_GAPS = [
    {"rule": "timestamp_missing", "description": "Records lack ISO-8601 timestamps — inspectors require exact date and time for every compliance entry", "severity": "warning"},
    {"rule": "no_tech_id", "description": "No employee or tech identification on records — who performed the work cannot be verified", "severity": "warning"},
    {"rule": "paper_only", "description": "Paper records are not tamper-proof — digital records with immutable timestamps are required for legal defensibility", "severity": "info"},
    {"rule": "no_location", "description": "Location or station not specified — records must be traceable to specific equipment or work area", "severity": "info"},
]


def _detect_niche(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["temp", "°f", "fahrenheit", "food", "grease", "sanitizer", "ppm"]):
        return "temperature"
    if any(w in text_lower for w in ["refrigerant", "freon", "r-22", "r-410", "r410", "leak rate", "epa 608"]):
        return "refrigerant"
    if any(w in text_lower for w in ["ppe", "hardhat", "chainsaw", "tie-off", "power line", "osha", "tree"]):
        return "safety"
    if any(w in text_lower for w in ["pesticide", "chemical", "epa reg", "dilution", "fertilizer"]):
        return "chemical"
    if any(w in text_lower for w in ["sanitize", "station", "disinfect", "barber", "cosmetology", "salon", "client"]):
        return "sanitation"
    return "general"


def _score_document(text: str, gaps: list[dict]) -> int:
    """Rough compliance score 0-100."""
    base = 100
    critical_gaps = sum(1 for g in gaps if g["severity"] == "critical")
    warning_gaps = sum(1 for g in gaps if g["severity"] == "warning")
    base -= critical_gaps * 25
    base -= warning_gaps * 10
    # Bonus points for having basic structure
    if any(c.isdigit() for c in text):
        base += 5  # Has numbers
    if len(text.split()) > 30:
        base += 5  # Has detail
    return max(0, min(100, base))


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def analyze_document(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    text_input: Optional[str] = Form(default=None),
):
    """Public diagnostic endpoint — no auth required.

    Accepts either a file upload (image/PDF) or raw text.
    Returns a gap analysis report.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. You can analyze 3 documents per hour. Sign up for unlimited access.",
        )

    raw_text = ""

    # Extract text from uploaded file via OCR
    if file and file.filename:
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(status_code=413, detail="File too large. Maximum 10MB.")

        content_type = file.content_type or ""

        if "image" in content_type:
            try:
                # Try Tesseract OCR
                import pytesseract
                from PIL import Image
                import io as _io
                img = Image.open(_io.BytesIO(content))
                raw_text = pytesseract.image_to_string(img).strip()
            except Exception as ocr_err:
                logger.warning("Tesseract OCR failed: %s", ocr_err)
                # Fall back to Claude Vision if OCR fails
                raw_text = ""

        elif "text" in content_type or "pdf" in content_type:
            raw_text = content.decode("utf-8", errors="ignore")[:8000]

    elif text_input:
        raw_text = text_input.strip()[:8000]

    if not raw_text and file:
        # Claude Vision fallback for images that Tesseract couldn't read
        try:
            import anthropic
            import base64
            content_bytes = await file.read() if not raw_text else b""
            client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            b64 = base64.standard_b64encode(content_bytes or b"").decode()
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",  # cheap for vision
                max_tokens=512,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": file.content_type or "image/jpeg", "data": b64},
                        },
                        {"type": "text", "text": "Extract all text from this compliance or service log document. Return only the raw extracted text, no analysis."},
                    ],
                }],
            )
            raw_text = msg.content[0].text.strip()
        except Exception as ve:
            sentry_sdk.capture_exception(ve)
            raise HTTPException(status_code=422, detail="Could not extract text from the uploaded file. Please try a clearer image or paste text directly.")

    if not raw_text:
        raise HTTPException(status_code=422, detail="No text provided. Upload an image or paste your compliance records.")

    # Detect niche from content
    niche = _detect_niche(raw_text)
    niche_gaps = _NICHE_GAPS.get(niche, [])

    # Claude gap analysis
    gaps: list[dict] = []
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

        prompt = (
            f"You are a compliance audit AI. Analyze this service/compliance record and identify "
            f"documentation gaps. Be specific about which regulatory requirements are missing.\n\n"
            f"DOCUMENT:\n{raw_text[:4000]}\n\n"
            f"Return a JSON array of gaps. Each gap: {{\"description\": str, \"severity\": \"critical|warning|info\"}}. "
            f"Return only the JSON array, no markdown."
        )
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",  # fast + cheap for public endpoint
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        import json
        claude_gaps = json.loads(msg.content[0].text.strip().lstrip("```json").rstrip("```").strip())
        if isinstance(claude_gaps, list):
            gaps = [g for g in claude_gaps if isinstance(g, dict)][:8]
    except Exception as ce:
        logger.warning("Claude gap analysis failed, using rule-based: %s", ce)
        # Fall back to rule-based gaps
        gaps = niche_gaps[:4] + _UNIVERSAL_GAPS[:2]

    # Merge with any template gaps not already covered
    gap_descriptions = {g["description"].lower()[:40] for g in gaps}
    for tpl_gap in (niche_gaps + _UNIVERSAL_GAPS):
        if tpl_gap["description"].lower()[:40] not in gap_descriptions and len(gaps) < 8:
            gaps.append(tpl_gap)

    score = _score_document(raw_text, gaps)

    critical_count = sum(1 for g in gaps if g["severity"] == "critical")
    warning_count = sum(1 for g in gaps if g["severity"] == "warning")

    if score >= 90:
        summary = "Your records look solid! A few minor improvements could make them audit-proof."
        cta = "LeakLock maintains these standards automatically from voice memos. Text START to +1-888-LEAKLOCK to try it free."
    elif score >= 70:
        summary = f"Found {critical_count} critical gaps and {warning_count} warnings in your records. These could cost you in an inspection."
        cta = f"LeakLock would have caught {critical_count + warning_count} issues automatically. Text START to +1-888-LEAKLOCK — first month free."
    else:
        summary = f"⚠️ Significant compliance risk detected: {critical_count} critical violations. This document would not pass an inspection."
        cta = f"LeakLock prevents all {critical_count} of these issues automatically. Your crew just talks — we handle the paperwork. Text START to +1-888-LEAKLOCK."

    return {
        "gaps": gaps,
        "score": score,
        "niche_detected": niche,
        "summary": summary,
        "cta_text": cta,
        "total_gaps": len(gaps),
        "critical_count": critical_count,
        "warning_count": warning_count,
    }
