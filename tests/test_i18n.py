"""Internacionalização do servidor: páginas, erros da API e do WebSocket em pt (padrão) e en."""
from __future__ import annotations

import re

from app.i18n import MESSAGES, PAGES, normalize, page_text, tr
from tests.conftest import make_png


def visible(html: str) -> str:
    """HTML sem o bloco JSON de textos (que traz os dois idiomas para o cliente)."""
    return re.sub(r'<script id="i18n-pages".*?</script>', "", html, flags=re.S)


PID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def test_helpers():
    assert normalize(None) == "pt" and normalize("EN") == "en" and normalize("pt-BR") == "pt" and normalize("fr") == "pt"
    assert tr("Sala não encontrada.", "en") == "Room not found."
    assert tr("Sala não encontrada.", None) == "Sala não encontrada."
    assert tr("O nome do personagem {i} deve ter entre 1 e 20 caracteres.", "en", i=3) == "Character 3's name must be 1 to 20 characters."
    assert page_text("title.room", "en", code="K7Q2") == "Cara a Cara · Room K7Q2"
    assert set(PAGES["pt"]) == set(PAGES["en"])
    assert all(v for v in MESSAGES.values())


def test_home_default_pt(client):
    r = client.get("/", headers={"Accept-Language": "en-US,en;q=0.9"})  # Accept-Language é ignorado
    assert '<html lang="pt-BR"' in r.text
    assert "<title>Cara a Cara · Início</title>" in r.text
    assert "Jogar agora" in r.text and 'aria-label="Português"' in r.text and 'aria-label="English"' in r.text
    assert 'data-lang-btn="pt" lang="pt-BR" aria-label="Português" title="Português" aria-pressed="true"' in r.text


def test_pages_in_english(client):
    client.cookies.set("lang", "en")
    r = client.get("/")
    assert "Jogar agora" in r.text  # textos pt embutidos para troca sem recarregar
    shown = visible(r.text)
    assert '<html lang="en"' in r.text
    assert "<title>Cara a Cara · Home</title>" in r.text
    assert "Play now" in r.text and "Create room" in r.text and "Jogar agora" not in shown
    assert 'data-lang-btn="en" lang="en" aria-label="English" title="English" aria-pressed="true"' in r.text

    r = client.get("/temas/novo")
    assert '<html lang="en"' in r.text and "Save theme" in r.text and "Cara a Cara · Create theme" in r.text

    code = client.post("/api/rooms", json={"public": True}).json()["code"]
    r = client.get(f"/sala/{code}")
    assert '<html lang="en"' in r.text and f"Cara a Cara · Room {code}" in r.text
    assert "Yellow Team" in r.text and "Time Amarelo" not in visible(r.text)


def test_api_errors_in_english(client):
    assert client.get("/api/rooms/ZZZZ").json() == {"detail": "Sala não encontrada."}
    client.cookies.set("lang", "en")
    assert client.get("/api/rooms/ZZZZ").json() == {"detail": "Room not found."}
    assert client.get("/api/nada").json() == {"detail": "Not found."}
    assert client.get("/api/themes/nope").json() == {"detail": "Theme not found."}
    files = [("images", (f"{i}.png", make_png(i), "image/png")) for i in range(12)]
    data = {"name": "Bichos", "author": "Ana", "public": "true", "names": ["Gato"] * 12}
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422
    assert r.json()["detail"] == 'The name "Gato" is repeated. Each character needs a unique name.'


def test_ws_errors_follow_player_lang(client):
    code = client.post("/api/rooms", json={"public": True}).json()["code"]
    with client.websocket_connect(f"/ws/{code}?player_id={PID_A}&name=Ana&color=%23FFC93C&lang=en") as wa:
        wa.receive_json()
        with client.websocket_connect(f"/ws/{code}?player_id={PID_B}&name=Bia&color=%23FFC93C") as wb:
            wb.receive_json()
            wa.receive_json()
            # Bia (pt, padrão) não é anfitriã.
            wb.send_json({"type": "start"})
            msg = wb.receive_json()
            assert msg == {"type": "error", "message": "Só o anfitrião pode fazer isso."}
            # Ana (en) pede um tema que não existe.
            wa.send_json({"type": "set_settings", "theme_id": "nope"})
            assert wa.receive_json() == {"type": "error", "message": "Theme not found."}
            # Bia troca para en sem reconectar; Ana volta para pt.
            wb.send_json({"type": "set_lang", "lang": "en"})
            wb.send_json({"type": "start"})
            assert wb.receive_json() == {"type": "error", "message": "Only the host can do that."}
            wa.send_json({"type": "set_lang", "lang": "pt"})
            wa.send_json({"type": "chat", "text": ""})
            assert wa.receive_json() == {"type": "error", "message": "A mensagem deve ter entre 1 e 200 caracteres."}
            wb.send_json({"type": "chat", "text": ""})
            assert wb.receive_json() == {"type": "error", "message": "Messages must be 1 to 200 characters."}
            wb.send_json({"type": "set_lang", "lang": "fr"})
            assert wb.receive_json() == {"type": "error", "message": "Invalid language."}


def test_ws_reconnect_keeps_seat_after_lang_change(client):
    code = client.post("/api/rooms", json={"public": True}).json()["code"]
    with client.websocket_connect(f"/ws/{code}?player_id={PID_A}&name=Ana&color=%23FFC93C") as wa:
        wa.receive_json()
        wa.send_json({"type": "join_side", "side": "A"})
        assert wa.receive_json()["you"]["side"] == "A"
    # Recarregar a página em inglês reconecta com o mesmo player_id e mantém o lado.
    with client.websocket_connect(f"/ws/{code}?player_id={PID_A}&name=Ana&color=%23FFC93C&lang=en") as wa:
        s = wa.receive_json()
        assert s["you"]["side"] == "A" and s["you"]["is_host"] is True
        wa.send_json({"type": "join_side", "side": "X"})
        assert wa.receive_json() == {"type": "error", "message": "Invalid side."}
