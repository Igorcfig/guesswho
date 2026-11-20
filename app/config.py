"""Configuração via variáveis de ambiente."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _database_url() -> str:
    """URL do banco.

    Prioridade: DATABASE_URL explícita; senão, se POSTGRES_USER estiver definido, monta a URL do
    Postgres a partir de POSTGRES_USER/PASSWORD/HOST/PORT/DB com escape correto (a senha pode ter
    @ : / # etc.); senão, SQLite local para desenvolvimento.
    """
    url = os.environ.get("DATABASE_URL")
    if not url and os.environ.get("POSTGRES_USER"):
        from sqlalchemy.engine import URL

        return URL.create(
            "postgresql+psycopg",
            username=os.environ["POSTGRES_USER"],
            password=os.environ.get("POSTGRES_PASSWORD") or None,
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
            database=os.environ.get("POSTGRES_DB", os.environ["POSTGRES_USER"]),
        ).render_as_string(hide_password=False)
    url = url or "sqlite:///./dev.db"
    # Força o driver psycopg v3 quando vier uma URL postgres "pura".
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL: str = _database_url()
UPLOAD_DIR: Path = Path(os.environ.get("UPLOAD_DIR", "./uploads")).resolve()
TEMPLATES_DIR: Path = BASE_DIR / "templates"
STATIC_DIR: Path = BASE_DIR / "static"
