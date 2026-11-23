"""Building the database URL from the POSTGRES_* variables."""
import importlib

from sqlalchemy.engine import make_url

import app.config as config


def _reload(monkeypatch, **env):
    for k in ("DATABASE_URL", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return importlib.reload(config).DATABASE_URL


def test_senha_com_caracteres_especiais(monkeypatch):
    senha = "p@ss:w/rd#?%&é"
    url = _reload(monkeypatch, POSTGRES_USER="cara", POSTGRES_PASSWORD=senha, POSTGRES_HOST="db", POSTGRES_DB="cara")
    parsed = make_url(url)
    assert parsed.drivername == "postgresql+psycopg"
    assert parsed.username == "cara"
    assert parsed.password == senha
    assert parsed.host == "db"
    assert parsed.port == 5432
    assert parsed.database == "cara"


def test_database_url_explicita_tem_prioridade(monkeypatch):
    url = _reload(monkeypatch, DATABASE_URL="postgresql://u:p@h/d", POSTGRES_USER="x")
    assert url == "postgresql+psycopg://u:p@h/d"


def test_padrao_sqlite(monkeypatch):
    assert _reload(monkeypatch).startswith("sqlite:///")
    monkeypatch.undo()
    importlib.reload(config)
