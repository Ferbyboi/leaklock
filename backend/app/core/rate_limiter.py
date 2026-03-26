"""Rate limiting via Upstash Redis sliding window."""
import os
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from upstash_redis import Redis
    _redis: Optional[Redis] = None

    def _get_redis() -> Optional[Redis]:
        global _redis
        if _redis is None:
            url = os.getenv("UPSTASH_REDIS_REST_URL")
            token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
            if url and token:
                _redis = Redis(url=url, token=token)
        return _redis

except ImportError:
    logger.warning("upstash-redis not installed — rate limiting disabled")
    def _get_redis():
        return None


class RateLimitExceeded(Exception):
    def __init__(self, channel: str, limit: int, window_seconds: int, retry_after: int):
        self.channel = channel
        self.limit = limit
        self.window_seconds = window_seconds
        self.retry_after = retry_after
        super().__init__(
            f"Rate limit exceeded for {channel}: {limit} per {window_seconds}s. "
            f"Retry after {retry_after}s."
        )


# Limits per channel per tenant
CHANNEL_LIMITS = {
    "sms":   (5,  3600),   # 5 per hour
    "email": (50, 3600),   # 50 per hour
    "slack": (20, 3600),   # 20 per hour
}


def check_rate_limit(tenant_id: str, channel: str) -> dict:
    """
    Sliding window rate limit check. Raises RateLimitExceeded if over limit.
    Returns {"allowed": True, "remaining": N, "reset_at": timestamp} on success.
    """
    redis = _get_redis()
    if redis is None:
        # If Redis not configured, allow all (log warning once)
        return {"allowed": True, "remaining": -1, "reset_at": 0}

    limit, window = CHANNEL_LIMITS.get(channel, (100, 3600))
    key = f"ratelimit:{tenant_id}:{channel}"
    now = int(time.time())
    window_start = now - window

    # Sliding window using sorted set
    pipe = redis.pipeline()
    # Remove old entries outside window
    pipe.zremrangebyscore(key, 0, window_start)
    # Count current entries
    pipe.zcard(key)
    # Add current request
    pipe.zadd(key, {str(now): now})
    # Set TTL
    pipe.expire(key, window)
    results = pipe.execute()

    current_count = results[1]  # count before adding current

    if current_count >= limit:
        # Find oldest entry to calculate retry_after
        oldest = redis.zrange(key, 0, 0, withscores=True)
        retry_after = window
        if oldest:
            oldest_ts = int(oldest[0][1])
            retry_after = max(0, (oldest_ts + window) - now)

        # Remove the entry we just added since we're rejecting
        redis.zrem(key, str(now))

        raise RateLimitExceeded(
            channel=channel,
            limit=limit,
            window_seconds=window,
            retry_after=retry_after,
        )

    return {
        "allowed": True,
        "remaining": limit - current_count - 1,
        "reset_at": now + window,
    }
