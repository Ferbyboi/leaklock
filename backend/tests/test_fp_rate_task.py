"""Tests for the check_false_positive_rate Celery Beat task.

Covers:
- Returns early (alerted=False) when no discrepancy rows in window
- Returns alerted=False when FP rate is within threshold
- Returns alerted=True and fires Slack when FP rate exceeds threshold
- Threshold is configurable via FP_RATE_ALERT_THRESHOLD env var
- Slack is skipped when SLACK_WEBHOOK_URL is not set
- Query uses auditor_action field (not status) to count false positives
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch


def _make_rows(fp_count: int, total: int):
    """Build rows as they come back from the DB: all status=discrepancy,
    fp_count of them have auditor_action=false_positive."""
    rows = [{"status": "discrepancy", "auditor_action": "false_positive"} for _ in range(fp_count)]
    rows += [{"status": "discrepancy", "auditor_action": None} for _ in range(total - fp_count)]
    return rows


def _mock_db_chain(mock_db, rows):
    """Wire up the mock chain for: .select().in_().gte().execute()"""
    (
        mock_db.table.return_value
        .select.return_value
        .in_.return_value
        .gte.return_value
        .execute.return_value
    ) = MagicMock(data=rows)


@patch("app.workers.tasks.get_db")
def test_returns_early_when_no_alerts(mock_get_db):
    mock_db = MagicMock()
    mock_get_db.return_value = mock_db
    _mock_db_chain(mock_db, [])

    from app.workers.tasks import check_false_positive_rate
    result = check_false_positive_rate()

    assert result["total_alerts"] == 0
    assert result["false_positives"] == 0
    assert result["alerted"] is False


@patch("app.workers.tasks.get_db")
def test_no_alert_when_rate_within_threshold(mock_get_db, monkeypatch):
    monkeypatch.setenv("FP_RATE_ALERT_THRESHOLD", "0.05")
    monkeypatch.setenv("POSTHOG_API_KEY", "")

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db
    # 1 FP out of 25 = 4% — under 5% threshold
    _mock_db_chain(mock_db, _make_rows(fp_count=1, total=25))

    from app.workers.tasks import check_false_positive_rate
    result = check_false_positive_rate()

    assert result["false_positives"] == 1
    assert result["total_alerts"] == 25
    assert result["fp_rate"] == pytest.approx(0.04, abs=1e-6)
    assert result["alerted"] is False


@patch("httpx.post")
@patch("app.workers.tasks.get_db")
def test_alert_fires_when_rate_exceeds_threshold(mock_get_db, mock_httpx, monkeypatch):
    monkeypatch.setenv("FP_RATE_ALERT_THRESHOLD", "0.05")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    monkeypatch.setenv("POSTHOG_API_KEY", "")

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db
    # 3 FP out of 10 = 30% — above 5%
    _mock_db_chain(mock_db, _make_rows(fp_count=3, total=10))

    with patch("sentry_sdk.capture_message") as mock_sentry:
        from app.workers.tasks import check_false_positive_rate
        result = check_false_positive_rate()

    assert result["alerted"] is True
    assert result["false_positives"] == 3
    assert result["total_alerts"] == 10
    mock_httpx.assert_called_once()
    slack_text = mock_httpx.call_args[1]["json"]["text"]
    assert "LeakLock FP Rate Alert" in slack_text
    mock_sentry.assert_called_once()


@patch("httpx.post")
@patch("app.workers.tasks.get_db")
def test_slack_skipped_when_no_webhook_url(mock_get_db, mock_httpx, monkeypatch):
    monkeypatch.setenv("FP_RATE_ALERT_THRESHOLD", "0.05")
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("POSTHOG_API_KEY", "")

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db
    # 100% FP rate — definitely over threshold
    _mock_db_chain(mock_db, _make_rows(fp_count=10, total=10))

    with patch("sentry_sdk.capture_message"):
        from app.workers.tasks import check_false_positive_rate
        result = check_false_positive_rate()

    assert result["alerted"] is True
    mock_httpx.assert_not_called()


@patch("app.workers.tasks.get_db")
def test_custom_threshold_respected(mock_get_db, monkeypatch):
    monkeypatch.setenv("FP_RATE_ALERT_THRESHOLD", "0.20")
    monkeypatch.setenv("POSTHOG_API_KEY", "")

    mock_db = MagicMock()
    mock_get_db.return_value = mock_db
    # 3 FP out of 20 = 15% — under 20% custom threshold
    _mock_db_chain(mock_db, _make_rows(fp_count=3, total=20))

    from app.workers.tasks import check_false_positive_rate
    result = check_false_positive_rate()

    assert result["alerted"] is False
