"""
Single-User Live Location Tracking — Telegram Mini App backend.

Concept: this is NOT a multi-user location-sharing map. There is exactly
ONE admin (configured via ADMIN_TELEGRAM_ID). Every guest who opens the
bio-link sees a READ-ONLY map showing:
  - the admin's current (or last-known, if offline) position
  - a set of static points the admin has placed (Uy, Ishxona, Qahvaxona...)

Guests never send their own location and never see admin controls.

Endpoints:
- GET  /api/role                     -> tells the frontend whether telegram_id is the admin
- GET  /api/public-location          -> open to everyone: admin position + static points
- POST /api/admin/update-location    -> admin only: push a new GPS fix
- POST /api/admin/add-point          -> admin only: create a static point
- PUT  /api/admin/update-point/{id}  -> admin only: edit a static point
- DELETE /api/admin/delete-point/{id}-> admin only: remove a static point
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import AdminState, CustomLocation
from telegram_auth import InitDataValidationError, validate_init_data

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID", "")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]

# Admin is considered "online" if their last GPS push was within this window.
ONLINE_THRESHOLD_SECONDS = 30

if not ADMIN_TELEGRAM_ID:
    print("WARNING: ADMIN_TELEGRAM_ID is not set — no admin actions will be accepted.")
if not BOT_TOKEN:
    print(
        "WARNING: BOT_TOKEN is not set — Telegram initData signature CANNOT be verified. "
        "Falling back to trusting the raw telegram_id field, which is spoofable in production."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    # Ensure the single AdminState row (id=1) always exists.
    db = next(get_db())
    try:
        if not db.query(AdminState).filter(AdminState.id == 1).first():
            db.add(AdminState(id=1, latitude=None, longitude=None, last_seen=None, is_online=False))
            db.commit()
    finally:
        db.close()

    yield


app = FastAPI(title="Single-Admin Live Location API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AuthFields(BaseModel):
    telegram_id: str
    # Raw window.Telegram.WebApp.initData — required in production for real
    # signature verification. Optional only to allow local curl testing.
    init_data: Optional[str] = None


class UpdateLocationPayload(AuthFields):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class AddPointPayload(AuthFields):
    title: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    icon_type: str = "pin"


class UpdatePointPayload(AuthFields):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    icon_type: Optional[str] = None


class DeletePointPayload(AuthFields):
    pass


# ---------------------------------------------------------------------------
# Auth helper — shared by every admin-only endpoint
# ---------------------------------------------------------------------------

def authorize_admin(payload: AuthFields) -> None:
    """
    Confirms the request really comes from the single configured admin.

    Preferred path: verify the signed `init_data` against BOT_TOKEN (can't be
    spoofed). Fallback path (local dev only): compare raw telegram_id.
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

    if str(payload.telegram_id) != str(ADMIN_TELEGRAM_ID):
        raise HTTPException(status_code=403, detail="Forbidden: not the admin")


def _serialize_admin(admin: Optional[AdminState]) -> dict:
    is_online = False
    if admin and admin.last_seen:
        last_seen = admin.last_seen
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - last_seen
        is_online = age < timedelta(seconds=ONLINE_THRESHOLD_SECONDS)

    return {
        "latitude": admin.latitude if admin else None,
        "longitude": admin.longitude if admin else None,
        "last_seen": admin.last_seen.isoformat() if admin and admin.last_seen else None,
        "is_online": is_online,
    }


def _serialize_point(p: CustomLocation) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "latitude": p.latitude,
        "longitude": p.longitude,
        "icon_type": p.icon_type,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"status": "ok", "service": "single-admin-location-api"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/role")
def check_role(telegram_id: str):
    """
    Frontend calls this once on load (with the ID it read from
    window.Telegram.WebApp.initDataUnsafe.user.id) to decide which UI to
    render. This is a UX convenience only — every state-changing endpoint
    re-verifies admin identity server-side regardless of what this returns.
    """
    is_admin = bool(ADMIN_TELEGRAM_ID) and str(telegram_id) == str(ADMIN_TELEGRAM_ID)
    return {"role": "admin" if is_admin else "guest"}


@app.get("/api/public-location")
def get_public_location(db: Session = Depends(get_db)):
    """Open to everyone — no auth. Admin's position (or last-known) + all static points."""
    admin = db.query(AdminState).filter(AdminState.id == 1).first()
    points = db.query(CustomLocation).order_by(CustomLocation.created_at.asc()).all()

    return {
        "admin": _serialize_admin(admin),
        "points": [_serialize_point(p) for p in points],
    }


@app.post("/api/admin/update-location")
def update_admin_location(payload: UpdateLocationPayload, db: Session = Depends(get_db)):
    authorize_admin(payload)

    admin = db.query(AdminState).filter(AdminState.id == 1).first()
    if not admin:
        admin = AdminState(id=1)
        db.add(admin)

    admin.latitude = payload.lat
    admin.longitude = payload.lng
    admin.last_seen = datetime.now(timezone.utc)
    admin.is_online = True
    db.commit()
    db.refresh(admin)

    return {"status": "success", "data": _serialize_admin(admin)}


@app.post("/api/admin/add-point", status_code=status.HTTP_201_CREATED)
def add_point(payload: AddPointPayload, db: Session = Depends(get_db)):
    authorize_admin(payload)

    point = CustomLocation(
        title=payload.title,
        description=payload.description,
        latitude=payload.lat,
        longitude=payload.lng,
        icon_type=payload.icon_type,
        created_at=datetime.now(timezone.utc),
    )
    db.add(point)
    db.commit()
    db.refresh(point)

    return {"status": "success", "data": _serialize_point(point)}


@app.put("/api/admin/update-point/{point_id}")
def update_point(point_id: int, payload: UpdatePointPayload, db: Session = Depends(get_db)):
    authorize_admin(payload)

    point = db.query(CustomLocation).filter(CustomLocation.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="Point not found")

    if payload.title is not None:
        point.title = payload.title
    if payload.description is not None:
        point.description = payload.description
    if payload.lat is not None:
        point.latitude = payload.lat
    if payload.lng is not None:
        point.longitude = payload.lng
    if payload.icon_type is not None:
        point.icon_type = payload.icon_type

    db.commit()
    db.refresh(point)

    return {"status": "success", "data": _serialize_point(point)}


@app.delete("/api/admin/delete-point/{point_id}")
def delete_point(point_id: int, payload: DeletePointPayload, db: Session = Depends(get_db)):
    authorize_admin(payload)

    point = db.query(CustomLocation).filter(CustomLocation.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="Point not found")

    db.delete(point)
    db.commit()

    return {"status": "success"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)