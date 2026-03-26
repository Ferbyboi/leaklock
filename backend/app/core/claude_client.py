"""Instructor-wrapped Claude client with structured output and auto-retry.

Provides two public coroutines:
  - parse_field_note()     — lightweight Haiku parse for field technician notes
  - evaluate_compliance()  — Sonnet-backed compliance audit against niche rules

Both use instructor.from_anthropic() so Pydantic validation is enforced and
malformed JSON is retried automatically up to max_retries times before raising.
"""
from __future__ import annotations

import logging
import os

import anthropic
import instructor

from app.models.parsed_output import ComplianceResult, ParsedFieldNote

logger = logging.getLogger(__name__)


def get_instructor_client() -> instructor.Instructor:
    """Return an instructor-patched Anthropic client.

    Reads ANTHROPIC_API_KEY from the environment, consistent with the rest of
    the application which uses os.getenv() rather than a settings object.
    """
    raw = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return instructor.from_anthropic(raw)


async def parse_field_note(
    text: str,
    job_id: str,
    niche_type: str = "restaurant",
) -> ParsedFieldNote:
    """Parse field note text into structured data with 3x retry on malformed JSON.

    Uses claude-haiku-4-5-20251001 for speed and cost efficiency per the
    model-routing table in CLAUDE.md (field note parsing → haiku, low effort).
    Sonnet is reserved for the higher-value compliance evaluation path.

    Args:
        text:       Raw technician field note text (post-OCR).
        job_id:     Job UUID — stamped onto the returned model for traceability.
        niche_type: Tenant's industry type used to tune the system prompt.

    Returns:
        ParsedFieldNote — always returns, falls back to confidence_score=0.0
        on total failure so callers can distinguish a parse error from an
        empty note.
    """
    client = get_instructor_client()

    system_prompt = (
        f"You are a field note parser for a {niche_type} service business. "
        "Extract line items, materials, and issues from technician field notes. "
        "Be precise about quantities and units."
    )

    try:
        result: ParsedFieldNote = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            max_retries=3,
            response_model=ParsedFieldNote,
            system=system_prompt,
            messages=[
                {"role": "user", "content": f"Parse this field note:\n\n{text}"}
            ],
        )
        result.job_id = job_id
        result.raw_text = text
        return result
    except Exception as e:
        logger.error(
            "Field note parsing failed for job %s: %s", job_id, e, exc_info=True
        )
        # Return a minimal fallback so callers can detect the failure via
        # confidence_score=0.0 without raising and breaking the Celery chain.
        return ParsedFieldNote(job_id=job_id, raw_text=text, confidence_score=0.0)


async def evaluate_compliance(
    field_data: dict,
    niche_schema: dict,
    job_id: str,
    niche_type: str,
) -> ComplianceResult:
    """Evaluate compliance against niche rules with structured output.

    Uses claude-sonnet-4-6 for nuanced rule evaluation. instructor enforces
    the ComplianceResult schema and retries up to 3 times on malformed output.

    Args:
        field_data:   Parsed field data dict to audit (e.g. from field_notes row).
        niche_schema: Full schema dict from SchemaRouter (must contain
                      "validation_rules" key with list of rule dicts).
        job_id:       Job UUID — stamped onto the returned model.
        niche_type:   Tenant industry type used in prompts and stamped on result.

    Returns:
        ComplianceResult — always returns, falls back to passed=False / score=0.0
        on total failure.
    """
    client = get_instructor_client()

    rules_text = "\n".join(
        f"- [{r['rule_id']}] {r['description']} (severity: {r.get('severity', 'warning')})"
        for r in niche_schema.get("validation_rules", [])
    )

    try:
        result: ComplianceResult = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            max_retries=3,
            response_model=ComplianceResult,
            system=(
                f"You are a {niche_type} compliance auditor. "
                "Evaluate the field data against all provided rules. "
                "Be strict but fair. Return structured violations only for actual failures."
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Evaluate compliance for this {niche_type} job.\n\n"
                        f"Field data:\n{field_data}\n\n"
                        f"Rules to check:\n{rules_text}"
                    ),
                }
            ],
        )
        result.job_id = job_id
        result.niche_type = niche_type
        return result
    except Exception as e:
        logger.error(
            "Compliance eval failed for job %s: %s", job_id, e, exc_info=True
        )
        return ComplianceResult(
            job_id=job_id,
            niche_type=niche_type,
            passed=False,
            score=0.0,
            violations=[],
            requires_immediate_action=False,
        )
