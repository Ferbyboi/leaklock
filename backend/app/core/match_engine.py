from __future__ import annotations

from dataclasses import dataclass, field
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

# Configurable match threshold — default 0.75, override via env var
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.75"))

# Voyage-3 embedding endpoint (same as generate_embeddings Celery task)
_VOYAGE_EMBED_URL = "https://api.voyageai.com/v1/embeddings"
_VOYAGE_MODEL = "voyage-3"
_EMBED_DIMENSIONS = 1536


@dataclass
class LineItem:
    description: str
    qty: float
    unit_price_cents: int
    normalized: str = field(default='')

    def __post_init__(self):
        self.normalized = normalize(self.description)


def normalize(text: str) -> str:
    """Lowercase, strip units, remove filler words for fuzzy matching."""
    text = text.lower()
    for unit in ['inch', 'in.', 'ft', 'feet', 'each', 'ea', 'hrs', 'hours', 'lbs', 'lb']:
        text = re.sub(rf'\b{unit}\b', '', text)
    # Normalize fractions: 3/4 → .75, 1/2 → .5
    text = re.sub(r'\b3/4\b', '.75', text)
    text = re.sub(r'\b1/2\b', '.5', text)
    text = re.sub(r'\b1/4\b', '.25', text)
    # Normalize synonyms
    synonyms = {
        'cpvc': 'copper pipe',
        'replaced': 'install',
        'swap': 'install',
        'swapped': 'install',
        'replaced with': 'install',
    }
    for alias, canonical in synonyms.items():
        text = text.replace(alias, canonical)
    return ' '.join(text.split())


def items_match(note_item: str, invoice_item: str, threshold: float = MATCH_THRESHOLD) -> bool:
    """True if note item is semantically present in invoice item."""
    n = normalize(note_item)
    iv = normalize(invoice_item)

    if n == iv or n in iv or iv in n:
        return True

    n_tokens = set(n.split())
    iv_tokens = set(iv.split())
    if not n_tokens:
        return False
    overlap = len(n_tokens & iv_tokens) / len(n_tokens)
    return overlap >= threshold


def _get_voyage_embedding(text: str) -> list[float] | None:
    """Call Voyage AI to get a vector embedding for *text*.

    Returns a list of floats, or None if the API key is absent or the call fails.
    Uses the same httpx + voyage-3 pattern as the generate_embeddings Celery task.
    """
    voyage_key = os.getenv("VOYAGE_API_KEY")
    if not voyage_key:
        logger.debug("VOYAGE_API_KEY not set — skipping vector embedding")
        return None
    try:
        resp = httpx.post(
            _VOYAGE_EMBED_URL,
            headers={"Authorization": f"Bearer {voyage_key}"},
            json={"input": text[:24000], "model": _VOYAGE_MODEL},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]
    except Exception as exc:
        logger.warning("Voyage embedding call failed: %s", exc)
        return None


def vector_similarity_match(
    query_text: str,
    tenant_id: str,
    threshold: float = 0.85,
) -> list[dict]:
    """Semantic similarity search against invoice_line_item_embeddings.

    Generates a Voyage-3 embedding for *query_text*, then executes a
    pgvector cosine-similarity query via the Supabase PostgREST RPC endpoint.

    Returns up to 10 rows ordered by similarity desc, each containing:
      { id, job_id, tenant_id, line_item_text, similarity }

    Falls back to an empty list if embeddings are unavailable or the DB call
    fails — callers must handle the empty-list case gracefully.

    Args:
        query_text: The field-note item description to search for.
        tenant_id:  Tenant UUID — all results are scoped to this tenant.
        threshold:  Minimum cosine similarity to include (default 0.85).
    """
    vector = _get_voyage_embedding(query_text)
    if not vector:
        return []

    try:
        from app.db import get_db
        db = get_db()

        # Use Supabase RPC to run parameterised pgvector query.
        # The SQL backing `match_invoice_line_items` is:
        #   SELECT id, job_id, tenant_id, line_item_text,
        #          1 - (embedding <=> query_vector::vector) AS similarity
        #   FROM   invoice_line_item_embeddings
        #   WHERE  tenant_id = p_tenant_id
        #     AND  1 - (embedding <=> query_vector::vector) > p_threshold
        #   ORDER  BY similarity DESC
        #   LIMIT  10;
        result = db.rpc(
            "match_invoice_line_items",
            {
                "query_vector": vector,
                "p_tenant_id": tenant_id,
                "p_threshold": threshold,
            },
        ).execute()
        return result.data or []
    except Exception as exc:
        logger.warning("vector_similarity_match DB call failed: %s", exc)
        return []


