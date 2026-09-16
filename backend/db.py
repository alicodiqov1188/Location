"""
Optional PostgreSQL location-history logging.

If DATABASE_URL is not set, every function here becomes a no-op — the app
runs perfectly fine on Redis alone, and `asyncpg` doesn't even need to be
installed. Set DATABASE_URL (and install asyncpg) to enable durable history
logging (e.g. for a "path traveled today" feature later).

`asyncpg` is imported lazily, inside init_db(), so that people who don't
use PostgreSQL logging never need to install it (it requires a C compiler
to build from source on some platforms, e.g. Windows without Build Tools).
"""

import os
from datetime import datetime, timezone
from typing import Optional

DATABASE_URL = os.getenv("DATABASE_URL")

_pool = None  # asyncpg.Pool, once initialized

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS location_logs (
    id SERIAL PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    is_public BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
"""


async def init_db() -> None:
    """Call on app startup. No-op if DATABASE_URL is not configured."""
    global _pool
    if not DATABASE_URL:
        return

    try:
        import asyncpg
    except ImportError:
        print(
            "WARNING: DATABASE_URL is set but the 'asyncpg' package isn't installed. "
            "Run: pip install asyncpg — history logging is disabled until then."
        )
        return

    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _pool.acquire() as conn:
        await conn.execute(CREATE_TABLE_SQL)


async def close_db() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def log_location(lat: float, lng: float, is_public: bool) -> None:
    """Insert a history row. No-op if logging isn't enabled."""
    if not _pool:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO location_logs (lat, lng, is_public, created_at) VALUES ($1, $2, $3, $4)",
            lat,
            lng,
            is_public,
            datetime.now(timezone.utc),
        )


def is_enabled() -> bool:
    return DATABASE_URL is not None