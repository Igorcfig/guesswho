# Cara a Cara — Especificação técnica (contrato entre Backend e Frontend)

Jogo web multiplayer inspirado em "Cara a Cara" (Guess Who?), com salas estilo Gartic.
Visual e personagens são 100% originais. Toda a UI é em **português do Brasil**.

## Stack
- Python 3.12, **FastAPI** + Uvicorn, WebSockets nativos do Starlette.
- Templates **Jinja2** servidos pelo FastAPI; frontend em **JS vanilla (ES modules) + CSS próprio**, sem build step, sem framework JS.
- **PostgreSQL 16** para temas customizados (SQLAlchemy 2.x, sync, driver `psycopg[binary]` v3). Testes usam SQLite.
- Imagens enviadas ficam em `UPLOAD_DIR` (volume Docker), servidas em `/uploads/...`.
- Estado das salas/partidas: **em memória** no processo (1 worker uvicorn).
- `docker compose up --build` sobe `app` (porta 8000) e `db`.

## Estrutura de diretórios e donos
```
cara-a-cara/
  docker-compose.yml, Dockerfile, requirements.txt, requirements-dev.txt, README.md   (Backend)
  app/
    main.py, config.py, db.py, models.py           (Backend)
    game/        lógica pura das regras (sem I/O)  (Backend)
    realtime/    gerenciador de conexões WS        (Backend)
    api/         rotas HTTP /api/...               (Backend)
    classic.py   lista dos 24 personagens Clássico (Backend)
    templates/   base.html, index.html, room.html, theme_editor.html   (Frontend)
    static/css/  app.css                          (Frontend)
    static/js/   home.js, room.js, theme_editor.js, common.js          (Frontend)
    static/img/  logo.svg, favicon.svg             (Design)
    static/characters/classic/<slug>.svg           (Design)
  tests/         pytest                            (Backend)
```

## Design de referência
Mock aprovado (arquivos HTML de referência): `docs/mock/*.dc.html` — Main (início), Lobby (sala), Game (partida),
Themes (criar tema), Spectator (observador). Tokens:
- Fundo `#1B1446`, superfície escura `#2A2160`, faixa `#241B57`, sombra sólida `#0F0B2E`.
- Cartões brancos `#FFFFFF`, texto escuro `#1B1446`, texto secundário `#4A4570` / `#5A5488`, borda input `#E4E1F5`.
- Amarelo `#FFC93C` (Time A / destaque), coral `#FF5E5B` (botão principal, sombra `#C9403E`), Time B `#FF7C79`, teal `#2EC4B6`.
- Texto claro secundário `#B9B4E0` / `#CFCBEE`. Resposta SIM fundo `#BFF0EA`, NÃO/ERRO fundo `#FFC9C8`.
- Fontes Google: **Fredoka** (títulos, 600/700) e **Nunito** (corpo, 600/700/800). Botões com `box-shadow: 0 5px 0 <tom escuro>`; raios 12–28px.

## Personagens Clássico (24)
Ids/slugs (nesta ordem) e nomes exibidos:
`ana` Ana, `bruno` Bruno, `carla` Carla, `davi` Davi, `elisa` Elisa, `fabio` Fábio, `gabi` Gabi, `heitor` Heitor,
`iara` Iara, `joao` João, `karina` Karina, `leo` Leo, `marta` Marta, `nico` Nico, `olga` Olga, `paulo` Paulo,
`quim` Quim, `rita` Rita, `sofia` Sofia, `teo` Téo, `ulisses` Ulisses, `vera` Vera, `wesley` Wesley, `yara` Yara.
Imagem: `/static/characters/classic/<slug>.svg` (quadrada, viewBox 0 0 200 200).
O tema clássico tem id `classic`, nome "Clássico", autor "Cara a Cara".

## Identidade do jogador
Sem login. O frontend gera um `player_id` (UUID v4) e guarda em `localStorage` junto com `name` (apelido, 1–20 chars)
e `color` (um de `#FFC93C #2EC4B6 #FF9F5A #B8A6FF #FF7C9C #7EE8DD #8A6CFF #3A86FF`).
Reconectar com o mesmo `player_id` recupera o lugar na sala.

## Páginas HTML (rotas do Backend, templates do Frontend)
| Rota | Template | Contexto |
|---|---|---|
| `GET /` | `index.html` | — |
| `GET /sala/{code}` | `room.html` | `code` (404 → página/redirect para `/` com aviso se sala não existe) |
| `GET /temas/novo` | `theme_editor.html` | — |

`base.html` contém head (fontes, `app.css`, favicon) e bloco `content` + bloco `scripts`.

## API HTTP (JSON)
- `POST /api/rooms` body `{"name": str|null, "public": bool}` → `201 {"code": "K7Q2"}`. Código: 4 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
  Nome padrão "Sala de <ninguém>" → use `"Sala " + code` se vazio.
- `GET /api/rooms` → lista de salas públicas: `[{"code","name","mode","theme_name","players","max_players","status"}]`
  (`players` = nº de conectados; `max_players` = 12; `status` = `"lobby"` | `"playing"`).