def _get_desc(item) -> str:
    """Get item description from dict (handles both 'description' and 'item' keys) or dataclass."""
    if isinstance(item, dict):
        return item.get('description') or item.get('item', '')
    return item.description


def _fuzzy_score(note_desc: str, inv_desc: str) -> float:
    """Return a 0-1 token-overlap score between two normalised descriptions."""
    n = normalize(note_desc)
    iv = normalize(inv_desc)
    if n == iv or n in iv or iv in n:
        return 1.0
    n_tokens = set(n.split())
    iv_tokens = set(iv.split())
    if not n_tokens:
        return 0.0
    return len(n_tokens & iv_tokens) / len(n_tokens)


def run_three_way_match(
    estimate_items: list,   # Input A — The Promise
    field_note_items: list, # Input B — parsed by AI
    invoice_items: list,    # Input C — The Bill
    tenant_id: str = "",    # Optional — enables vector fallback when provided
) -> dict:
    """
    Core reconciliation function.
    Returns: { status, missing_items, extra_items, estimated_leak_cents }

    Matching strategy (per item):
      1. Fuzzy token-overlap match (fast, in-memory).
      2. If best fuzzy score < 0.7 AND tenant_id is provided, fall back to
         pgvector cosine-similarity search (vector_similarity_match).
    """
    missing = []
    extra = []

    for note_item in field_note_items:
        if note_item.get('confidence', 1.0) < 0.5:
            continue  # Skip low-confidence AI extractions

        desc = _get_desc(note_item)

        # ── Step 1: fuzzy match ──────────────────────────────────────────────
        best_fuzzy = max(
            (_fuzzy_score(desc, _get_desc(inv)) for inv in invoice_items),
            default=0.0,
        )
        found_in_invoice = best_fuzzy >= MATCH_THRESHOLD

        # ── Step 2: vector fallback (only when fuzzy confidence is low) ──────
        if not found_in_invoice and best_fuzzy < 0.7 and tenant_id:
            try:
                vector_hits = vector_similarity_match(desc, tenant_id)
                if vector_hits:
                    # Consider found if any hit's line_item_text fuzzy-matches
                    # a known invoice item (confirms the semantic match maps to
                    # something actually on the invoice, not just training data)
                    for hit in vector_hits:
                        hit_text = hit.get("line_item_text", "")
                        if any(
                            items_match(hit_text, _get_desc(inv))
                            for inv in invoice_items
                        ):
                            found_in_invoice = True
                            break
            except Exception as vec_exc:
                logger.warning(
                    "Vector fallback failed for item '%s': %s", desc, vec_exc
                )

        if not found_in_invoice:
            est_match = next(
                (e for e in estimate_items if items_match(desc, _get_desc(e))),
                None
            )
            unit_price = (
                est_match['unit_price_cents'] if isinstance(est_match, dict)
                else est_match.unit_price_cents if est_match else 0
            )
            leak_cents = unit_price * note_item.get('qty', 1) if est_match else 0
            missing.append({
                'item': desc,
                'qty': note_item.get('qty', 1),
                'estimated_leak_cents': int(leak_cents),
                'confidence': note_item.get('confidence', 1.0),
            })

    for inv in invoice_items:
        inv_desc = _get_desc(inv)
        in_estimate = any(
            items_match(inv_desc, _get_desc(e))
            for e in estimate_items
        )
        if not in_estimate:
            inv_price = inv['unit_price_cents'] if isinstance(inv, dict) else inv.unit_price_cents
            extra.append({'item': inv_desc, 'unit_price_cents': inv_price})

    total_leak = sum(m['estimated_leak_cents'] for m in missing)
    status = 'discrepancy' if missing else 'clean'

    return {
        'status': status,
        'missing_items': missing,
        'extra_items': extra,
        'estimated_leak_cents': total_leak,
    }
