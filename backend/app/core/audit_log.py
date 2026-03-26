"""Audit log writer — append-only record of destructive operations.

Every state-changing action (approve, freeze, remove member, review reconciliation)
gets logged here. The audit_log table has triggers preventing UPDATE and DELETE.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import sentry_sdk

from app.db import get_db

logger = logging.getLogger(__name__)


def log_action(
    tenant_id: str,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Append an audit log entry. Never raises — failures are logged to Sentry."""
    try:
        db = get_db()
        db.table("audit_log").insert({
            "tenant_id": tenant_id,
            "actor_id": actor_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "metadata": metadata or {},
        }).execute()
    except Exception as exc:
        logger.error("Failed to write audit log: %s", exc)
        sentry_sdk.capture_exception(exc)