- `GET /api/rooms/{code}` → `{"code","name","exists":true}` ou 404.
- `GET /api/themes` → `[{"id","name","author","count","public","preview":[até 3 image_url]}]` (clássico primeiro; só públicos).
- `GET /api/themes/{id}` → `{"id","name","author","public","characters":[{"id","name","image_url"}]}` (privado acessível por id).
- `POST /api/themes` multipart: `name` (1–40), `author` (1–20), `public` ("true"/"false"), e N pares em ordem:
  `names` (campo repetido) e `images` (arquivo repetido). Regras: 12 ≤ N ≤ 24, nomes 1–20 chars únicos no tema,
  imagens PNG/JPEG/WEBP (verificar pelos bytes mágicos), ≤ 2 MB cada. → `201 {"id": "<uuid hex>"}`; erro `422 {"detail": "mensagem em pt-BR"}`.
- Erros sempre `{"detail": "..."}` em português.

## WebSocket
`GET /ws/{code}?player_id=<uuid>&name=<apelido>&color=<hex>` — sala inexistente: fecha com código 4404.
Mesmo `player_id` conectando de novo substitui a conexão anterior.

Toda mensagem é JSON `{"type": "...", ...}`.

### Cliente → servidor
| type | campos | quem pode |
|---|---|---|
| `set_mode` | `mode`: `"duel"`/`"team"` | anfitrião, no lobby |
| `set_settings` | qualquer subset de `theme_id`, `turn_seconds` (30/45/60/90), `best_of` (1/3/5), `public` (bool) | anfitrião, no lobby |
| `join_side` | `side`: `"A"`/`"B"`/`null` (null = observador) | qualquer um, no lobby (em duelo cada lado tem no máx. 1) |
| `start` | — | anfitrião, no lobby, com ≥1 jogador conectado em cada lado |
| `ask` | `text` (1–140) | o perguntador da vez, fase `asking` |
| `answer` | `answer`: `"yes"`/`"no"` | o respondedor da vez, fase `answering` |
| `guess` | `character_id` | o perguntador da vez, fase `asking` (em vez de perguntar) |
| `flip` | `character_id`, `down`: bool | jogador de um lado durante a partida (tabuleiro é compartilhado pelo time) |
| `chat` | `text` (1–200) | qualquer um |
| `next_match` | — | anfitrião, quando `status` é `match_over` |
| `back_to_lobby` | — | anfitrião, quando `match_over` ou `series_over` |

Ação inválida → servidor responde só ao remetente `{"type":"error","message":"<pt-BR>"}`.

### Servidor → cliente
- `{"type":"state", ...snapshot personalizado...}` enviado a **todos** após qualquer mudança (e ao conectar).
- `{"type":"chat","channel":"room"|"team"|"spectators","player_id","name","color","text","ts"}`.
- `{"type":"error","message"}`.

### Snapshot `state`
```json
{
  "type": "state",
  "you": {"player_id": "...", "side": "A"|"B"|null, "is_host": true, "role": "player"|"spectator"},
  "room": {
    "code": "K7Q2", "name": "...", "mode": "duel"|"team", "host_id": "...",
    "status": "lobby"|"playing"|"match_over"|"series_over",
    "settings": {"theme_id": "classic", "theme_name": "Clássico", "turn_seconds": 45, "best_of": 3, "public": true}
  },
  "players": [{"id","name","color","side": "A"|"B"|null,"connected": true,"is_host": false,"wins": 0}],
  "queue": ["player_id", ...],
  "score": {"A": 0, "B": 0},
  "series_winner": null|"A"|"B",
  "match": null | {
    "number": 1,
    "characters": [{"id","name","image_url"}],
    "turn_side": "A"|"B",
    "phase": "asking"|"answering"|"over",
    "asker_id": "...", "answerer_id": "...|null",
    "deadline": 1763590000000,
    "pending_question": null | {"text","asker_id"},
    "boards": {"A": {"down": ["id",...]}, "B": {"down": [...]}},
    "secrets": {"A": "char_id", "B": "char_id"},
    "log": [{"kind":"question"|"guess"|"timeout","side":"A","player_id","text","answer":"yes"|"no"|null,"correct":null|bool,"ts"}],
    "winner_side": null|"A"|"B"
  }
}
```
Visibilidade (personalização obrigatória — nunca vazar segredos):
- `secrets[X]` é o personagem que o lado X **guarda** (o lado adversário tenta adivinhar).
- Jogador do lado X recebe `secrets` só com a chave `X` e `boards` só com a chave `X`.
- Observador recebe tudo. Quando `phase == "over"`, todos recebem os dois segredos e os dois tabuleiros.
- `deadline` em epoch ms do servidor.

## Regras
- **Modos**: `duel` (1 jogador por lado; demais são observadores; `queue` = observadores em ordem de chegada
  que querem jogar — todo observador entra na fila automaticamente no duelo) e `team` (qualquer nº por lado).
