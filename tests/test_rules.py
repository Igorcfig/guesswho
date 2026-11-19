"""Testes das regras puras (relógio injetado via `now`)."""
from __future__ import annotations

import random

import pytest

from app.classic import CLASSIC_CHARACTERS
from app.game.rules import WALKOVER_MS, GameError, Room

CHARS = CLASSIC_CHARACTERS
T0 = 1_000_000


def make_room(mode: str = "duel", best_of: int = 3, players: dict[str, str | None] | None = None) -> Room:
    room = Room("ABCD", "Sala ABCD", rng=random.Random(42))
    players = players or {"a1": "A", "b1": "B"}
    for pid in players:
        room.connect(pid, pid.upper(), "#FFC93C", T0)
    host = next(iter(players))
    room.set_mode(host, mode)
    room.set_settings(host, best_of=best_of, turn_seconds=30)
    for pid, side in players.items():
        if side:
            room.join_side(pid, side)
    return room


def secret_guessed_by(room: Room, side: str) -> str:
    other = "B" if side == "A" else "A"
    assert room.match
    return room.match.secrets[other]  # type: ignore[index]


def wrong_char(room: Room, side: str) -> str:
    target = secret_guessed_by(room, side)
    return next(c["id"] for c in CHARS if c["id"] != target)


def test_first_player_is_host_and_host_only_actions():
    room = make_room()
    assert room.host_id == "a1"
    with pytest.raises(GameError, match="anfitrião"):
        room.set_mode("b1", "team")
    with pytest.raises(GameError):
        room.start("b1", CHARS, T0)


def test_start_requires_both_sides():
    room = make_room(players={"a1": "A", "b1": None})
    with pytest.raises(GameError, match="cada lado"):
        room.start("a1", CHARS, T0)


def test_start_match_sets_distinct_secrets_and_turn():
    room = make_room()
    room.start("a1", CHARS, T0)
    m = room.match
    assert m and room.status == "playing"
    assert m.secrets["A"] != m.secrets["B"]
    assert m.turn_side == "A" and m.phase == "asking"
    assert m.asker_id == "a1"
    assert m.deadline == T0 + 30_000
    assert m.boards == {"A": [], "B": []}


def test_ask_answer_passes_turn():
    room = make_room()
    room.start("a1", CHARS, T0)
    with pytest.raises(GameError):
        room.ask("b1", "Usa óculos?", T0)
    room.ask("a1", "Usa óculos?", T0 + 1000)
    m = room.match
    assert m and m.phase == "answering" and m.answerer_id == "b1"
    assert m.deadline == T0 + 31_000
    with pytest.raises(GameError):
        room.answer("a1", "yes", T0)
    with pytest.raises(GameError):
        room.answer("b1", "talvez", T0)
    room.answer("b1", "yes", T0 + 2000)
    assert m.turn_side == "B" and m.phase == "asking" and m.asker_id == "b1"
    assert m.log[-1]["kind"] == "question" and m.log[-1]["answer"] == "yes"
    assert m.log[-1]["text"] == "Usa óculos?"


def test_question_length_validation():
    room = make_room()
    room.start("a1", CHARS, T0)
    with pytest.raises(GameError):
        room.ask("a1", "   ", T0)
    with pytest.raises(GameError):
        room.ask("a1", "x" * 141, T0)


def test_team_rotation_skips_disconnected():
    room = make_room("team", players={"a1": "A", "a2": "A", "a3": "A", "b1": "B", "b2": "B"})
    room.start("a1", CHARS, T0)
    m = room.match
    assert m
    seen_askers = []
    seen_answerers = []
    for i in range(6):
        if m.turn_side == "A":
            seen_askers.append(m.asker_id)
        room.ask(m.asker_id, "Pergunta?", T0 + i)
        if m.turn_side == "A":
            seen_answerers.append(m.answerer_id)
        room.answer(m.answerer_id, "no", T0 + i)
    assert seen_askers == ["a1", "a2", "a3"]
    assert seen_answerers == ["b1", "b2", "b1"]
    # A da vez de novo: perguntador seria a1; ele cai e o rodízio pula.
    assert m.turn_side == "A" and m.asker_id == "a1"
    room.disconnect("a1", T0 + 10)
    assert m.asker_id == "a2"


def test_answerer_disconnect_moves_to_other():
    room = make_room("team", players={"a1": "A", "b1": "B", "b2": "B"})
    room.start("a1", CHARS, T0)
    room.ask("a1", "Pergunta?", T0)
    assert room.match and room.match.answerer_id == "b1"
    room.disconnect("b1", T0 + 1)
    assert room.match.answerer_id == "b2"


def test_timeout_in_asking_and_answering():
    room = make_room()
    room.start("a1", CHARS, T0)
    m = room.match
    assert m
    assert room.next_wakeup() == T0 + 30_000
    assert not room.tick(T0 + 29_999)
    assert room.tick(T0 + 30_000)
    assert m.log[-1]["kind"] == "timeout" and m.log[-1]["side"] == "A"
    assert m.turn_side == "B" and m.deadline == T0 + 60_000
    room.ask("b1", "Tem barba?", T0 + 31_000)
    assert room.tick(T0 + 61_000)
    assert m.log[-1]["kind"] == "question" and m.log[-1]["answer"] is None
    assert m.turn_side == "A"


