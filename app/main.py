"""Aplicação FastAPI do Cara a Cara."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from jinja2 import pass_context
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config
from app.api import rooms, themes
from app.db import init_db
from app.i18n import HTML_LANG, PAGES, page_text, request_lang, tr
from app.realtime import ws
from app.realtime.manager import manager

config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="Cara a Cara", lifespan=lifespan)
class RevalidatedStaticFiles(StaticFiles):
    """Arquivos estáticos que o navegador sempre revalida (ETag) antes de usar.

    Sem Cache-Control, navegadores aplicam cache heurístico e podem misturar módulos JS antigos
    com HTML novo depois de uma atualização, quebrando os imports (página sem reação a cliques).
    """

    async def get_response(self, path, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", RevalidatedStaticFiles(directory=config.STATIC_DIR, check_dir=False), name="static")
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR, check_dir=False), name="uploads")
templates = Jinja2Templates(directory=str(config.TEMPLATES_DIR))
templates.env.globals["repo_url"] = config.REPO_URL


@pass_context
def _ctx_lang(ctx: dict) -> str:
    return request_lang(ctx.get("request"))


@pass_context
def _ctx_t(ctx: dict, key: str, **params: object) -> str:
    """`t(key)` nos templates: texto no idioma da requisição (cookie `lang`, padrão pt)."""
    return page_text(key, request_lang(ctx.get("request")), **params)


templates.env.globals["t"] = _ctx_t
templates.env.globals["lang"] = _ctx_lang
templates.env.globals["html_lang"] = HTML_LANG
templates.env.globals["page_strings"] = PAGES

app.include_router(rooms.router)
app.include_router(themes.router)
app.include_router(ws.router)

_STATUS_MESSAGES = {404: "Não encontrado.", 405: "Método não permitido."}


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    # Mensagens padrão do Starlette ("Not Found" etc.) viram pt-BR (ou en, pelo cookie `lang`).
    if not isinstance(detail, str) or detail == HTTPStatus(exc.status_code).phrase:
        detail = _STATUS_MESSAGES.get(exc.status_code, "Erro na requisição.")
    detail = tr(detail, request_lang(request))
    return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": tr("Dados inválidos na requisição.", request_lang(request))})


# ------------------------------------------------------------------ páginas
@app.get("/", include_in_schema=False)
def index(request: Request) -> Response:
    return templates.TemplateResponse(request, "index.html", {})


@app.get("/sala/{code}", include_in_schema=False)
def room_page(request: Request, code: str) -> Response:
    session = manager.get(code)
    if session is None:
        return RedirectResponse(url="/?erro=sala_nao_encontrada", status_code=303)
    return templates.TemplateResponse(request, "room.html", {"code": session.room.code})


@app.get("/temas/novo", include_in_schema=False)
def theme_editor(request: Request) -> Response:
    return templates.TemplateResponse(request, "theme_editor.html", {})


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok"}
