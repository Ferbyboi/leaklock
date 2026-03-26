"""Pytest configuration — shared fixtures and env setup."""
import os
import pytest

# Set required env vars before any imports touch them
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SENTRY_DSN", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TRIGGER_API_KEY", "test-trigger-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_placeholder")
os.environ.setdefault("STRIPE_WEBHOOK_SECRET", "whsec_placeholder")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("SUPABASE_AUTH_BYPASS", "true")