def test_late_tick_chains_multiple_timeouts():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.tick(T0 + 95_000)
    m = room.match
    assert m and [e["kind"] for e in m.log] == ["timeout", "timeout", "timeout"]
    assert m.turn_side == "B" and m.deadline == T0 + 120_000


def test_correct_guess_wins_duel():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.guess("a1", secret_guessed_by(room, "A"), T0 + 1)
    m = room.match
    assert m and m.phase == "over" and m.winner_side == "A"
    assert m.log[-1]["kind"] == "guess" and m.log[-1]["correct"] is True
    assert room.score == {"A": 1, "B": 0}
    assert room.players["a1"].wins == 1
    assert room.status == "match_over"
    assert room.next_wakeup() is None


def test_wrong_guess_gives_win_to_other_side():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.guess("a1", wrong_char(room, "A"), T0 + 1)
    assert room.match and room.match.winner_side == "B"
    assert room.players["b1"].wins == 1


def test_guess_only_in_asking_by_asker():
    room = make_room()
    room.start("a1", CHARS, T0)
    with pytest.raises(GameError):
        room.guess("b1", "ana", T0)
    with pytest.raises(GameError):
        room.guess("a1", "nao-existe", T0)
    room.ask("a1", "?", T0)
    with pytest.raises(GameError):
        room.guess("a1", "ana", T0)


def test_team_series_best_of_3_and_alternating_start():
    room = make_room("team", best_of=3, players={"a1": "A", "b1": "B"})
    room.start("a1", CHARS, T0)
    assert room.match and room.match.turn_side == "A"
    room.guess("a1", secret_guessed_by(room, "A"), T0)
    assert room.status == "match_over" and room.score["A"] == 1
    room.next_match("a1", CHARS, T0)
    assert room.match.number == 2 and room.match.turn_side == "B"
    assert room.match.boards == {"A": [], "B": []}
    room.guess("b1", wrong_char(room, "B"), T0)  # B erra → A vence
    assert room.status == "series_over" and room.series_winner == "A"
    assert room.score == {"A": 2, "B": 0}
    assert room.players["a1"].wins == 0  # wins só no duelo
    with pytest.raises(GameError):
        room.next_match("a1", CHARS, T0)
    room.back_to_lobby("a1")
    assert room.status == "lobby" and room.score == {"A": 0, "B": 0}
    assert room.match is None and room.series_winner is None
    room.start("a1", CHARS, T0)
    assert room.match.number == 1 and room.match.turn_side == "A"


def test_best_of_1_ends_series_immediately():
    room = make_room("team", best_of=1, players={"a1": "A", "b1": "B"})
    room.start("a1", CHARS, T0)
    room.guess("a1", wrong_char(room, "A"), T0)
    assert room.status == "series_over" and room.series_winner == "B"


def test_duel_queue_and_rotation():
    room = make_room(players={"a1": "A", "b1": "B", "s1": None, "s2": None})
    assert room.queue == ["s1", "s2"]
    with pytest.raises(GameError, match="ocupado"):
        room.join_side("s1", "A")
    room.start("a1", CHARS, T0)
    room.guess("a1", wrong_char(room, "A"), T0)  # A perde
    room.next_match("a1", CHARS, T0)
    assert room.players["s1"].side == "A"
    assert room.players["a1"].side is None
    assert room.queue == ["s2", "a1"]
    assert room.status == "playing"
    # s1 (lado A) perde de novo; s2 entra.
    room.guess(room.match.asker_id, secret_guessed_by(room, room.match.turn_side), T0)
    winner = room.match.winner_side
    assert winner == "B"  # partida 2 começa com B
    room.next_match("a1", CHARS, T0)
    assert room.players["s2"].side == "A" and room.queue == ["a1", "s1"]


def test_duel_empty_queue_same_players():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.guess("a1", wrong_char(room, "A"), T0)
    room.next_match("a1", CHARS, T0)
    assert room.players["a1"].side == "A" and room.players["b1"].side == "B"


def test_duel_skips_disconnected_in_queue():
    room = make_room(players={"a1": "A", "b1": "B", "s1": None, "s2": None})
    room.disconnect("s1", T0)
    room.start("a1", CHARS, T0)
    room.guess("a1", secret_guessed_by(room, "A"), T0)  # B perde
    room.next_match("a1", CHARS, T0)
    assert room.players["s2"].side == "B"
    assert room.players["s1"].side is None


def test_new_player_mid_game_is_spectator_in_queue():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.connect("late", "Late", "#2EC4B6", T0)
    assert room.players["late"].side is None
    assert room.queue == ["late"]


def test_set_mode_duel_trims_sides():
    room = make_room("team", players={"a1": "A", "a2": "A", "b1": "B"})
    assert room.queue == []
    room.set_mode("a1", "duel")
    assert room.players["a2"].side is None and room.queue == ["a2"]


