"""Configuração via variáveis de ambiente."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///./dev.db")
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
