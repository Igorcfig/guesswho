"""Configuration via environment variables."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _database_url() -> str:
    """Database URL.

    Priority: an explicit DATABASE_URL; otherwise, if POSTGRES_USER is set, build the Postgres URL
    from POSTGRES_USER/PASSWORD/HOST/PORT/DB with proper escaping (the password may contain
    @ : / # etc.); otherwise, a local SQLite database for development.
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
    # Force the psycopg v3 driver when a "plain" postgres URL is given.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL: str = _database_url()
UPLOAD_DIR: Path = Path(os.environ.get("UPLOAD_DIR", "./uploads")).resolve()
TEMPLATES_DIR: Path = BASE_DIR / "templates"
STATIC_DIR: Path = BASE_DIR / "static"
# Source code link shown on the home page (forks can change it).
REPO_URL: str = os.environ.get("REPO_URL", "https://github.com/Igorcfig/guesswho")
