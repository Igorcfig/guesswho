"""Persistent models: custom themes and their characters."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid_hex() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class Theme(Base):
    __tablename__ = "themes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid_hex)
    name: Mapped[str] = mapped_column(String(40))
    author: Mapped[str] = mapped_column(String(20))
    public: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    characters: Mapped[list[Character]] = relationship(
        back_populates="theme",
        order_by="Character.position",
        cascade="all, delete-orphan",
    )


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid_hex)
    theme_id: Mapped[str] = mapped_column(ForeignKey("themes.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(20))
    image_url: Mapped[str] = mapped_column(String(255))

    theme: Mapped[Theme] = relationship(back_populates="characters")
