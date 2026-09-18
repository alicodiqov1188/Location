"""
Database models.

AdminState is a SINGLE-ROW table (id is always 1) holding the one admin's
latest known position — this app has exactly one admin, not a user table.

CustomLocation holds the static points the admin places on the map
(Uy, Ishxona, Qahvaxona, etc).
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from database import Base


class AdminState(Base):
    __tablename__ = "admin_state"

    id = Column(Integer, primary_key=True, index=True)  # always 1 — single row
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    last_seen = Column(DateTime, nullable=True)
    is_online = Column(Boolean, default=False)  # raw flag; API recomputes freshness at read time


class CustomLocation(Base):
    __tablename__ = "custom_locations"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    icon_type = Column(String(50), default="pin")  # "home" | "office" | "cafe" | "pin"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))