"""WebSocket endpoint /ws/{code}."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.game.rules import GameError
from app.i18n import normalize, tr
from app.realtime.manager import manager

router = APIRouter()

PLAYER_COLORS = ("#FFC93C", "#2EC4B6", "#FF9F5A", "#B8A6FF", "#FF7C9C", "#7EE8DD", "#8A6CFF", "#3A86FF")


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


@router.websocket("/ws/{code}")
async def room_socket(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    session = manager.get(code)
    if session is None:
        await websocket.close(code=4404, reason="Sala não encontrada")
        return

    params = websocket.query_params
    lang = normalize(params.get("lang") or websocket.cookies.get("lang"))
    player_id = params.get("player_id", "")
    if not _valid_uuid(player_id):
        await websocket.send_json({"type": "error", "message": tr("Identificador de jogador inválido.", lang)})
        await websocket.close(code=4400, reason="player_id inválido")
        return
    name = (params.get("name") or "").strip()[:20] or "Jogador"
    color = (params.get("color") or "").upper()
    if color not in PLAYER_COLORS:
        color = PLAYER_COLORS[0]

    try:
        await manager.attach(session, player_id, name, color, websocket, lang)
    except GameError as exc:
        await websocket.send_json({"type": "error", "message": tr(exc.template, lang, **exc.params)})
        await websocket.close(code=4409, reason="Sala cheia")
        return

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                await manager.send_error(websocket, tr("Mensagem inválida.", session.langs.get(player_id)))
                continue
            await manager.handle(session, player_id, websocket, msg)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.detach(session, player_id, websocket)
