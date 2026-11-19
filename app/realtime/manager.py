"""Gerenciador de salas em memória: conexões WS, broadcast, timers e limpeza."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
from collections.abc import Callable
from typing import Any

from starlette.websockets import WebSocket, WebSocketState

from app.game.rules import GameError, Room

log = logging.getLogger(__name__)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 4
EMPTY_ROOM_TTL_S = 10 * 60


def now_ms() -> int:
    return int(time.time() * 1000)


class RoomSession:
    """Uma sala viva: estado puro + conexões + tarefas asyncio."""

    def __init__(self, room: Room) -> None:
        self.room = room
        self.connections: dict[str, WebSocket] = {}
        self.timer_task: asyncio.Task[None] | None = None
        self.cleanup_task: asyncio.Task[None] | None = None
        self.lock = asyncio.Lock()


class RoomManager:
    def __init__(self, clock: Callable[[], int] = now_ms, empty_ttl_s: float = EMPTY_ROOM_TTL_S) -> None:
        self.sessions: dict[str, RoomSession] = {}
        self.clock = clock
        self.empty_ttl_s = empty_ttl_s
        self._rng = random.SystemRandom()

    # ------------------------------------------------------------- salas
    def create_room(self, name: str | None, public: bool) -> Room:
        while True:
            code = "".join(self._rng.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.sessions:
                break
        clean = (name or "").strip()[:40]
        room = Room(code=code, name=clean or f"Sala {code}", public=public)
        session = RoomSession(room)
        self.sessions[code] = session
        self._schedule_cleanup(session)  # sala criada e nunca usada também expira
        return room

    def get(self, code: str) -> RoomSession | None:
        return self.sessions.get(code.upper())

    def public_rooms(self) -> list[dict[str, Any]]:
        return [
            s.room.summary()
            for s in self.sessions.values()
            if s.room.settings.public and s.room.connected_count() > 0
        ]

    # ---------------------------------------------------------- conexões
    async def attach(self, session: RoomSession, player_id: str, name: str, color: str, ws: WebSocket) -> None:
        """Registra a conexão (substituindo uma anterior do mesmo jogador)."""
        session.room.connect(player_id, name, color, self.clock())  # pode levantar GameError
        old = session.connections.get(player_id)
        session.connections[player_id] = ws
        if old is not None and old is not ws:
            with contextlib.suppress(Exception):
                await old.close(code=4000, reason="Conexão substituída")
        if session.cleanup_task is not None:
            session.cleanup_task.cancel()
            session.cleanup_task = None
        await self.after_change(session)

    async def detach(self, session: RoomSession, player_id: str, ws: WebSocket) -> None:
        if session.connections.get(player_id) is not ws:
            return  # conexão já substituída
        del session.connections[player_id]
        session.room.disconnect(player_id, self.clock())
        if not session.connections:
            self._schedule_cleanup(session)
        await self.after_change(session)

    # ------------------------------------------------------------ envio
    async def _send(self, ws: WebSocket, payload: dict[str, Any]) -> None:
        if ws.client_state != WebSocketState.CONNECTED:
            return
        try:
            await ws.send_json(payload)
        except Exception:  # cliente caiu no meio do envio
            log.debug("falha ao enviar para websocket", exc_info=True)

    async def send_error(self, ws: WebSocket, message: str) -> None:
        await self._send(ws, {"type": "error", "message": message})

    async def broadcast_state(self, session: RoomSession) -> None:
        async with session.lock:
            for pid, ws in list(session.connections.items()):
                snap = session.room.snapshot_for(pid)
                snap["server_now"] = self.clock()
                await self._send(ws, snap)

    async def send_to(self, session: RoomSession, player_ids: list[str], payload: dict[str, Any]) -> None:
        async with session.lock:
            for pid in player_ids:
                ws = session.connections.get(pid)
                if ws is not None:
                    await self._send(ws, payload)

    async def after_change(self, session: RoomSession) -> None:
        self._reschedule_timer(session)
        await self.broadcast_state(session)

    # ------------------------------------------------------------ timers
    def _reschedule_timer(self, session: RoomSession) -> None:
        if session.timer_task is not None and session.timer_task is not asyncio.current_task():
            session.timer_task.cancel()
        session.timer_task = None
        wake = session.room.next_wakeup()
        if wake is not None:
            session.timer_task = asyncio.create_task(self._timer(session, wake))

    async def _timer(self, session: RoomSession, wake_at: int) -> None:
        try:
            delay = max(0.0, (wake_at - self.clock()) / 1000)
            await asyncio.sleep(delay)
            session.room.tick(max(self.clock(), wake_at))
            await self.after_change(session)
        except asyncio.CancelledError:
            pass

    def _schedule_cleanup(self, session: RoomSession) -> None:
        if session.cleanup_task is not None:
            session.cleanup_task.cancel()
        try:
            session.cleanup_task = asyncio.get_running_loop().create_task(self._cleanup(session))
        except RuntimeError:  # sem loop (ex.: chamada síncrona em testes)
            session.cleanup_task = None

    async def _cleanup(self, session: RoomSession) -> None:
        try:
            await asyncio.sleep(self.empty_ttl_s)
        except asyncio.CancelledError:
            return
        if not session.connections and self.sessions.get(session.room.code) is session:
            if session.timer_task is not None:
                session.timer_task.cancel()
            del self.sessions[session.room.code]

    # ---------------------------------------------------------- mensagens
    async def handle(self, session: RoomSession, player_id: str, ws: WebSocket, msg: Any) -> None:
        """Processa uma mensagem do cliente; erros vão só para o remetente."""
        from app.api.themes import load_theme  # import tardio evita ciclo
        from starlette.concurrency import run_in_threadpool

        room = session.room
        try:
            if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
                raise GameError("Mensagem inválida.")
            kind = msg["type"]
            now = self.clock()
            if kind == "chat":
                result = room.chat(player_id, msg.get("text"), now)
                await self.send_to(session, result.recipients, result.message)
                return
            if kind == "set_mode":
                room.set_mode(player_id, msg.get("mode"))
            elif kind == "set_settings":
                theme: tuple[str, str] | None = None
                theme_id = msg.get("theme_id")
                if theme_id is not None:
                    room._require_host(player_id)
                    room._require_lobby()
                    data = await run_in_threadpool(load_theme, str(theme_id)) if isinstance(theme_id, str) else None
                    if data is None:
                        raise GameError("Tema não encontrado.")
                    theme = (data.id, data.name)
                room.set_settings(
                    player_id,
                    theme=theme,
                    turn_seconds=msg.get("turn_seconds"),
                    best_of=msg.get("best_of"),
                    public=msg.get("public"),
                )
            elif kind == "join_side":
                room.join_side(player_id, msg.get("side"))
            elif kind in ("start", "next_match"):
                room._require_host(player_id)
                data = await run_in_threadpool(load_theme, room.settings.theme_id)
                if data is None:
                    raise GameError("O tema escolhido não existe mais.")
                if kind == "start":
                    room.start(player_id, data.characters, self.clock())
                else:
                    room.next_match(player_id, data.characters, self.clock())
            elif kind == "ask":
                room.ask(player_id, msg.get("text"), now)
            elif kind == "answer":
                room.answer(player_id, msg.get("answer"), now)
            elif kind == "guess":
                room.guess(player_id, msg.get("character_id"), now)
            elif kind == "flip":
                room.flip(player_id, msg.get("character_id"), bool(msg.get("down")))
            elif kind == "back_to_lobby":
                room.back_to_lobby(player_id)
            else:
                raise GameError("Ação desconhecida.")
        except GameError as exc:
            await self.send_error(ws, exc.message)
            return
        await self.after_change(session)


manager = RoomManager()
