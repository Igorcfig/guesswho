"""Teste de WebSocket: partida completa com 2 jogadores."""
from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

PID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
PID_S = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


def url(code: str, pid: str, name: str) -> str:
    return f"/ws/{code}?player_id={pid}&name={name}&color=%232EC4B6"


def recv_until(ws, pred, limit: int = 30):
    for _ in range(limit):
        msg = ws.receive_json()
        if pred(msg):
            return msg
    raise AssertionError("mensagem esperada não chegou")


def state(ws, pred=lambda s: True):
    return recv_until(ws, lambda m: m["type"] == "state" and pred(m))


def test_missing_room_closes_4404(client):
    with client.websocket_connect(url("ZZZZ", PID_A, "Ana")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4404


def test_full_match_two_players(client):
    code = client.post("/api/rooms", json={"name": "Teste", "public": True}).json()["code"]
    with client.websocket_connect(url(code, PID_A, "Ana")) as wa:
        s = state(wa)
        assert s["you"] == {"player_id": PID_A, "side": None, "is_host": True, "role": "spectator"}
        assert s["room"]["status"] == "lobby" and s["match"] is None

        with client.websocket_connect(url(code, PID_B, "Bruno")) as wb:
            s = state(wb)
            assert s["you"]["is_host"] is False
            state(wa, lambda m: len(m["players"]) == 2)

            # Não-anfitrião não pode iniciar.
            wb.send_json({"type": "start"})
            err = recv_until(wb, lambda m: m["type"] == "error")
            assert "anfitrião" in err["message"]

            wa.send_json({"type": "set_settings", "turn_seconds": 60, "best_of": 3})
            state(wa, lambda m: m["room"]["settings"]["turn_seconds"] == 60)
            wa.send_json({"type": "set_settings", "theme_id": "naoexiste"})
            assert recv_until(wa, lambda m: m["type"] == "error")["message"] == "Tema não encontrado."

            wa.send_json({"type": "join_side", "side": "A"})
            wb.send_json({"type": "join_side", "side": "B"})
            state(wa, lambda m: {p["side"] for p in m["players"]} == {"A", "B"})

            # Chat no lobby: canal room para todos.
            wb.send_json({"type": "chat", "text": "boa sorte!"})
            chat = recv_until(wa, lambda m: m["type"] == "chat")
            assert chat["channel"] == "room" and chat["name"] == "Bruno" and chat["text"] == "boa sorte!"

            wa.send_json({"type": "start"})
            sa = state(wa, lambda m: m["room"]["status"] == "playing")
            sb = state(wb, lambda m: m["room"]["status"] == "playing")
            ma, mb = sa["match"], sb["match"]
            assert len(ma["characters"]) == 24
            assert list(ma["secrets"]) == ["A"] and list(mb["secrets"]) == ["B"]
            assert list(ma["boards"]) == ["A"]
            assert ma["turn_side"] == "A" and ma["asker_id"] == PID_A and ma["phase"] == "asking"
            assert isinstance(ma["deadline"], int)
            secret_b = mb["secrets"]["B"]  # o que A precisa adivinhar

            # Pergunta / resposta.
            wa.send_json({"type": "ask", "text": "Usa chapéu?"})
            sb = state(wb, lambda m: m["match"]["phase"] == "answering")
            assert sb["match"]["pending_question"] == {"text": "Usa chapéu?", "asker_id": PID_A}
            assert sb["match"]["answerer_id"] == PID_B
            wb.send_json({"type": "answer", "answer": "no"})
            sa = state(wa, lambda m: m["match"]["turn_side"] == "B")
            assert sa["match"]["log"][-1]["answer"] == "no"

            # Virar carta: só o próprio lado vê.
            wa.send_json({"type": "flip", "character_id": "ana", "down": True})
            sa = state(wa, lambda m: m["match"]["boards"]["A"]["down"] == ["ana"])
            sb = state(wb)
            assert "A" not in sb["match"]["boards"]

            # Chat durante a partida é do time.
            wa.send_json({"type": "chat", "text": "segredo do time"})
            assert recv_until(wa, lambda m: m["type"] == "chat")["channel"] == "team"

            # B pergunta, A responde, A chuta certo.
            wb.send_json({"type": "ask", "text": "É mulher?"})
            state(wa, lambda m: m["match"]["phase"] == "answering")
            wa.send_json({"type": "answer", "answer": "yes"})
            state(wa, lambda m: m["match"]["turn_side"] == "A" and m["match"]["phase"] == "asking")
            wa.send_json({"type": "guess", "character_id": secret_b})
            sa = state(wa, lambda m: m["room"]["status"] == "match_over")
            assert sa["match"]["winner_side"] == "A" and sa["match"]["phase"] == "over"
            assert set(sa["match"]["secrets"]) == {"A", "B"}
            assert sa["score"] == {"A": 1, "B": 0}
            assert next(p for p in sa["players"] if p["id"] == PID_A)["wins"] == 1
            sb = state(wb, lambda m: m["room"]["status"] == "match_over")
            assert set(sb["match"]["boards"]) == {"A", "B"}

            # Próxima partida começa com B; depois volta ao lobby.
            wa.send_json({"type": "next_match"})
            sa = state(wa, lambda m: m["room"]["status"] == "playing")
            assert sa["match"]["number"] == 2 and sa["match"]["turn_side"] == "B"
            wb.send_json({"type": "guess", "character_id": "zzz"})
            assert recv_until(wb, lambda m: m["type"] == "error")["message"] == "Personagem inválido."


def test_reconnect_replaces_connection_and_host_transfer(client):
    code = client.post("/api/rooms", json={"public": False}).json()["code"]
    with client.websocket_connect(url(code, PID_A, "Ana")) as wa:
        state(wa)
        with client.websocket_connect(url(code, PID_B, "Bruno")) as wb:
            state(wb)
        # B saiu: continua listado como desconectado.
        s = state(wa, lambda m: any(p["id"] == PID_B and not p["connected"] for p in m["players"]))
        assert len(s["players"]) == 2
        with client.websocket_connect(url(code, PID_A, "Ana2")) as wa2:
            s = state(wa2)
            assert s["you"]["is_host"] and [p["name"] for p in s["players"]][0] == "Ana2"
            with pytest.raises(WebSocketDisconnect) as exc:
                while True:
                    wa.receive_json()
            assert exc.value.code == 4000
            with client.websocket_connect(url(code, PID_S, "Sofia")) as ws:
                state(ws)
                wa2.close()
                s = state(ws, lambda m: m["room"]["host_id"] == PID_S)
                assert s["you"]["is_host"] is True


def test_timer_task_fires_timeout(client, monkeypatch):
    """O timer asyncio da sala aplica o timeout quando o relógio passa do deadline."""
    from app.realtime.manager import manager

    fake = {"now": 5_000_000}
    monkeypatch.setattr(manager, "clock", lambda: fake["now"])
    code = client.post("/api/rooms", json={"public": True}).json()["code"]
    with client.websocket_connect(url(code, PID_A, "Ana")) as wa, \
            client.websocket_connect(url(code, PID_B, "Bruno")) as wb:
        wa.send_json({"type": "join_side", "side": "A"})
        wb.send_json({"type": "join_side", "side": "B"})
        state(wa, lambda m: {p["side"] for p in m["players"]} == {"A", "B"})
        wa.send_json({"type": "start"})
        s = state(wa, lambda m: m["room"]["status"] == "playing")
        assert s["match"]["deadline"] == 5_000_000 + 45_000
        fake["now"] += 45_000
        # Qualquer mudança reagenda o timer, que agora dispara imediatamente.
        wa.send_json({"type": "flip", "character_id": "ana", "down": True})
        s = state(wa, lambda m: m["match"]["turn_side"] == "B")
        assert s["match"]["log"][-1]["kind"] == "timeout"
        assert s["match"]["deadline"] == 5_000_000 + 90_000
