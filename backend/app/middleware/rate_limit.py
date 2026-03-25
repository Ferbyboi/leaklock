"""Simple in-memory rate limiter for webhook endpoints."""
from __future__ import annotations

import time
from collections import defaultdict
from fastapi import Request, HTTPException


class RateLimiter:
    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

    def check(self, key: str) -> bool:
        now = time.time()
        self._cleanup(key, now)
        if len(self._requests[key]) >= self.max_requests:
            return False
        self._requests[key].append(now)
        return True


webhook_limiter = RateLimiter(max_requests=60, window_seconds=60)


async def rate_limit_webhooks(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    if not webhook_limiter.check(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests")
