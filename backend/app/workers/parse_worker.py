"""Field note parser — uses Instructor-wrapped Claude for validated JSON output.

Instructor replaces manual JSON stripping and adds:
- Pydantic model validation of Claude's response
- Auto-retry up to 3 times if Claude returns malformed output
- Sentry logging on parse failures with raw transcript context

The public API is parse_field_notes() which returns a list[dict] compatible
with the reconciliation pipeline's expected ParsedItem shape.  The actual
Claude call is delegated to app.core.claude_client.parse_field_note() so that
all Anthropic API access goes through a single, instructor-wrapped client.
"""
from __future__ import annotations

import asyncio
import logging

import sentry_sdk
from pydantic import BaseModel, Field, field_validator
from typing import Optional

logger = logging.getLogger(__name__)


# ── Reconciliation-pipeline item schema ────────────────────────────────────────
# Kept here because the three-way match engine expects this exact dict shape:
#   { item, qty, unit, confidence }
# ParsedFieldNote (in app.models.parsed_output) uses a different schema
# oriented toward invoice reconstruction; we bridge the two below.

class ParsedItem(BaseModel):
    item: str = Field(..., description="Normalized item name, e.g. 'copper pipe 3/4 inch'")
    qty: float = Field(default=1.0, ge=0, description="Quantity if mentioned, else 1.0")
    unit: str = Field(default="each", description="Unit: each, hours, feet, lbs, etc.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="0.0-1.0 certainty score")

    @field_validator("item")
    @classmethod
    def item_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("item cannot be empty")
        return v.strip().lower()


class ParsedFieldNotes(BaseModel):
    items: list[ParsedItem] = Field(
        default_factory=list,
        description="All items, materials, or labor actions found in the notes",
    )


# ── Public API ─────────────────────────────────────────────────────────────────

def parse_field_notes(
    raw_text: str,
    niche_system_prompt: Optional[str] = None,
    max_retries: int = 3,
) -> list[dict]:
    """Parse field notes into structured items using Instructor + Claude.

    Delegates the Claude API call to app.core.claude_client.parse_field_note()
    which owns the instructor-patched Anthropic client and all retry logic.
    The ParsedFieldNote result is bridged back to the ParsedItem dict shape
    expected by the reconciliation pipeline.

    Args:
        raw_text:            Raw technician notes (text from OCR or voice transcript).
        niche_system_prompt: Optional niche-specific system prompt from SchemaRouter.
                             Passed to the client as the niche_type hint when present.
        max_retries:         Number of Instructor retries on validation failure
                             (forwarded to the underlying client call).

    Returns:
        List of dicts matching ParsedItem schema, ready for DB insert.
        Returns [] if raw_text is empty or parsing fails after retries.
    """
    if not raw_text.strip():
        return []

    try:
        from app.core.claude_client import parse_field_note

        # parse_field_note is async; run it synchronously from this sync context
        # (Celery tasks run in a regular thread, not an event loop).
        parsed = asyncio.run(
            parse_field_note(
                text=raw_text,
                job_id="",          # job_id stamped by the caller (tasks.py)
                niche_type=niche_system_prompt or "restaurant",
            )
        )

        # confidence_score == 0.0 signals a total parse failure from the client
        if parsed.confidence_score == 0.0 and not parsed.items_found and not parsed.materials_used:
            return []

        # Bridge ParsedFieldNote → list[ParsedItem dict]
        # items_found and materials_used both map to reconciliation line items.
        items: list[dict] = []
        for li in list(parsed.items_found) + list(parsed.materials_used):
            try:
                pi = ParsedItem(
                    item=li.description,
                    qty=li.quantity,
                    unit=li.unit or "each",
                    confidence=parsed.confidence_score,
                )
                items.append(pi.model_dump())
            except Exception:
                # Skip individual items that fail validation rather than
                # dropping the whole parse result.
                continue

        return items

    except Exception as exc:
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("raw_text_preview", raw_text[:500])
            scope.set_extra("word_count", len(raw_text.split()))
            sentry_sdk.capture_exception(exc)
        return []