- **Início da partida**: sorteia segredos distintos para A e B do tema escolhido; nenhum card virado; lado inicial
  alterna a cada partida (partida 1 começa com A).
- **Turno**: lado da vez, fase `asking`. O perguntador é escolhido por rodízio entre os jogadores conectados do lado.
  Ele envia `ask` (→ fase `answering`, respondedor = rodízio entre conectados do outro lado) ou `guess`.
  Após `answer`, a pergunta+resposta entra no log e a vez passa ao outro lado (fase `asking`).
- **Timer**: cada fase dura `turn_seconds`. Estouro em `asking` → log `timeout`, vez passa. Estouro em `answering` →
  log da pergunta com `answer: null`, vez passa. Implementar com tarefa asyncio por sala (cancelável).
- **Chute**: certo → lado do perguntador vence a partida; errado → o outro lado vence. `phase = "over"`, `winner_side`.
- **Placar**: `score[winner]+=1`; em duelo também `players[vencedor].wins += 1`.
  - Time: se `score[X] >= best_of//2 + 1` → `status = "series_over"`, `series_winner = X`; senão `match_over`.
  - Duelo: sempre `match_over` (sem série). Em `next_match`, o perdedor vai para o fim da `queue` como observador e o
    primeiro da fila conectado assume o lado do perdedor (se fila vazia, os mesmos jogam de novo).
- `next_match` (match_over) inicia nova partida. `back_to_lobby` zera placar/partida e volta ao lobby.
- **Desconexão**: jogador fica `connected:false`; se era perguntador/respondedor da vez, o rodízio pula para outro
  conectado do lado; se o lado ficar sem conectados por 60 s durante a partida, o outro lado vence por W.O.
  Anfitrião saiu → próximo conectado vira anfitrião. Sala sem conectados por 10 min é apagada.
- **Chat**: no lobby e em `match_over/series_over` → canal `room` para todos. Durante `playing`: jogador → canal `team`
  (só o próprio lado); observador → canal `spectators` (só observadores). Rate limit simples (5 msgs/5 s).
- `flip` só afeta o tabuleiro do próprio lado (no team, todo o time vê o mesmo tabuleiro).
- Máx. 12 conectados por sala.

## Testes
`pytest` cobre: regras puras (turnos, rodízio, timer via clock injetável, chute, placar, série, fila do duelo,
visibilidade do snapshot), API de temas (validação) e um teste WS com `TestClient` (2 jogadores, partida completa).

## Notas do Backend
Decisões tomadas onde o SPEC era omisso (o contrato acima não muda):
- **Jogador novo** entra como observador (`side: null`); no duelo entra automaticamente no fim da `queue`.
  Em `team`, `queue` é sempre `[]`.
- **Duelo / `join_side`**: lado ocupado por jogador conectado → erro "Esse lado já está ocupado."; se o ocupante
  estiver desconectado, ele vira observador e o novo jogador assume o lado. Trocar o modo para `duel` mantém
  apenas o primeiro de cada lado (os demais viram observadores).
- **Desconectados** continuam na lista `players` com `connected:false` (para poderem reconectar com o mesmo lugar).
- **`asker_id`/`answerer_id`** podem ser `null` quando o lado da vez não tem ninguém conectado (o timer segue e,
  após 60 s sem conectados, há W.O.). Quando alguém do lado reconecta, assume a vaga.
- **Log**: entrada `guess` tem `text` = nome do personagem chutado; entrada `timeout` tem `text: null`.
  `ts` de entradas geradas por timeout = o `deadline` que expirou.
- **`next_match` no duelo**: além da troca do perdedor, um lado sem ninguém conectado também é preenchido pelo
  primeiro conectado da fila. `wins` (duelo) não é zerado por `back_to_lobby` (só `score`, partida e série).
  `back_to_lobby` reinicia a numeração (próxima partida é a nº 1, começando com A).
- **Páginas**: `GET /sala/{code}` inexistente → `303` para `/?erro=sala_nao_encontrada`.
- **WebSocket**: o servidor aceita e então fecha com: `4404` sala inexistente; `4400` `player_id` não é UUID;
  `4409` sala cheia (12 conectados; antes envia `{"type":"error"}`); `4000` conexão substituída por outra aba do
  mesmo `player_id`. `name` vazio vira "Jogador"; `color` fora da paleta vira `#FFC93C`.
- **`GET /api/rooms`** lista só salas públicas com ao menos 1 conectado. Salas criadas e nunca usadas também
  expiram após 10 min.
- **Erros HTTP** genéricos (404/405/validação do FastAPI) também saem como `{"detail": "..."}` em pt-BR.
- Rota extra `GET /healthz` → `{"status":"ok"}`.

## Notas de integração (PM)
- `state` traz `server_now` (epoch ms do servidor no envio); o timer usa `deadline - server_now`.
- `match.down_counts` = `{"A": n, "B": n}`: quantas cartas cada lado virou (visível a todos, sem revelar quais).
