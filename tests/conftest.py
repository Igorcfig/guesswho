"""Test setup: SQLite and uploads in a temporary directory."""
from __future__ import annotations

import io
import os
import struct
import tempfile
import zlib

_TMP = tempfile.mkdtemp(prefix="cara-a-cara-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["UPLOAD_DIR"] = f"{_TMP}/uploads"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.realtime.manager import manager  # noqa: E402


def make_png(seed: int = 0, size: int = 4) -> bytes:
    """Tiny valid PNG generated in memory (no Pillow)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    rgb = bytes([(seed * 37) % 256, (seed * 91) % 256, (seed * 13) % 256])
    raw = b"".join(b"\x00" + rgb * size for _ in range(size))
    out = io.BytesIO()
    out.write(b"\x89PNG\r\n\x1a\n")
    out.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)))
    out.write(chunk(b"IDAT", zlib.compress(raw)))
    out.write(chunk(b"IEND", b""))
    return out.getvalue()


@pytest.fixture()
def client() -> TestClient:
    manager.sessions.clear()
    with TestClient(app) as c:
        yield c
    manager.sessions.clear()
