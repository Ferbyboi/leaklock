import os
from supabase import create_client, Client

_client: Client | None = None


def get_db() -> Client:
    """Return singleton Supabase service-role client."""
    global _client
    if _client is None:
        _client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"],
        )
    return _client
