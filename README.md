# Cara a Cara

Jogo web multiplayer de adivinhação de personagens (inspirado em "Cara a Cara" / Guess Who?),
com salas no estilo Gartic. Visual e personagens 100% originais.

## Como rodar

Requisitos: Docker e Docker Compose.

Usuário, senha e nome do banco (e a porta) ficam num arquivo `.env`, que **não vai para o git**.
O modelo é o `.env.example`.

**Desenvolvimento**

```bash
cp .env.example .env        # ajuste a senha se quiser
docker compose up --build
```

**Produção**

```bash
cp .env.example .env.prod   # use uma senha forte, ex.: openssl rand -base64 24
docker compose --env-file .env.prod up -d --build
```

Se alguma variável obrigatória faltar, o compose para com a mensagem `defina ... no .env`.
Atenção: o Postgres só usa a senha ao criar o volume `pgdata` pela primeira vez; para trocar
a senha depois, altere-a no banco ou recrie o volume (`docker compose down -v` apaga os dados).

Abra http://localhost:8000 (ou a `APP_PORT` definida). O compose sobe dois serviços:

- `app` — FastAPI + Uvicorn (1 worker) na porta 8000; imagens dos temas ficam no volume `uploads`.
- `db` — PostgreSQL 16 (volume `pgdata`), usado para guardar os temas customizados.

As tabelas são criadas automaticamente no startup.

### Rodando sem Docker (desenvolvimento)

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

Sem `DATABASE_URL`, o app usa SQLite (`./dev.db`); uploads vão para `./uploads` (`UPLOAD_DIR`).

## Testes

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

Os testes usam SQLite e um diretório temporário — não precisam do Postgres.

## Regras resumidas

- Cada lado (A e B) guarda um personagem secreto sorteado; o objetivo é descobrir o segredo do adversário.
- Na sua vez, o perguntador faz uma pergunta de sim/não (o outro lado responde) **ou** arrisca um chute.
- Chute certo: seu lado vence a partida. Chute errado: o adversário vence.
- Cada fase tem tempo limite (30/45/60/90 s). Se o tempo acaba, a vez passa para o outro lado.
- Vire as cartas do seu tabuleiro para eliminar suspeitos (no modo time, o tabuleiro é compartilhado).
- **Duelo**: 1 contra 1. Quem perde vai para o fim da fila de observadores e o próximo da fila entra.
- **Time**: vários jogadores por lado, perguntando e respondendo em rodízio; vence a série quem fizer
  a maioria das partidas (melhor de 1, 3 ou 5).
- Se um lado fica sem ninguém conectado por 60 s durante a partida, o outro vence por W.O.
- Crie seus próprios temas (12 a 24 personagens, imagens PNG/JPEG/WEBP até 2 MB) em `/temas/novo`.