def test_settings_validation():
    room = make_room()
    with pytest.raises(GameError):
        room.set_settings("a1", turn_seconds=10)
    with pytest.raises(GameError):
        room.set_settings("a1", best_of=2)
    with pytest.raises(GameError):
        room.set_settings("a1", public="sim")
    room.set_settings("a1", turn_seconds=90, best_of=5, public=False, theme=("x", "Meu tema"))
    s = room.settings
    assert (s.turn_seconds, s.best_of, s.public, s.theme_id, s.theme_name) == (90, 5, False, "x", "Meu tema")


def test_flip_only_own_board():
    room = make_room(players={"a1": "A", "b1": "B", "s1": None})
    room.start("a1", CHARS, T0)
    room.flip("a1", "ana", True)
    room.flip("a1", "bruno", True)
    room.flip("a1", "ana", False)
    assert room.match.boards == {"A": ["bruno"], "B": []}
    with pytest.raises(GameError):
        room.flip("s1", "ana", True)


def test_snapshot_visibility():
    room = make_room(players={"a1": "A", "b1": "B", "s1": None})
    room.start("a1", CHARS, T0)
    room.flip("b1", "carla", True)
    sa = room.snapshot_for("a1")["match"]
    sb = room.snapshot_for("b1")["match"]
    ss = room.snapshot_for("s1")["match"]
    assert set(sa["secrets"]) == {"A"} and set(sa["boards"]) == {"A"}
    assert set(sb["secrets"]) == {"B"} and sb["boards"] == {"B": {"down": ["carla"]}}
    assert set(ss["secrets"]) == {"A", "B"} and set(ss["boards"]) == {"A", "B"}
    # Segredo do adversário não aparece em lugar nenhum do snapshot do jogador A.
    import json

    assert room.match.secrets["B"] not in json.dumps(
        {k: v for k, v in sa.items() if k != "characters"}
    )
    assert room.snapshot_for("a1")["you"] == {"player_id": "a1", "side": "A", "is_host": True, "role": "player"}
    assert room.snapshot_for("s1")["you"]["role"] == "spectator"
    room.guess("a1", wrong_char(room, "A"), T0)
    sa = room.snapshot_for("a1")["match"]
    assert set(sa["secrets"]) == {"A", "B"} and set(sa["boards"]) == {"A", "B"}


def test_walkover_after_60s():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.disconnect("b1", T0 + 1000)
    assert room.next_wakeup() == T0 + 30_000  # deadline vem antes
    room.tick(T0 + 30_000)  # timeout de A, vez de B (sem conectados)
    assert room.match.asker_id is None
    assert room.next_wakeup() == T0 + 60_000  # deadline de B ainda vem antes do W.O.
    room.tick(T0 + 60_000)
    assert room.status == "playing"
    assert room.next_wakeup() == T0 + 1000 + WALKOVER_MS
    assert room.tick(T0 + 1000 + WALKOVER_MS)
    assert room.match.winner_side == "A" and room.status == "match_over"


def test_reconnect_cancels_walkover_and_fills_asker():
    room = make_room()
    room.start("a1", CHARS, T0)
    room.tick(T0 + 30_000)  # vez de B
    room.disconnect("b1", T0 + 30_001)
    assert room.match.asker_id is None
    room.connect("b1", "B1", "#FFC93C", T0 + 40_000)
    assert room.match.asker_id == "b1"
    assert room.empty_since == {"A": None, "B": None}


def test_host_transfer():
    room = make_room(players={"a1": "A", "b1": "B", "s1": None})
    room.disconnect("a1", T0)
    assert room.host_id == "b1"
    room.connect("a1", "A1", "#FFC93C", T0)
    assert room.host_id == "b1"


def test_max_players():
    room = Room("ABCD", "x")
    for i in range(12):
        room.connect(f"p{i}", "P", "#FFC93C", T0)
    with pytest.raises(GameError, match="cheia"):
        room.connect("p12", "P", "#FFC93C", T0)
    room.disconnect("p0", T0)
    room.connect("p12", "P", "#FFC93C", T0)


def test_chat_channels_and_rate_limit():
    room = make_room("team", players={"a1": "A", "a2": "A", "b1": "B", "s1": None})
    r = room.chat("a1", "oi", T0)
    assert r.channel == "room" and set(r.recipients) == {"a1", "a2", "b1", "s1"}
    room.start("a1", CHARS, T0)
    r = room.chat("a1", "time!", T0)
    assert r.channel == "team" and set(r.recipients) == {"a1", "a2"}
    r = room.chat("s1", "obs", T0)
    assert r.channel == "spectators" and r.recipients == ["s1"]
    for i in range(3):
        room.chat("a1", "spam", T0 + i)
    with pytest.raises(GameError, match="rápido"):
        room.chat("a1", "spam", T0 + 10)
    room.chat("a1", "ok", T0 + 5_000)
    with pytest.raises(GameError):
        room.chat("b1", "x" * 201, T0)
