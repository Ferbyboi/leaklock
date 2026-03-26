"""Tests for the niche schema router (Task 13 — Expansion Build Instructions)."""
import pytest
from app.core.schema_router import (
    get_schema,
    get_system_prompt,
    get_validation_rules,
    get_alert_thresholds,
    get_required_daily_checks,
    invalidate_cache,
)

VALID_TENANT_TYPES = [
    "restaurant",
    "hvac",
    "plumbing",
    "tree_service",
    "landscaping",
    "barber",
    "salon",
]


def setup_function():
    invalidate_cache()


# ── Schema loading ─────────────────────────────────────────────────────────────

def test_router_loads_restaurant_schema():
    schema = get_schema("restaurant")
    assert schema["tenant_type"] == "restaurant"
    assert "ai_system_prompt" in schema
    assert "validation_rules" in schema
    assert "alert_thresholds" in schema
    assert "required_daily_checks" in schema


def test_router_loads_hvac_schema():
    schema = get_schema("hvac")
    assert schema["tenant_type"] == "hvac"
    assert "refrigerant" in schema["ai_system_prompt"].lower()


def test_router_loads_tree_service_schema():
    schema = get_schema("tree_service")
    assert schema["tenant_type"] == "tree_service"
    assert "OSHA" in schema["regulatory_source"]


def test_router_loads_landscaping_schema():
    schema = get_schema("landscaping")
    assert schema["tenant_type"] == "landscaping"
    assert "EPA" in schema["regulatory_source"]


def test_router_loads_barber_schema():
    schema = get_schema("barber")
    assert schema["tenant_type"] == "barber"
    assert schema["validation_rules"]["waiver_retention_years"] == 7


def test_plumbing_alias_returns_hvac_schema():
    hvac = get_schema("hvac")
    plumbing = get_schema("plumbing")
    assert hvac["tenant_type"] == plumbing["tenant_type"] == "hvac"


def test_salon_alias_returns_barber_schema():
    barber = get_schema("barber")
    salon = get_schema("salon")
    assert barber["tenant_type"] == salon["tenant_type"] == "barber"


# ── Unknown tenant type ────────────────────────────────────────────────────────

def test_unknown_tenant_type_raises_value_error():
    with pytest.raises(ValueError, match="Unknown tenant_type"):
        get_schema("car_wash")


def test_empty_tenant_type_raises_value_error():
    with pytest.raises(ValueError):
        get_schema("")


# ── Cache behaviour ────────────────────────────────────────────────────────────

def test_schema_cached_on_second_load(mocker):
    open_spy = mocker.patch("app.core.schema_router.open", wraps=open)
    get_schema("restaurant")
    get_schema("restaurant")
    # open should only be called once (second call hits cache)
    assert open_spy.call_count == 1


def test_invalidate_single_tenant_clears_only_that_entry():
    get_schema("restaurant")
    get_schema("hvac")
    invalidate_cache("restaurant")
    from app.core.schema_router import _cache
    assert "restaurant" not in _cache
    assert "hvac" in _cache


def test_invalidate_all_clears_everything():
    get_schema("restaurant")
    get_schema("hvac")
    invalidate_cache()
    from app.core.schema_router import _cache
    assert len(_cache) == 0


# ── Convenience helpers ────────────────────────────────────────────────────────

def test_get_system_prompt_returns_string():
    prompt = get_system_prompt("restaurant")
    assert isinstance(prompt, str)
    assert len(prompt) > 50


def test_get_validation_rules_returns_dict():
    rules = get_validation_rules("restaurant")
    assert isinstance(rules, dict)
    assert "cold_holding_max_f" in rules
    assert rules["cold_holding_max_f"] == 41


def test_get_alert_thresholds_has_critical_warning_info():
    thresholds = get_alert_thresholds("restaurant")
    assert "critical" in thresholds
    assert "warning" in thresholds
    assert "info" in thresholds
    assert isinstance(thresholds["critical"], list)


def test_get_required_daily_checks_returns_list():
    checks = get_required_daily_checks("restaurant")
    assert isinstance(checks, list)
    assert len(checks) > 0


# ── Validate all schemas have required fields ──────────────────────────────────

@pytest.mark.parametrize("tenant_type", VALID_TENANT_TYPES)
def test_all_schemas_have_required_fields(tenant_type):
    schema = get_schema(tenant_type)
    required = [
        "tenant_type",
        "version",
        "regulatory_source",
        "ai_system_prompt",
        "photo_analysis_prompt",
        "validation_rules",
        "alert_thresholds",
        "required_daily_checks",
    ]
    for field in required:
        assert field in schema, f"Schema '{tenant_type}' missing field '{field}'"


@pytest.mark.parametrize("tenant_type", VALID_TENANT_TYPES)
def test_all_schemas_have_retention_years(tenant_type):
    schema = get_schema(tenant_type)
    assert "retention_years" in schema
    assert isinstance(schema["retention_years"], int)
