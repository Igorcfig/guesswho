"""Pure Guess Who game rules (no I/O).

Every time-dependent operation receives `now` (epoch in ms): the clock is
injected by the caller. Invalid actions raise `GameError` with a pt-BR message.
"""
from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Literal

Side = Literal["A", "B"]
SIDES: tuple[Side, Side] = ("A", "B")

MAX_PLAYERS = 12
TURN_SECONDS_OPTIONS = (30, 45, 60, 90)
BEST_OF_OPTIONS = (1, 3, 5)
WALKOVER_MS = 60_000
CHAT_LIMIT = 5
CHAT_WINDOW_MS = 5_000
QUESTION_MAX = 140
CHAT_MAX = 200

STATUS_LOBBY = "lobby"
STATUS_PLAYING = "playing"
STATUS_MATCH_OVER = "match_over"
STATUS_SERIES_OVER = "series_over"


class GameError(Exception):
    """Invalid action; `message` is shown to the user."""

    def __init__(self, message: str, **params: object) -> None:
        # `template` is the pt-BR source text (translation key in app/i18n.py); `message` is already formatted in pt-BR.
        text = message.format(**params) if params else message
        super().__init__(text)
        self.template = message
        self.params = params
        self.message = text


def other(side: Side) -> Side:
    return "B" if side == "A" else "A"


@dataclass
class Player:
    id: str
    name: str
    color: str
    side: Side | None = None
    connected: bool = True
    wins: int = 0
    chat_times: deque[int] = field(default_factory=deque)


@dataclass
class Settings:
    theme_id: str = "classic"
    theme_name: str = "Clássico"
    turn_seconds: int = 45
    best_of: int = 3
    public: bool = True


@dataclass
class Match:
    number: int
    characters: list[dict[str, str]]
    secrets: dict[Side, str]
    turn_side: Side
    phase: str = "asking"  # asking | answering | over
    asker_id: str | None = None
    answerer_id: str | None = None
    deadline: int | None = None
    pending_question: dict[str, Any] | None = None
    boards: dict[Side, list[str]] = field(default_factory=lambda: {"A": [], "B": []})
    log: list[dict[str, Any]] = field(default_factory=list)
    winner_side: Side | None = None
    # Last asker/answerer of each side (for the rotation).
    last_asker: dict[Side, str | None] = field(default_factory=lambda: {"A": None, "B": None})
    last_answerer: dict[Side, str | None] = field(default_factory=lambda: {"A": None, "B": None})

    def character_ids(self) -> set[str]:
        return {c["id"] for c in self.characters}

    def character_name(self, char_id: str) -> str:
        for c in self.characters:
            if c["id"] == char_id:
                return c["name"]
        return char_id


@dataclass
class ChatResult:
    channel: str  # room | team | spectators
    recipients: list[str]  # ids of the receiving players
    message: dict[str, Any]


