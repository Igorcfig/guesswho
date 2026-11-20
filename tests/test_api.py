"""Testes da API HTTP (salas, temas) e das rotas de página."""
from __future__ import annotations

import pytest
from fastapi.templating import Jinja2Templates
from jinja2 import DictLoader, Environment

from app.main import app
from tests.conftest import make_png

ALPHABET = set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")


def theme_form(n: int = 12, name: str = "Bichos", public: str = "true", names: list[str] | None = None):
    names = names if names is not None else [f"Bicho {i}" for i in range(n)]
    data = {"name": name, "author": "Rafa", "public": public, "names": names}
    files = [("images", (f"{i}.png", make_png(i), "image/png")) for i in range(len(names))]
    return data, files


# ------------------------------------------------------------------ salas
def test_create_and_get_room(client):
    r = client.post("/api/rooms", json={"name": None, "public": True})
    assert r.status_code == 201
    code = r.json()["code"]
    assert len(code) == 4 and set(code) <= ALPHABET
    r = client.get(f"/api/rooms/{code}")
    assert r.json() == {"code": code, "name": f"Sala {code}", "exists": True}
    assert client.get(f"/api/rooms/{code.lower()}").status_code == 200


def test_get_missing_room_404(client):
    r = client.get("/api/rooms/ZZZZ")
    assert r.status_code == 404
    assert r.json() == {"detail": "Sala não encontrada."}


def test_list_public_rooms_only_with_players(client):
    pub = client.post("/api/rooms", json={"name": "Pública", "public": True}).json()["code"]
    priv = client.post("/api/rooms", json={"name": "Privada", "public": False}).json()["code"]
    assert client.get("/api/rooms").json() == []
    pid = "11111111-1111-4111-8111-111111111111"
    with client.websocket_connect(f"/ws/{pub}?player_id={pid}&name=Ana&color=%23FFC93C") as ws:
        ws.receive_json()
        with client.websocket_connect(f"/ws/{priv}?player_id={pid}&name=Ana&color=%23FFC93C") as ws2:
            ws2.receive_json()
            rooms = client.get("/api/rooms").json()
    assert rooms == [{
        "code": pub, "name": "Pública", "mode": "duel", "theme_id": "classic", "theme_name": "Clássico",
        "players": 1, "max_players": 12, "status": "lobby",
    }]


# ------------------------------------------------------------------ temas
def test_list_themes_classic_first(client):
    themes = client.get("/api/themes").json()
    assert themes[0]["id"] == "classic"
    assert themes[0]["name"] == "Clássico" and themes[0]["author"] == "Cara a Cara"
    assert themes[0]["count"] == 24 and len(themes[0]["preview"]) == 3


def test_get_classic_theme(client):
    t = client.get("/api/themes/classic").json()
    assert len(t["characters"]) == 24
    assert t["characters"][0] == {"id": "ana", "name": "Ana", "image_url": "/static/characters/classic/ana.svg"}
    assert t["characters"][9]["name"] == "João"


def test_create_theme_and_fetch(client):
    data, files = theme_form(12)
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert len(tid) == 32
    t = client.get(f"/api/themes/{tid}").json()
    assert t["name"] == "Bichos" and t["author"] == "Rafa" and t["public"] is True
    assert [c["name"] for c in t["characters"]] == data["names"]
    url = t["characters"][0]["image_url"]
    assert url.startswith(f"/uploads/themes/{tid}/")
    img = client.get(url)
    assert img.status_code == 200 and img.content == make_png(0)
    listed = client.get("/api/themes").json()
    assert listed[0]["id"] == "classic"
    entry = next(x for x in listed if x["id"] == tid)
    assert entry["count"] == 12 and len(entry["preview"]) == 3


def test_private_theme_hidden_but_accessible(client):
    data, files = theme_form(12, name="Segredo", public="false")
    tid = client.post("/api/themes", data=data, files=files).json()["id"]
    assert tid not in [t["id"] for t in client.get("/api/themes").json()]
    assert client.get(f"/api/themes/{tid}").json()["public"] is False


def test_missing_theme_404(client):
    r = client.get("/api/themes/naoexiste")
    assert r.status_code == 404 and r.json()["detail"] == "Tema não encontrado."


@pytest.mark.parametrize("n", [11, 25])
def test_theme_character_count(client, n):
    data, files = theme_form(n)
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422
    assert "entre 12 e 24" in r.json()["detail"]


def test_theme_duplicate_names(client):
    names = [f"N{i}" for i in range(11)] + ["n0"]
    data, files = theme_form(names=names)
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422 and "repetido" in r.json()["detail"]


def test_theme_bad_fields(client):
    data, files = theme_form(12, name="")
    assert "nome do tema" in client.post("/api/themes", data=data, files=files).json()["detail"]
    data, files = theme_form(12, name="x" * 41)
    assert client.post("/api/themes", data=data, files=files).status_code == 422
    data, files = theme_form(12)
    data["author"] = "a" * 21
    assert "autor" in client.post("/api/themes", data=data, files=files).json()["detail"]
    data, files = theme_form(12)
    data["names"][3] = "x" * 21
    assert "personagem 4" in client.post("/api/themes", data=data, files=files).json()["detail"]


def test_theme_names_images_mismatch(client):
    data, files = theme_form(12)
    files = files[:-1]
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422 and "nome e uma imagem" in r.json()["detail"]


def test_theme_rejects_non_image(client):
    data, files = theme_form(12)
    files[5] = ("images", ("fake.png", b"GIF89a....not allowed", "image/png"))
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422 and "personagem 6" in r.json()["detail"]


def test_theme_accepts_jpeg_and_webp_magic(client):
    data, files = theme_form(12)
    files[0] = ("images", ("a.jpg", b"\xff\xd8\xff\xe0" + b"0" * 20, "image/jpeg"))
    files[1] = ("images", ("b.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"0" * 20, "image/webp"))
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 201
    chars = client.get(f"/api/themes/{r.json()['id']}").json()["characters"]
    assert chars[0]["image_url"].endswith(".jpg") and chars[1]["image_url"].endswith(".webp")


def test_theme_rejects_big_image(client):
    data, files = theme_form(12)
    files[2] = ("images", ("big.png", make_png(1) + b"\x00" * (2 * 1024 * 1024), "image/png"))
    r = client.post("/api/themes", data=data, files=files)
    assert r.status_code == 422 and "2 MB" in r.json()["detail"]


# ---------------------------------------------------------------- páginas
@pytest.fixture()
def fake_templates(monkeypatch):
    env = Environment(loader=DictLoader({
        "index.html": "home",
        "room.html": "sala {{ code }}",
        "theme_editor.html": "editor",
    }))
    import app.main as main

    monkeypatch.setattr(main, "templates", Jinja2Templates(env=env))


def test_pages(client, fake_templates):
    assert client.get("/").text == "home"
    assert client.get("/temas/novo").text == "editor"
    code = client.post("/api/rooms", json={"public": True}).json()["code"]
    assert client.get(f"/sala/{code}").text == f"sala {code}"
    r = client.get("/sala/ZZZZ", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/?erro=")


def test_unknown_api_route_pt_br(client):
    r = client.get("/api/nada")
    assert r.status_code == 404 and r.json() == {"detail": "Não encontrado."}
    assert app is not None


def test_static_js_sempre_revalidado(client):
    r = client.get("/static/js/i18n.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert "etag" in r.headers
