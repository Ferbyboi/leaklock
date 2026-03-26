"""Trigger.dev v3 REST client — triggers durable background tasks.

Usage:
    from app.core.trigger_client import trigger_task

    run_id = await trigger_task(
        task_id="process-jobber-webhook",
        payload={"job_id": "...", "tenant_id": "..."},
        idempotency_key="jobber-evt-abc123",
    )

If TRIGGER_API_KEY is not set, returns None silently (Celery fallback is used).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx
import sentry_sdk

logger = logging.getLogger(__name__)

TRIGGER_API_BASE = os.getenv("TRIGGER_API_URL", "https://api.trigger.dev")


async def trigger_task(
    task_id: str,
    payload: Dict[str, Any],
    idempotency_key: Optional[str] = None,
) -> Optional[str]:
    """Trigger a Trigger.dev task via the REST API.

    Returns the run ID string on success, None if Trigger.dev is not
    configured or the call fails (caller should fall back to Celery).
    """
    api_key = os.getenv("TRIGGER_API_KEY")
    if not api_key:
        return None

    body: Dict[str, Any] = {"payload": payload}
    if idempotency_key:
        body["options"] = {"idempotencyKey": idempotency_key}

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{TRIGGER_API_BASE}/api/v1/tasks/{task_id}/trigger",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
            run_id: str = data.get("id", "")
            logger.info("Trigger.dev task %s enqueued: run_id=%s", task_id, run_id)
            return run_id
    except Exception as exc:
        # Non-fatal — caller falls back to Celery
        logger.warning("Trigger.dev unavailable (%s), falling back to Celery", exc)
        sentry_sdk.capture_exception(exc)
        return None
