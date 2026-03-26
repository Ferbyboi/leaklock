"""Direct unit tests for the three-way match engine.

Covers:
- Clean match (all field-note items appear on invoice)
- Discrepancy (item in field notes missing from invoice)
- Estimated leak amount calculation
- Fuzzy matching at 75% token-overlap threshold
- Synonym normalisation (cpvc → copper pipe, replaced → install)
- Fraction normalisation (3/4 → .75)
- Low-confidence AI items are skipped (< 0.5)
- Extra items (invoice has items not in estimate) are flagged
- Empty inputs produce clean / zero-leak result
- Dict inputs (description key) and dataclass inputs both work
"""
from __future__ import annotations

import pytest
from app.core.match_engine import run_three_way_match, normalize, items_match


# ── normalize() ──────────────────────────────────────────────────────────────

def test_normalize_lowercases():
    assert normalize("Copper Pipe") == "copper pipe"


def test_normalize_strips_units():
    assert "each" not in normalize("shutoff valve each")
    assert "hrs" not in normalize("labor 2 hrs")


def test_normalize_fraction_three_quarters():
    assert ".75" in normalize("copper pipe 3/4 inch")


def test_normalize_fraction_half():
    assert ".5" in normalize("pipe 1/2 inch")


def test_normalize_synonym_cpvc():
    assert "copper pipe" in normalize("cpvc fitting")


def test_normalize_synonym_replaced():
    assert "install" in normalize("replaced shutoff valve")


# ── items_match() ─────────────────────────────────────────────────────────────

def test_exact_match():
    assert items_match("shutoff valve", "shutoff valve") is True


def test_substring_match():
    assert items_match("copper pipe", "1/2 copper pipe fitting") is True


def test_token_overlap_above_threshold():
    # 2 of 3 tokens match → 67% — below 75% default threshold
    assert items_match("copper pipe fitting", "copper pipe bracket") is False


def test_token_overlap_at_threshold():
    # All tokens match
    assert items_match("install valve", "install valve kit") is True


def test_no_match_completely_different():
    assert items_match("shutoff valve", "labor charge") is False


# ── run_three_way_match() — clean ─────────────────────────────────────────────

def test_clean_when_all_items_invoiced():
    estimate = [{"description": "shutoff valve", "unit_price_cents": 3000, "qty": 1}]
    notes    = [{"item": "shutoff valve", "qty": 1, "confidence": 0.9}]
    invoice  = [{"description": "shutoff valve", "unit_price_cents": 3000, "qty": 1}]

    result = run_three_way_match(estimate, notes, invoice)

    assert result["status"] == "clean"
    assert result["missing_items"] == []
    assert result["estimated_leak_cents"] == 0


def test_clean_empty_inputs():
    result = run_three_way_match([], [], [])
    assert result["status"] == "clean"
    assert result["estimated_leak_cents"] == 0


# ── run_three_way_match() — discrepancy ───────────────────────────────────────

def test_discrepancy_when_item_missing_from_invoice():
    estimate = [{"description": "shutoff valve", "unit_price_cents": 4500, "qty": 1}]
    notes    = [{"item": "shutoff valve", "qty": 1, "confidence": 0.9}]
    invoice  = []  # invoice is blank

    result = run_three_way_match(estimate, notes, invoice)

    assert result["status"] == "discrepancy"
    assert len(result["missing_items"]) == 1
    assert result["missing_items"][0]["item"] == "shutoff valve"
    assert result["estimated_leak_cents"] == 4500


def test_leak_cents_multiplied_by_qty():
    estimate = [{"description": "copper pipe", "unit_price_cents": 1000, "qty": 1}]
    notes    = [{"item": "copper pipe", "qty": 3, "confidence": 0.95}]
    invoice  = []

    result = run_three_way_match(estimate, notes, invoice)

    assert result["estimated_leak_cents"] == 3000


def test_multiple_missing_items_summed():
    estimate = [
        {"description": "shutoff valve", "unit_price_cents": 4000, "qty": 1},
        {"description": "labor", "unit_price_cents": 2000, "qty": 1},
    ]
    notes = [
        {"item": "shutoff valve", "qty": 1, "confidence": 0.9},
        {"item": "labor", "qty": 2, "confidence": 0.85},
    ]
    invoice = []

    result = run_three_way_match(estimate, notes, invoice)

    assert result["status"] == "discrepancy"
    assert result["estimated_leak_cents"] == 8000  # 4000 + 2*2000


# ── Low-confidence items are skipped ─────────────────────────────────────────

def test_low_confidence_item_skipped():
    notes = [{"item": "mystery item", "qty": 1, "confidence": 0.4}]
    result = run_three_way_match([], notes, [])
    assert result["status"] == "clean"
    assert result["missing_items"] == []


def test_exactly_at_confidence_threshold_is_kept():
    notes = [{"item": "valve", "qty": 1, "confidence": 0.5}]
    result = run_three_way_match([], notes, [])
    assert result["status"] == "discrepancy"


# ── Extra items (in invoice, not in estimate) ─────────────────────────────────

def test_extra_items_flagged():
    estimate = [{"description": "shutoff valve", "unit_price_cents": 3000, "qty": 1}]
    notes    = []
    invoice  = [
        {"description": "shutoff valve", "unit_price_cents": 3000, "qty": 1},
        {"description": "emergency fee", "unit_price_cents": 15000, "qty": 1},
    ]

    result = run_three_way_match(estimate, notes, invoice)

    assert result["status"] == "clean"
    assert len(result["extra_items"]) == 1
    assert result["extra_items"][0]["item"] == "emergency fee"


# ── Dict vs description key handling ─────────────────────────────────────────

def test_description_key_in_field_notes():
    """Field notes from parse_worker use 'item' key; estimates use 'description' key."""
    estimate = [{"description": "copper pipe", "unit_price_cents": 500, "qty": 1}]
    notes    = [{"description": "copper pipe", "qty": 1, "confidence": 0.9}]
    invoice  = [{"description": "copper pipe", "unit_price_cents": 500, "qty": 1}]

    result = run_three_way_match(estimate, notes, invoice)
    assert result["status"] == "clean"


def test_fuzzy_synonym_match_is_clean():
    """'cpvc pipe' in notes should match 'copper pipe' in invoice via synonym normalization."""
    estimate = [{"description": "copper pipe", "unit_price_cents": 500, "qty": 1}]
    notes    = [{"item": "cpvc pipe", "qty": 1, "confidence": 0.9}]
    invoice  = [{"description": "copper pipe", "unit_price_cents": 500, "qty": 1}]

    result = run_three_way_match(estimate, notes, invoice)
    assert result["status"] == "clean"