class Room:
    """Full state of a room and of the match in progress."""

    def __init__(
        self,
        code: str,
        name: str,
        public: bool = True,
        rng: random.Random | None = None,
    ) -> None:
        self.code = code
        self.name = name
        self.mode: str = "duel"
        self.host_id: str | None = None
        self.status: str = STATUS_LOBBY
        self.settings = Settings(public=public)
        self.players: dict[str, Player] = {}  # insertion order = arrival order
        self.queue: list[str] = []
        self.score: dict[Side, int] = {"A": 0, "B": 0}
        self.series_winner: Side | None = None
        self.match: Match | None = None
        self.match_count = 0
        self.empty_since: dict[Side, int | None] = {"A": None, "B": None}
        self.rng = rng or random.Random()

    # ------------------------------------------------------------------ util
    def _player(self, player_id: str) -> Player:
        p = self.players.get(player_id)
        if p is None:
            raise GameError("Jogador não está na sala.")
        return p

    def _require_host(self, player_id: str) -> None:
        if player_id != self.host_id:
            raise GameError("Só o anfitrião pode fazer isso.")

    def _require_lobby(self) -> None:
        if self.status != STATUS_LOBBY:
            raise GameError("Isso só pode ser feito no lobby.")

    def connected_count(self) -> int:
        return sum(1 for p in self.players.values() if p.connected)

    def side_players(self, side: Side) -> list[Player]:
        return [p for p in self.players.values() if p.side == side]

    def side_connected(self, side: Side) -> list[Player]:
        return [p for p in self.side_players(side) if p.connected]

    def _next_in_rotation(self, side: Side, last_id: str | None) -> str | None:
        """Next connected player on the side, after `last_id` (circular)."""
        members = self.side_players(side)
        if not members:
            return None
        ids = [p.id for p in members]
        start = (ids.index(last_id) + 1) if last_id in ids else 0
        for i in range(len(ids)):
            p = members[(start + i) % len(ids)]
            if p.connected:
                return p.id
        return None

    def _sync_queue(self) -> None:
        """In duel mode, every spectator is in the queue (arrival order preserved)."""
        if self.mode != "duel":
            self.queue = []
            return
        self.queue = [
            pid for pid in self.queue if pid in self.players and self.players[pid].side is None
        ]
        for p in self.players.values():
            if p.side is None and p.id not in self.queue:
                self.queue.append(p.id)

    def _fix_host(self) -> None:
        host = self.players.get(self.host_id) if self.host_id else None
        if host is not None and host.connected:
            return
        for p in self.players.values():
            if p.connected:
                self.host_id = p.id
                return
        if host is None:
            self.host_id = None

    @property
    def playing(self) -> bool:
        return self.status == STATUS_PLAYING and self.match is not None and self.match.phase != "over"

    # --------------------------------------------------------- connections
    def connect(self, player_id: str, name: str, color: str, now: int) -> Player:
        p = self.players.get(player_id)
        if p is None:
            if self.connected_count() >= MAX_PLAYERS:
                raise GameError("A sala está cheia (máximo de 12 pessoas).")
            p = Player(id=player_id, name=name, color=color)
            self.players[player_id] = p
        else:
            if not p.connected and self.connected_count() >= MAX_PLAYERS:
                raise GameError("A sala está cheia (máximo de 12 pessoas).")
            p.name, p.color = name, color
            p.connected = True
        self._fix_host()
        self._sync_queue()
        self._on_presence_change(now)
        return p

    def disconnect(self, player_id: str, now: int) -> None:
        p = self.players.get(player_id)
        if p is None:
            return
        p.connected = False
        self._fix_host()
        self._on_presence_change(now)

    def _on_presence_change(self, now: int) -> None:
        if not self.playing:
            return
        m = self.match
        assert m is not None
        for side in SIDES:
            if self.side_connected(side):
                self.empty_since[side] = None
            elif self.empty_since[side] is None:
                self.empty_since[side] = now
        # Rotation skips whoever dropped (or fills an empty seat when someone comes back).
        asking_side = m.turn_side
        if m.phase == "asking":
            asker = self.players.get(m.asker_id) if m.asker_id else None
            if asker is None or not asker.connected:
                m.asker_id = self._next_in_rotation(asking_side, m.asker_id)
                if m.asker_id:
                    m.last_asker[asking_side] = m.asker_id
        elif m.phase == "answering":
            ans_side = other(asking_side)
            answerer = self.players.get(m.answerer_id) if m.answerer_id else None
            if answerer is None or not answerer.connected:
                m.answerer_id = self._next_in_rotation(ans_side, m.answerer_id)
                if m.answerer_id:
                    m.last_answerer[ans_side] = m.answerer_id

    # --------------------------------------------------------------- lobby
    def set_mode(self, player_id: str, mode: str) -> None:
        self._require_host(player_id)
        self._require_lobby()
        if mode not in ("duel", "team"):
            raise GameError("Modo inválido.")
        self.mode = mode
        if mode == "duel":
            # Keep only the first player of each side; the others become spectators.
            for side in SIDES:
                for extra in self.side_players(side)[1:]:
                    extra.side = None
        self._sync_queue()

    def set_settings(
        self,
        player_id: str,
        *,
        theme: tuple[str, str] | None = None,
        turn_seconds: Any = None,
        best_of: Any = None,
        public: Any = None,
    ) -> None:
        """`theme` = (id, name), already validated by the I/O layer."""
        self._require_host(player_id)
        self._require_lobby()
        if turn_seconds is not None:
            if isinstance(turn_seconds, bool) or turn_seconds not in TURN_SECONDS_OPTIONS:
                raise GameError("Tempo por turno inválido (use 30, 45, 60 ou 90 segundos).")
        if best_of is not None:
            if isinstance(best_of, bool) or best_of not in BEST_OF_OPTIONS:
                raise GameError("Melhor de inválido (use 1, 3 ou 5).")
        if public is not None and not isinstance(public, bool):
            raise GameError("Visibilidade inválida.")
        if theme is not None:
            self.settings.theme_id, self.settings.theme_name = theme
        if turn_seconds is not None:
            self.settings.turn_seconds = int(turn_seconds)
        if best_of is not None:
            self.settings.best_of = int(best_of)
        if public is not None:
            self.settings.public = public

    def join_side(self, player_id: str, side: Any) -> None:
        p = self._player(player_id)
        self._require_lobby()
        if side not in ("A", "B", None):
            raise GameError("Lado inválido.")
        if side is not None and self.mode == "duel" and p.side != side:
            occupants = self.side_players(side)
            if any(o.connected for o in occupants):
                raise GameError("Esse lado já está ocupado.")
            for o in occupants:  # a disconnected occupant loses the seat
                o.side = None
        p.side = side
        self._sync_queue()

    # ---------------------------------------------------------------- match
    def start(self, player_id: str, characters: list[dict[str, str]], now: int) -> None:
        self._require_host(player_id)
        self._require_lobby()
        self._start_match(characters, now)

    def _start_match(self, characters: list[dict[str, str]], now: int) -> None:
        if not all(self.side_connected(s) for s in SIDES):
            raise GameError("É preciso ao menos um jogador conectado em cada lado.")
        if len(characters) < 2:
            raise GameError("O tema precisa de pelo menos 2 personagens.")
        self.match_count += 1
        a, b = self.rng.sample([c["id"] for c in characters], 2)
        first: Side = "A" if self.match_count % 2 == 1 else "B"
        m = Match(
            number=self.match_count,
            characters=[dict(c) for c in characters],
            secrets={"A": a, "B": b},
            turn_side=first,
        )
        if self.match is not None:  # keep the rotation between matches
            m.last_asker = dict(self.match.last_asker)
            m.last_answerer = dict(self.match.last_answerer)
        self.match = m
        self.status = STATUS_PLAYING
        self.empty_since = {"A": None, "B": None}
        self._begin_turn(first, now)

    def _begin_turn(self, side: Side, now: int) -> None:
        m = self.match
        assert m is not None
        m.turn_side = side
        m.phase = "asking"
        m.pending_question = None
        m.answerer_id = None
        m.asker_id = self._next_in_rotation(side, m.last_asker[side])
        if m.asker_id:
            m.last_asker[side] = m.asker_id
        m.deadline = now + self.settings.turn_seconds * 1000

    def _require_phase(self, phase: str) -> Match:
        if not self.playing:
            raise GameError("Não há partida em andamento.")
        m = self.match
        assert m is not None
        if m.phase != phase:
            raise GameError("Não é o momento para isso.")
        return m

    def ask(self, player_id: str, text: Any, now: int) -> None:
        m = self._require_phase("asking")
        if player_id != m.asker_id:
            raise GameError("Não é a sua vez de perguntar.")
        text = text.strip() if isinstance(text, str) else ""
        if not 1 <= len(text) <= QUESTION_MAX:
            raise GameError("A pergunta deve ter entre 1 e {max} caracteres.", max=QUESTION_MAX)
        m.pending_question = {"text": text, "asker_id": player_id}
        m.phase = "answering"
        ans_side = other(m.turn_side)
        m.answerer_id = self._next_in_rotation(ans_side, m.last_answerer[ans_side])
        if m.answerer_id:
            m.last_answerer[ans_side] = m.answerer_id
        m.deadline = now + self.settings.turn_seconds * 1000

    def answer(self, player_id: str, answer: Any, now: int) -> None:
        m = self._require_phase("answering")
        if player_id != m.answerer_id:
            raise GameError("Não é a sua vez de responder.")
        if answer not in ("yes", "no"):
            raise GameError("Resposta inválida.")
        self._log_question(answer, now)
        self._begin_turn(other(m.turn_side), now)

    def _log_question(self, answer: str | None, now: int) -> None:
        m = self.match
        assert m is not None and m.pending_question is not None
        m.log.append({
            "kind": "question",
            "side": m.turn_side,
            "player_id": m.pending_question["asker_id"],
            "text": m.pending_question["text"],
            "answer": answer,
            "correct": None,
            "ts": now,
        })

    def guess(self, player_id: str, character_id: Any, now: int) -> None:
        m = self._require_phase("asking")
        if player_id != m.asker_id:
            raise GameError("Não é a sua vez de chutar.")
        if not isinstance(character_id, str) or character_id not in m.character_ids():
            raise GameError("Personagem inválido.")
        side = m.turn_side
        correct = character_id == m.secrets[other(side)]
        m.log.append({
            "kind": "guess",
            "side": side,
            "player_id": player_id,
            "text": m.character_name(character_id),
            "answer": None,
            "correct": correct,
            "ts": now,
        })
        self._finish(side if correct else other(side))

    def flip(self, player_id: str, character_id: Any, down: Any) -> None:
        p = self._player(player_id)
        if not self.playing:
            raise GameError("Não há partida em andamento.")
        if p.side is None:
            raise GameError("Observadores não podem virar cartas.")
        m = self.match
        assert m is not None
        if not isinstance(character_id, str) or character_id not in m.character_ids():
            raise GameError("Personagem inválido.")
        board = m.boards[p.side]
        if down and character_id not in board:
            board.append(character_id)
        elif not down and character_id in board:
            board.remove(character_id)

    def _finish(self, winner: Side) -> None:
        m = self.match
        assert m is not None
        m.phase = "over"
        m.winner_side = winner
        m.deadline = None
        m.pending_question = None
        m.answerer_id = None
        self.empty_since = {"A": None, "B": None}
        self.score[winner] += 1
        if self.mode == "duel":
            for p in self.side_players(winner):
                p.wins += 1
            self.status = STATUS_MATCH_OVER
        elif self.score[winner] >= self.settings.best_of // 2 + 1:
            self.status = STATUS_SERIES_OVER
            self.series_winner = winner
        else:
            self.status = STATUS_MATCH_OVER

    def next_match(self, player_id: str, characters: list[dict[str, str]], now: int) -> None:
        self._require_host(player_id)
        if self.status != STATUS_MATCH_OVER:
            raise GameError("A próxima partida só pode começar ao fim de uma partida.")
        if self.mode == "duel":
            self._rotate_duel()
        self._start_match(characters, now)

    def _rotate_duel(self) -> None:
        """The loser goes to the end of the queue; the first connected player in the queue takes the side."""
        m = self.match
        assert m is not None and m.winner_side is not None
        self._sync_queue()
        waiting = [pid for pid in self.queue if self.players[pid].connected]
        loser_side = other(m.winner_side)
        if waiting:
            for loser in self.side_players(loser_side):
                loser.side = None
                self.queue.append(loser.id)
            newcomer = self.players[waiting.pop(0)]
            newcomer.side = loser_side
            self.queue.remove(newcomer.id)
        # A winning side with nobody connected is also filled from the queue.
        for side in SIDES:
            if not self.side_connected(side) and waiting:
                for gone in self.side_players(side):
                    gone.side = None
                    self.queue.append(gone.id)
                newcomer = self.players[waiting.pop(0)]
                newcomer.side = side
                self.queue.remove(newcomer.id)
        self._sync_queue()

    def back_to_lobby(self, player_id: str) -> None:
        self._require_host(player_id)
        if self.status not in (STATUS_MATCH_OVER, STATUS_SERIES_OVER):
            raise GameError("Só é possível voltar ao lobby ao fim de uma partida.")
        self.status = STATUS_LOBBY
        self.match = None
        self.match_count = 0
        self.score = {"A": 0, "B": 0}
        self.series_winner = None
        self.empty_since = {"A": None, "B": None}

    # ---------------------------------------------------------------- clock
    def next_wakeup(self) -> int | None:
        """Next instant (ms) at which `tick` may change something."""
        if not self.playing:
            return None
        m = self.match
        assert m is not None
        times = [t + WALKOVER_MS for t in self.empty_since.values() if t is not None]
        if m.deadline is not None:
            times.append(m.deadline)
        return min(times) if times else None

    def tick(self, now: int) -> bool:
        """Apply expired timeouts and walkovers. Return True if anything changed."""
        changed = False
        while self.playing:
            m = self.match
            assert m is not None
            # Walkover: a side with nobody connected for 60 s.
            expired = [
                s for s in SIDES
                if self.empty_since[s] is not None and now - self.empty_since[s] >= WALKOVER_MS
            ]
            if expired:
                loser = min(expired, key=lambda s: self.empty_since[s] or 0)
                self._finish(other(loser))
                return True
            if m.deadline is None or now < m.deadline:
                break
            deadline = m.deadline
            if m.phase == "asking":
                m.log.append({
                    "kind": "timeout",
                    "side": m.turn_side,
                    "player_id": m.asker_id,
                    "text": None,
                    "answer": None,
                    "correct": None,
                    "ts": deadline,
                })
            else:
                self._log_question(None, deadline)
            # Chain from the deadline (for late ticks).
            self._begin_turn(other(m.turn_side), deadline)
            changed = True
        return changed

    # ---------------------------------------------------------------- chat
    def chat(self, player_id: str, text: Any, now: int) -> ChatResult:
        p = self._player(player_id)
        text = text.strip() if isinstance(text, str) else ""
        if not 1 <= len(text) <= CHAT_MAX:
            raise GameError("A mensagem deve ter entre 1 e {max} caracteres.", max=CHAT_MAX)
        while p.chat_times and now - p.chat_times[0] >= CHAT_WINDOW_MS:
            p.chat_times.popleft()
        if len(p.chat_times) >= CHAT_LIMIT:
            raise GameError("Calma! Você está enviando mensagens rápido demais.")
        p.chat_times.append(now)
        if self.status == STATUS_PLAYING:
            if p.side is not None:
                channel = "team"
                recipients = [q.id for q in self.side_players(p.side)]
            else:
                channel = "spectators"
                recipients = [q.id for q in self.players.values() if q.side is None]
        else:
            channel = "room"
            recipients = list(self.players)
        msg = {
            "type": "chat",
            "channel": channel,
            "player_id": p.id,
            "name": p.name,
            "color": p.color,
            "text": text,
            "ts": now,
        }
        return ChatResult(channel=channel, recipients=recipients, message=msg)

    # ------------------------------------------------------------ snapshot
    def snapshot_for(self, player_id: str) -> dict[str, Any]:
        viewer = self.players.get(player_id)
        side = viewer.side if viewer else None
        snap: dict[str, Any] = {
            "type": "state",
            "you": {
                "player_id": player_id,
                "side": side,
                "is_host": player_id == self.host_id,
                "role": "player" if side else "spectator",
            },
            "room": {
                "code": self.code,
                "name": self.name,
                "mode": self.mode,
                "host_id": self.host_id,
                "status": self.status,
                "settings": {
                    "theme_id": self.settings.theme_id,
                    "theme_name": self.settings.theme_name,
                    "turn_seconds": self.settings.turn_seconds,
                    "best_of": self.settings.best_of,
                    "public": self.settings.public,
                },
            },
            "players": [
                {
                    "id": p.id,
                    "name": p.name,
                    "color": p.color,
                    "side": p.side,
                    "connected": p.connected,
                    "is_host": p.id == self.host_id,
                    "wins": p.wins,
                }
                for p in self.players.values()
            ],
            "queue": list(self.queue),
            "score": dict(self.score),
            "series_winner": self.series_winner,
            "match": None,
        }
        m = self.match
        if m is not None:
            reveal_all = side is None or m.phase == "over"
            visible: tuple[Side, ...] = SIDES if reveal_all else (side,)  # type: ignore[assignment]
            snap["match"] = {
                "number": m.number,
                "characters": [dict(c) for c in m.characters],
                "turn_side": m.turn_side,
                "phase": m.phase,
                "asker_id": m.asker_id,
                "answerer_id": m.answerer_id,
                "deadline": m.deadline,
                "pending_question": dict(m.pending_question) if m.pending_question else None,
                "boards": {s: {"down": list(m.boards[s])} for s in visible},
                # How many cards each side has flipped (without revealing which).
                "down_counts": {s: len(m.boards[s]) for s in SIDES},
                "secrets": {s: m.secrets[s] for s in visible},
                "log": [dict(e) for e in m.log],
                "winner_side": m.winner_side,
            }
        return snap

    # -------------------------------------------------------------- summary
    def summary(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "mode": self.mode,
            "theme_id": self.settings.theme_id,
            "theme_name": self.settings.theme_name,
            "players": self.connected_count(),
            "max_players": MAX_PLAYERS,
            "status": STATUS_LOBBY if self.status == STATUS_LOBBY else "playing",
        }
