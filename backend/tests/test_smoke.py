"""Smoke tests — catch import errors, app startup issues, and known regressions."""

import ast
import importlib
import pathlib

import pytest

# ---------------------------------------------------------------------------
# 1. Every router, connector, and core module must be importable
# ---------------------------------------------------------------------------

_MODULES = [
    # routers
    "app.routers.alerts",
    "app.routers.billing",
    "app.routers.diagnostic",
    "app.routers.insurance_letter",
    "app.routers.jobs",
    "app.routers.notifications",
    "app.routers.ocr",
    "app.routers.onboarding",
    "app.routers.push",
    "app.routers.reconciliation",
    "app.routers.reports",
    "app.routers.team",
    "app.routers.twilio_sms",
    "app.routers.webhooks",
    "app.routers.webhooks_jobber",
    # connectors
    "app.connectors.housecallpro",
    "app.connectors.job_ingestion",
    "app.connectors.oauth",
    "app.connectors.servicetitan",
    "app.connectors.square",
    "app.connectors.toast",
    "app.connectors.webhook_normalizer",
    # core
    "app.core.alert_engine",
    "app.core.audit_log",
    "app.core.claude_client",
    "app.core.match_engine",
    "app.core.notification_service",
    "app.core.plan_gate",
    "app.core.rate_limiter",
    "app.core.schema_router",
    "app.core.trigger_client",
]


@pytest.mark.parametrize("module_name", _MODULES)
def test_all_routers_importable(module_name):
    """Every router/connector/core module imports without error."""
    importlib.import_module(module_name)


# ---------------------------------------------------------------------------
# 2. The FastAPI app object can be created and responds to requests
# ---------------------------------------------------------------------------


def test_app_creates():
    """TestClient can be created and the app object is a FastAPI instance."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.main import app

    assert isinstance(app, FastAPI)
    client = TestClient(app, raise_server_exceptions=False)
    # GET a route that should exist; even a 401/403 proves the app started
    resp = client.get("/health")
    # Accept any non-500 as proof the app boots (health may not exist yet)
    if resp.status_code == 404:
        # No /health route — just verify the app booted without crash
        pass
    else:
        assert resp.status_code < 500


# ---------------------------------------------------------------------------
# 3. Regression guard: no "now()" string literals passed to Supabase REST API
#    (the REST API stores it as the literal text "now()" instead of calling
#    SQL now()).
# ---------------------------------------------------------------------------

_BACKEND_APP_DIR = pathlib.Path(__file__).resolve().parent.parent / "app"


def _collect_python_files(directory: pathlib.Path):
    return list(directory.rglob("*.py"))


def test_no_now_string_literals():
    """No Python file should contain the string literal 'now()'.

    Supabase REST API stores it verbatim instead of evaluating SQL now().
    Use datetime.utcnow().isoformat() or database defaults instead.
    """
    violations = []
    for py_file in _collect_python_files(_BACKEND_APP_DIR):
        source = py_file.read_text(encoding="utf-8", errors="ignore")
        try:
            tree = ast.parse(source, filename=str(py_file))
        except SyntaxError:
            continue  # caught by test_all_routers_importable
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and node.value == "now()":
                violations.append(f"{py_file.relative_to(_BACKEND_APP_DIR)}:{node.lineno}")
    assert violations == [], (
        f"Found 'now()' string literal (Supabase bug) in: {violations}"
    )


# ---------------------------------------------------------------------------
# 4. Regression guard: scope.capture_exception → sentry_sdk.capture_exception
# ---------------------------------------------------------------------------


def test_no_scope_capture_exception():
    """No file should use scope.capture_exception — use sentry_sdk.capture_exception."""
    violations = []
    for py_file in _collect_python_files(_BACKEND_APP_DIR):
        source = py_file.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(source.splitlines(), start=1):
            if "scope.capture_exception" in line:
                violations.append(f"{py_file.relative_to(_BACKEND_APP_DIR)}:{lineno}")
    assert violations == [], (
        f"Found scope.capture_exception (use sentry_sdk.capture_exception): {violations}"
    )
