"""Schema Router — loads niche-specific compliance schema for a tenant.

Caches schemas in memory with a 5-minute TTL to avoid repeated disk reads.
Called by the AI parsing pipeline to get the correct system prompt and
validation rules for each tenant's industry.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

# Schema directory: two levels up from this file -> repo root -> niche_schemas/
_SCHEMA_DIR = Path(__file__).resolve().parents[3] / "niche_schemas"

_TENANT_TYPE_TO_FILE: dict[str, str] = {
    "restaurant": "restaurant_health.json",
    "hvac": "hvac_compliance.json",
    "plumbing": "hvac_compliance.json",  # plumbing shares HVAC schema
    "tree_service": "tree_safety.json",
    "landscaping": "landscaping_epa.json",
    "barber": "barber_sanitation.json",
    "salon": "barber_sanitation.json",   # salon alias
}

_CACHE_TTL_SECONDS = 300  # 5 minutes

# In-memory cache: tenant_type -> (schema_dict, loaded_at_timestamp)
_cache: dict[str, tuple[dict[str, Any], float]] = {}


def _load_schema(tenant_type: str) -> dict[str, Any]:
    """Load schema from disk; raise ValueError for unknown tenant types."""
    filename = _TENANT_TYPE_TO_FILE.get(tenant_type)
    if not filename:
        raise ValueError(
            f"Unknown tenant_type '{tenant_type}'. "
            f"Valid types: {list(_TENANT_TYPE_TO_FILE.keys())}"
        )
    path = _SCHEMA_DIR / filename
    if not path.exists():
        raise FileNotFoundError(
            f"Niche schema file not found: {path}. "
            "Ensure /niche_schemas/ directory is present at the repo root."
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_schema(tenant_type: str) -> dict[str, Any]:
    """Return the compliance schema for a given tenant type.

    Uses an in-memory cache with 5-minute TTL. Thread-safe for reads.

    Args:
        tenant_type: The tenant's industry type (e.g. "restaurant", "hvac").

    Returns:
        Full niche schema dict with ai_system_prompt, validation_rules,
        alert_thresholds, and required_daily_checks.

    Raises:
        ValueError: If tenant_type is not recognised.
        FileNotFoundError: If the schema JSON file is missing from disk.
    """
    now = time.monotonic()
    if tenant_type in _cache:
        schema, loaded_at = _cache[tenant_type]
        if now - loaded_at < _CACHE_TTL_SECONDS:
            return schema

    schema = _load_schema(tenant_type)
    _cache[tenant_type] = (schema, now)
    return schema


def get_system_prompt(tenant_type: str) -> str:
    """Convenience helper — returns just the ai_system_prompt for parsing."""
    return get_schema(tenant_type)["ai_system_prompt"]


def get_photo_prompt(tenant_type: str) -> str:
    """Convenience helper — returns just the photo_analysis_prompt."""
    return get_schema(tenant_type)["photo_analysis_prompt"]


def get_validation_rules(tenant_type: str) -> dict[str, Any]:
    """Convenience helper — returns the validation_rules dict."""
    return get_schema(tenant_type)["validation_rules"]


def get_alert_thresholds(tenant_type: str) -> dict[str, list[str]]:
    """Convenience helper — returns alert_thresholds with critical/warning/info keys."""
    return get_schema(tenant_type)["alert_thresholds"]


def get_required_daily_checks(tenant_type: str) -> list[str]:
    """Convenience helper — returns the required_daily_checks list."""
    return get_schema(tenant_type)["required_daily_checks"]


def invalidate_cache(tenant_type: Optional[str] = None) -> None:
    """Clear the schema cache. Pass tenant_type to clear just one entry."""
    if tenant_type is None:
        _cache.clear()
    else:
        _cache.pop(tenant_type, None)
