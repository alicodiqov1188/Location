"""
Real-time Location Sharing Backend
FastAPI + Redis (+ optional PostgreSQL history logging)

Endpoints:
- POST /api/admin/location   -> Admin (Telegram Mini App) pushes their current location
- GET  /api/admin/location   -> Admin fetches their own last-known location/state
- GET  /api/public/location  -> Public bio-link page polls this to render the map
- GET  /health                -> health check for deploy platforms
"""

import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import redis
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db
from telegram_auth import InitDataValidationError, validate_init_data

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
REDIS_KEY = "admin:location"

if not ADMIN_TELEGRAM_ID:
    print("WARNING: ADMIN_TELEGRAM_ID is not set — no updates will be accepted.")
if not BOT_TOKEN:
    print("WARNING: BOT_TOKEN is not set — Telegram initData signature CANNOT be verified. "
          "Falling back to trusting the raw telegram_id field, which is spoofable.")

# ---------------------------------------------------------------------------
# App lifecycle (optional Postgres pool)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    yield
    await db.close_db()


app = FastAPI(title="Location Sharing API", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

redis_client = redis.from_url(REDIS_URL, decode_responses=True)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class LocationUpdatePayload(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    is_public: bool = True
    telegram_id: str
    # Raw window.Telegram.WebApp.initData string. Optional for local/manual
    # testing, but STRONGLY recommended in production — see _authorize_admin().
    init_data: str | None = None


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _authorize_admin(payload: LocationUpdatePayload) -> None:
    """
    Confirms the request really comes from the configured admin.

    Preferred path: verify the signed `init_data` against BOT_TOKEN and
    compare the user id embedded in it (can't be spoofed).

    Fallback path (only when BOT_TOKEN or init_data isn't provided): compare
    the raw `telegram_id` field directly. This is fine for local development
    but should not be relied on in production, since a caller could send any
    telegram_id they like.
    """
    if not ADMIN_TELEGRAM_ID:
        raise HTTPException(status_code=500, detail="Server misconfigured: ADMIN_TELEGRAM_ID not set")

    if BOT_TOKEN and payload.init_data:
        try:
            data = validate_init_data(payload.init_data, BOT_TOKEN)
        except InitDataValidationError as exc:
            raise HTTPException(status_code=403, detail=f"Invalid Telegram initData: {exc}") from exc

        verified_user_id = str(data.get("user", {}).get("id", ""))
        if verified_user_id != str(ADMIN_TELEGRAM_ID):
            raise HTTPException(status_code=403, detail="Forbidden: not the admin")
        return

    # Fallback — unauthenticated comparison, logged so it's visible in prod logs
    if str(payload.telegram_id) != str(ADMIN_TELEGRAM_ID):
        raise HTTPException(status_code=403, detail="Forbidden: not the admin")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "ok", "service": "location-sharing-api"}


@app.get("/health")
def health():
    try:
        redis_client.ping()
        redis_ok = True
    except redis.RedisError:
        redis_ok = False

    return {
        "status": "ok" if redis_ok else "degraded",
        "redis": redis_ok,
        "postgres_logging": db.is_enabled(),
    }


@app.post("/api/admin/location", status_code=status.HTTP_200_OK)
async def update_admin_location(payload: LocationUpdatePayload):
    _authorize_admin(payload)

    record = {
        "lat": payload.lat,
        "lng": payload.lng,
        "is_public": payload.is_public,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    try:
        redis_client.set(REDIS_KEY, json.dumps(record))
    except redis.RedisError as exc:
        raise HTTPException(status_code=503, detail=f"Storage error: {exc}") from exc

    # Best-effort history log — never fails the request if Postgres is down/unset
    try:
        await db.log_location(payload.lat, payload.lng, payload.is_public)
    except Exception as exc:  # noqa: BLE001 — logging failure must not break the update
        print(f"WARNING: location history logging failed: {exc}")

    return {"status": "success", "data": record}


@app.get("/api/admin/location")
def get_admin_location(telegram_id: str):
    """Lets the admin panel fetch its own last-known state (e.g. to prefill the toggle)."""
    if str(telegram_id) != str(ADMIN_TELEGRAM_ID):
        raise HTTPException(status_code=403, detail="Forbidden: not the admin")

    raw = redis_client.get(REDIS_KEY)
    if raw is None:
        return {"status": "empty"}

    return {"status": "success", "data": json.loads(raw)}


@app.get("/api/public/location")
def get_public_location():
    raw = redis_client.get(REDIS_KEY)

    if raw is None:
        return {"status": "hidden"}

    record = json.loads(raw)

    if not record.get("is_public", False):
        return {"status": "hidden"}

    return {
        "status": "success",
        "data": {
            "lat": record["lat"],
            "lng": record["lng"],
            "updatedAt": record["updatedAt"],
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)