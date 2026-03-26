import os
from celery import Celery
from celery.schedules import crontab

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
        # Per cost rules: batch low-value jobs every 4 hours instead of real-time
        "batch-pending-jobs-every-4h": {
            "task": "tasks.batch_process_pending_jobs",
            "schedule": 4 * 60 * 60,
        },
        # KPI tracking: alert if false positive rate > 5%
        "check-fp-rate-daily": {
            "task": "tasks.check_false_positive_rate",
            "schedule": 24 * 60 * 60,
        },
        # Housekeeping: delete acknowledged alerts older than 90 days
        "cleanup-old-alerts-nightly": {
            "task": "tasks.cleanup_old_alerts",
            "schedule": 24 * 60 * 60,
        },
        # Priority 4: "You Forgot Something" — 10 PM UTC daily
        # Checks required_daily_checks from niche schema; texts owner if any missing
        "daily-check-reminder-10pm": {
            "task": "tasks.send_daily_check_reminders",
            "schedule": crontab(hour=22, minute=0),
        },
        # Priority 7: "Money You Almost Lost" — Every Friday at 18:00 UTC (noon CDT)
        # Weekly digest email with jobs, leaks caught, revenue recovered
        "weekly-money-email-friday": {
            "task": "tasks.send_weekly_money_email",
            "schedule": crontab(hour=18, minute=0, day_of_week=5),
        },
    },
)
