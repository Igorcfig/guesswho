"""Rotas HTTP de salas."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.realtime.manager import manager

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


class CreateRoom(BaseModel):
    name: str | None = None
    public: bool = True


@router.post("", status_code=201)
async def create_room(body: CreateRoom) -> dict[str, str]:
    room = manager.create_room(body.name, body.public)
    return {"code": room.code}


@router.get("")
def list_rooms() -> list[dict[str, Any]]:
    return manager.public_rooms()


@router.get("/{code}")
def get_room(code: str) -> dict[str, Any]:
    session = manager.get(code)
    if session is None:
        raise HTTPException(status_code=404, detail="Sala não encontrada.")
    return {"code": session.room.code, "name": session.room.name, "exists": True}
