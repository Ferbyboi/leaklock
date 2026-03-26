import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "leaklock",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.workers.tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    task_default_queue="default",
    # Retry broker connection on startup instead of hard-failing (Celery 6+)
    broker_connection_retry_on_startup=True,
    # Cap result TTL to 1 day — don't bloat Redis with old task results
    result_expires=86400,
    # ── Celery Beat periodic schedule ─────────────────────────────────────────
    # Per cost rules: batch low-value jobs every 4 hours instead of real-time.
    beat_schedule={
        "batch-pending-jobs-every-4h": {
            "task": "tasks.batch_process_pending_jobs",
            "schedule": 4 * 60 * 60,  # every 4 hours
        },
        "check-fp-rate-daily": {
            "task": "tasks.check_false_positive_rate",
            "schedule": 24 * 60 * 60,  # every 24 hours
        },
        "cleanup-old-alerts-nightly": {
            "task": "tasks.cleanup_old_alerts",
            "schedule": 24 * 60 * 60,  # every 24 hours
        },
    },
)
