"""Rotas HTTP de temas (clássico embutido + temas customizados no banco)."""
from __future__ import annotations

import shutil
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from starlette.datastructures import UploadFile

from app import config
from app.classic import CLASSIC_AUTHOR, CLASSIC_CHARACTERS, CLASSIC_ID, CLASSIC_NAME
from app.db import SessionLocal, get_db
from app.models import Character, Theme

router = APIRouter(prefix="/api/themes", tags=["themes"])

MIN_CHARS = 12
MAX_CHARS = 24
MAX_IMAGE_BYTES = 2 * 1024 * 1024


@dataclass
class ThemeData:
    id: str
    name: str
    author: str
    public: bool
    characters: list[dict[str, str]]


def load_theme(theme_id: str, db: Session | None = None) -> ThemeData | None:
    """Carrega um tema (clássico ou do banco) pelo id."""
    if theme_id == CLASSIC_ID:
        return ThemeData(CLASSIC_ID, CLASSIC_NAME, CLASSIC_AUTHOR, True, [dict(c) for c in CLASSIC_CHARACTERS])
    own = db is None
    session = db or SessionLocal()
    try:
        theme = session.get(Theme, theme_id, options=[selectinload(Theme.characters)])
        if theme is None:
            return None
        chars = [{"id": c.id, "name": c.name, "image_url": c.image_url} for c in theme.characters]
        return ThemeData(theme.id, theme.name, theme.author, theme.public, chars)
    finally:
        if own:
            session.close()


def _detect_image(data: bytes) -> str | None:
    """Detecta o formato pelos bytes mágicos; retorna a extensão."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _error(message: str) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": message})


@router.get("")
def list_themes(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = [{
        "id": CLASSIC_ID,
        "name": CLASSIC_NAME,
        "author": CLASSIC_AUTHOR,
        "count": len(CLASSIC_CHARACTERS),
        "public": True,
        "preview": [c["image_url"] for c in CLASSIC_CHARACTERS[:3]],
    }]
    themes = db.scalars(
        select(Theme)
        .where(Theme.public.is_(True))
        .options(selectinload(Theme.characters))
        .order_by(Theme.created_at.desc())
    ).all()
    for t in themes:
        result.append({
            "id": t.id,
            "name": t.name,
            "author": t.author,
            "count": len(t.characters),
            "public": t.public,
            "preview": [c.image_url for c in t.characters[:3]],
        })
    return result


@router.get("/{theme_id}")
def get_theme(theme_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    theme = load_theme(theme_id, db)
    if theme is None:
        raise HTTPException(status_code=404, detail="Tema não encontrado.")
    return {
        "id": theme.id,
        "name": theme.name,
        "author": theme.author,
        "public": theme.public,
        "characters": theme.characters,
    }


@router.post("", status_code=201, response_model=None)
async def create_theme(request: Request, db: Session = Depends(get_db)) -> JSONResponse | dict[str, str]:
    try:
        form = await request.form(max_files=MAX_CHARS + 10, max_fields=MAX_CHARS * 2 + 20)
    except Exception:
        return _error("Não foi possível ler o formulário enviado.")

    name = str(form.get("name") or "").strip()
    author = str(form.get("author") or "").strip()
    public_raw = str(form.get("public") or "true").strip().lower()
    names = [str(n).strip() if isinstance(n, str) else "" for n in form.getlist("names")]
    images = form.getlist("images")

    if not 1 <= len(name) <= 40:
        return _error("O nome do tema deve ter entre 1 e 40 caracteres.")
    if not 1 <= len(author) <= 20:
        return _error("O nome do autor deve ter entre 1 e 20 caracteres.")
    if public_raw not in ("true", "false"):
        return _error("O campo 'público' deve ser true ou false.")
    if len(names) != len(images):
        return _error("Cada personagem precisa de um nome e uma imagem.")
    if not MIN_CHARS <= len(names) <= MAX_CHARS:
        return _error(f"O tema precisa ter entre {MIN_CHARS} e {MAX_CHARS} personagens.")
    seen: set[str] = set()
    for i, n in enumerate(names, start=1):
        if not 1 <= len(n) <= 20:
            return _error(f"O nome do personagem {i} deve ter entre 1 e 20 caracteres.")
        if n.casefold() in seen:
            return _error(f"O nome \"{n}\" está repetido. Cada personagem precisa de um nome único.")
        seen.add(n.casefold())

    blobs: list[tuple[bytes, str]] = []
    for i, img in enumerate(images, start=1):
        if not isinstance(img, UploadFile):
            return _error(f"A imagem do personagem {i} não foi enviada.")
        data = await img.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            return _error(f"A imagem do personagem {i} passa de 2 MB.")
        ext = _detect_image(data)
        if ext is None:
            return _error(f"A imagem do personagem {i} precisa ser PNG, JPEG ou WEBP.")
        blobs.append((data, ext))

    theme_id = uuid.uuid4().hex
    target = config.UPLOAD_DIR / "themes" / theme_id
    target.mkdir(parents=True, exist_ok=True)
    try:
        theme = Theme(id=theme_id, name=name, author=author, public=public_raw == "true")
        for pos, (char_name, (data, ext)) in enumerate(zip(names, blobs)):
            filename = f"{pos:02d}.{ext}"
            (target / filename).write_bytes(data)
            theme.characters.append(Character(
                position=pos,
                name=char_name,
                image_url=f"/uploads/themes/{theme_id}/{filename}",
            ))
        db.add(theme)
        db.commit()
    except Exception:
        db.rollback()
        shutil.rmtree(target, ignore_errors=True)
        raise
    return {"id": theme_id}
