// Sala: lobby, partida (jogador), observador e fim de partida — tudo renderizado a partir do último snapshot `state`.
import {
  getIdentity, saveIdentity, cleanName, colorPicker, api, toast, h, avatar, safeColor,
  getMyThemes, normalizeCode,
} from './common.js';

const $ = (id) => document.getElementById(id);
const CODE = normalizeCode(document.body.dataset.code || decodeURIComponent(location.pathname.split('/').pop() || ''));
const params = new URLSearchParams(location.search);
let pendingTheme = params.get('tema');

let me = getIdentity();
let ws = null;
let retry = 0;
let retryTimer = null;
let S = null; // último snapshot
let everConnected = false;

// ======================== Conexão ========================
function wsUrl() {
  const q = new URLSearchParams({ player_id: me.player_id, name: me.name, color: me.color });
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(CODE)}?${q}`;
}

function connect() {
  clearTimeout(retryTimer);
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  const sock = ws;
  sock.addEventListener('open', () => {
    retry = 0;
    everConnected = true;
    setConn(null);
  });
  sock.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'state') { S = msg; render(); }
    else if (msg.type === 'chat') addChat(msg);
    else if (msg.type === 'error') toast(msg.message || 'Ação inválida.', 'error');
  });
  sock.addEventListener('close', (ev) => {
    if (sock !== ws) return;
    if (ev.code === 4404) {
      location.href = '/?erro=sala_nao_encontrada';
      return;
    }
    if (ev.code === 4000) {
      stopWithMessage('Você abriu esta sala em outra aba ou aparelho. Esta aba foi desconectada.', 'Usar esta aba');
      return;
    }
    if (ev.code === 4409) {
      stopWithMessage('A sala está cheia (máximo de 12 pessoas).', 'Tentar de novo');
      return;
    }
    if (ev.code === 4400) {
      me = saveIdentity({ player_id: null });
      me = getIdentity();
    }
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  const delay = Math.min(10000, 500 * 2 ** retry) + Math.floor(Math.random() * 300);
  retry += 1;
  setConn(everConnected ? `Conexão perdida. Reconectando em ${Math.ceil(delay / 1000)} s…` : 'Tentando conectar à sala…');
  retryTimer = setTimeout(connect, delay);
}

function setConn(text, action = null) {
  const el = $('conn-status');
  el.hidden = !text;
  el.replaceChildren(text || '');
  if (action) el.append(' ', action);
}

/** Para de reconectar e mostra um aviso com botão para tentar de novo manualmente. */
function stopWithMessage(text, label) {
  clearTimeout(retryTimer);
  ws = null;
  const btn = h('button', { type: 'button', class: 'btn btn-white btn-sm conn-btn' }, label);
  btn.addEventListener('click', () => { retry = 0; setConn('Conectando…'); connect(); });
  setConn(text, btn);
  if (!S) $('loading-text').textContent = text;
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Sem conexão com a sala. Aguarde a reconexão.', 'error');
    return false;
  }
  ws.send(JSON.stringify(obj));
  return true;
}

window.addEventListener('online', () => { if (!ws || ws.readyState > 1) { retry = 0; connect(); } });

// ======================== Helpers de estado ========================
const other = (side) => (side === 'A' ? 'B' : 'A');
const players = () => (S ? S.players : []);
const playerById = (id) => players().find((p) => p.id === id);
const nameOf = (id) => playerById(id)?.name || 'Alguém';
const isDuel = () => S?.room.mode === 'duel';
const charById = (id) => S?.match?.characters.find((c) => c.id === id);
// Entradas `guess` do log trazem o nome chutado em `text` (aceita id também).
const charByText = (t) => charById(t) || S?.match?.characters.find((c) => c.name === t);

function sideLabel(side, short = false) {
  if (!side) return '';
  if (isDuel()) {
    const p = players().find((x) => x.side === side);
    return p ? p.name : (side === 'A' ? 'Jogador 1' : 'Jogador 2');
  }
  if (short) return side === 'A' ? 'Amarelo' : 'Coral';
  return side === 'A' ? 'Time Amarelo' : 'Time Coral';
}

function currentView() {
  if (!S) return 'loading';
  if (S.room.status === 'lobby') return 'lobby';
  if (S.you.role === 'player' && S.you.side) return 'game';
  return 'spec';
}

function showView(v) {
  for (const id of ['loading', 'lobby', 'game', 'spec']) $(`view-${id}`).hidden = id !== v;
}

// ======================== Render principal ========================
let lastView = null;
function render() {
  const view = currentView();
  if (view !== lastView) {
    showView(view);
    if (view === 'game') guessMode = false;
    lastView = view;
  }
  document.title = `Cara a Cara · ${S.room.name || `Sala ${S.room.code}`}`;
  placeChat(view);
  if (view === 'lobby') renderLobby();
  else if (view === 'game') renderGame();
  else if (view === 'spec') renderSpec();
  syncTimer();
  renderResult();
  maybeApplyPendingTheme();
}

function maybeApplyPendingTheme() {
  if (!pendingTheme || !S) return;
  if (S.room.status === 'lobby' && S.you.is_host && S.room.settings.theme_id !== pendingTheme) {
    send({ type: 'set_settings', theme_id: pendingTheme });
  }
  pendingTheme = null;
  history.replaceState(null, '', location.pathname);
}

// ======================== Lobby ========================
const MODE_HINT = {
  team: 'Cada time tem um segredo e um tabuleiro. Os membros se revezam para perguntar.',
  duel: 'Dois jogadores se enfrentam; o vencedor fica na mesa e o próximo da fila entra.',
};

function memberItem(p, { tag = '', compact = false, extra = '' } = {}) {
  const you = p.id === me.player_id;
  const li = h('li', { class: `member${p.connected ? '' : ' is-offline'}${compact ? ' member-compact' : ''}` },
    avatar(p.name, p.color, compact ? 'avatar-sm' : ''),
    h('span', { class: 'member-name' }, p.name, you ? h('span', { class: 'you-tag' }, ' (você)') : null),
    extra ? h('span', { class: 'member-extra' }, extra) : null,
    tag ? h('span', { class: 'member-tag' }, tag) : null,
    !p.connected ? h('span', { class: 'member-tag tag-off' }, 'OFFLINE') : null);
  return li;
}

function renderLobby() {
  const { room, you } = S;
  const host = you.is_host;
  const duel = room.mode === 'duel';
  $('lobby-code').textContent = room.code;
  $('lobby-room-name').textContent = room.name || `Sala ${room.code}`;
  const hostP = playerById(room.host_id);
  $('lobby-host-note').textContent = host ? 'Você é o anfitrião' : (hostP ? `Anfitrião: ${hostP.name}` : '');

  // Modo
  for (const [id, mode] of [['mode-duel', 'duel'], ['mode-team', 'team']]) {
    const b = $(id);
    b.setAttribute('aria-checked', String(room.mode === mode));
    b.disabled = !host;
    b.tabIndex = room.mode === mode ? 0 : -1;
  }
  $('mode-hint').textContent = MODE_HINT[room.mode] + (host ? '' : ' Só o anfitrião muda o modo.');

  // Lados
  for (const side of ['A', 'B']) {
    const members = players().filter((p) => p.side === side);
    $(`side-name-${side}`).textContent = duel ? (side === 'A' ? 'Jogador 1' : 'Jogador 2') : sideLabel(side);
    $(`side-count-${side}`).textContent = duel ? `${members.length} / 1` : (members.length === 1 ? '1 jogador' : `${members.length} jogadores`);
    const list = $(`side-list-${side}`);
    list.replaceChildren(...members.map((p) => memberItem(p, { tag: p.id === room.host_id ? 'ANFITRIÃO' : '' })));
    if (!members.length) list.append(h('li', { class: 'member-empty' }, duel ? 'Lugar vago' : 'Ninguém ainda'));
    const btn = $(`join-${side}`);
    const occupied = duel && members.some((p) => p.id !== me.player_id);
    if (you.side === side) { btn.disabled = true; btn.textContent = duel ? 'Você está aqui' : 'Você está neste time'; }
    else if (occupied) { btn.disabled = true; btn.textContent = 'Lugar ocupado'; }
    else { btn.disabled = false; btn.textContent = duel ? `Jogar como ${side === 'A' ? 'Jogador 1' : 'Jogador 2'}` : `Entrar no ${sideLabel(side)}`; }
  }

  // Observadores (no duelo, em ordem de fila)
  let watchers = players().filter((p) => !p.side);
  const queue = S.queue || [];
  if (duel) {
    watchers = watchers.slice().sort((a, b) => qpos(queue, a.id) - qpos(queue, b.id));
  }
  $('obs-count').textContent = String(watchers.length);
  $('obs-list').replaceChildren(...watchers.map((p) => {
    const pos = queue.indexOf(p.id);
    return memberItem(p, { compact: true, tag: p.id === room.host_id ? 'ANFITRIÃO' : '', extra: duel && pos >= 0 ? `${pos + 1}º na fila` : '' });
  }));
  if (!watchers.length) $('obs-list').append(h('li', { class: 'member-empty' }, 'Ninguém assistindo'));
  const ob = $('join-obs');
  ob.disabled = !you.side;
  ob.textContent = you.side ? 'Virar observador' : 'Você está assistindo';
  $('obs-hint').textContent = duel
    ? 'Quem assiste entra na fila e joga contra o vencedor. O chat dos observadores não chega aos jogadores.'
    : 'Quem não escolhe lado assiste aos dois tabuleiros. O chat dos observadores não chega aos jogadores.';

  // Configurações
  const st = room.settings;
  renderThemeSelect();
  const turn = $('set-turn');
  if (![...turn.options].some((o) => o.value === String(st.turn_seconds))) {
    turn.append(h('option', { value: String(st.turn_seconds) }, `${st.turn_seconds} segundos`));
  }
  turn.value = String(st.turn_seconds);
  $('set-best').value = String(st.best_of);
  $('best-field').hidden = duel;
  $('set-public').checked = !!st.public;
  for (const id of ['set-theme', 'set-turn', 'set-best', 'set-public']) $(id).disabled = !host;

  const ready = ['A', 'B'].every((s) => players().some((p) => p.side === s && p.connected));
  const start = $('start-btn');
  start.hidden = !host;
  start.disabled = !ready;
  $('start-hint').textContent = host
    ? (ready ? 'Tudo pronto. Bora!' : 'Precisa de pelo menos 1 jogador em cada lado.')
    : `Aguardando ${hostP ? hostP.name : 'o anfitrião'} começar a partida.`;
}

function qpos(queue, id) {
  const i = queue.indexOf(id);
  return i < 0 ? 999 : i;
}

$('mode-duel').addEventListener('click', () => send({ type: 'set_mode', mode: 'duel' }));
$('mode-team').addEventListener('click', () => send({ type: 'set_mode', mode: 'team' }));
for (const b of [$('mode-duel'), $('mode-team')]) {
  b.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const nextId = b.id === 'mode-duel' ? 'mode-team' : 'mode-duel';
    $(nextId).focus();
    $(nextId).click();
  });
}
$('join-A').addEventListener('click', () => send({ type: 'join_side', side: 'A' }));
$('join-B').addEventListener('click', () => send({ type: 'join_side', side: 'B' }));
$('join-obs').addEventListener('click', () => send({ type: 'join_side', side: null }));
$('set-theme').addEventListener('change', (e) => send({ type: 'set_settings', theme_id: e.target.value }));
$('set-turn').addEventListener('change', (e) => send({ type: 'set_settings', turn_seconds: Number(e.target.value) }));
$('set-best').addEventListener('change', (e) => send({ type: 'set_settings', best_of: Number(e.target.value) }));
$('set-public').addEventListener('change', (e) => send({ type: 'set_settings', public: e.target.checked }));
$('settings-form').addEventListener('submit', (e) => e.preventDefault());
$('start-btn').addEventListener('click', () => send({ type: 'start' }));

$('copy-link').addEventListener('click', async () => {
  const url = `${location.origin}/sala/${CODE}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado! Mande para a galera.', 'success');
  } catch {
    const tmp = h('input', { value: url, 'aria-hidden': 'true', class: 'sr-only' });
    document.body.append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    toast(ok ? 'Link copiado! Mande para a galera.' : `Copie o link: ${url}`, ok ? 'success' : 'info', 6000);
  }
});

// Temas
let themes = null;
let themesLoadedAt = 0;
async function loadThemes(force = false) {
  if (!force && Date.now() - themesLoadedAt < 4000) return;
  themesLoadedAt = Date.now();
  try {
    const list = await api('/api/themes');
    themes = Array.isArray(list) ? list : [];
    if (S && currentView() === 'lobby') renderThemeSelect();
  } catch { /* mantém a lista anterior */ }
}

function renderThemeSelect() {
  const sel = $('set-theme');
  if (document.activeElement === sel && sel.dataset.sig) return; // não atrapalha quem está escolhendo
  const st = S.room.settings;
  const pub = themes || [];
  const pubIds = new Set(pub.map((t) => t.id));
  const mine = getMyThemes().filter((t) => !pubIds.has(t.id));
  const known = pubIds.has(st.theme_id) || mine.some((t) => t.id === st.theme_id);
  const sig = JSON.stringify([pub.map((t) => [t.id, t.name, t.count]), mine.map((t) => t.id), st.theme_id, st.theme_name]);
  if (sel.dataset.sig !== sig) {
    const opts = pub.map((t) => h('option', { value: t.id },
      t.id === 'classic' ? `${t.name} (${t.count} personagens)` : `${t.name} · por ${t.author} (${t.count})`));
    if (!pub.length && st.theme_id === 'classic') opts.push(h('option', { value: 'classic' }, 'Clássico (24 personagens)'));
    const nodes = [...opts];
    if (mine.length) nodes.push(h('optgroup', { label: 'Seus temas' }, mine.map((t) => h('option', { value: t.id }, t.name))));
    if (!known && !(st.theme_id === 'classic' && !pub.length)) nodes.push(h('option', { value: st.theme_id }, st.theme_name || 'Tema escolhido'));
    sel.replaceChildren(...nodes);
    sel.dataset.sig = sig;
  }
  sel.value = st.theme_id;
}
$('set-theme').addEventListener('focus', () => loadThemes());
window.addEventListener('focus', () => { if (currentView() === 'lobby') loadThemes(); });

// ======================== Partida (jogador) ========================
let guessMode = false;
let boardKey = '';
const cardEls = new Map();

function canAsk() {
  const m = S?.match;
  return !!m && S.room.status === 'playing' && m.phase === 'asking' && m.asker_id === me.player_id;
}

function scoreText() {
  return `${S.score?.A ?? 0} x ${S.score?.B ?? 0}`;
}

function bannerFor(mySide) {
  const m = S.match;
  if (!m) return { text: 'Preparando a partida…', mine: false };
  if (m.phase === 'over' || S.room.status !== 'playing') {
    return { text: m.winner_side ? `Fim da partida: ${winnerPhrase(m.winner_side)}` : 'Partida encerrada', mine: false };
  }
  const asker = nameOf(m.asker_id);
  const answerer = m.answerer_id ? nameOf(m.answerer_id) : '';
  if (m.phase === 'asking') {
    if (!m.asker_id) return { text: `Vez ${m.turn_side === mySide ? 'do seu lado' : `de ${sideLabel(m.turn_side)}`}: ninguém conectado para perguntar.`, mine: false };
    if (m.asker_id === me.player_id) return { text: 'Sua vez de perguntar (ou chutar)!', mine: true };
    if (m.turn_side === mySide) return { text: `Vez do seu time: ${asker} está perguntando.`, mine: false };
    return { text: isDuel() ? `Vez de ${asker} perguntar.` : `Vez do ${sideLabel(m.turn_side)}: ${asker} está perguntando.`, mine: false };
  }
  // answering
  const q = m.pending_question?.text || '';
  if (m.answerer_id === me.player_id) return { text: `Responda: ${q}`, mine: true };
  if (m.turn_side === mySide) return { text: `Aguardando ${answerer || 'o outro lado'} responder.`, mine: false };
  return { text: `${answerer || 'Seu time'} está respondendo: ${q}`, mine: false };
}

function winnerPhrase(side) {
  const mySide = S.you.side;
  if (mySide && S.you.role === 'player') {
    if (side === mySide) return isDuel() ? 'você venceu!' : 'seu time venceu!';
    return isDuel() ? `${sideLabel(side)} venceu.` : `o ${sideLabel(side)} venceu.`;
  }
  return `${sideLabel(side)} venceu.`;
}

function setFigure(fig, ch, caption) {
  const img = fig.querySelector('img');
  const cap = fig.querySelector('figcaption');
  if (ch) {
    if (img.getAttribute('src') !== ch.image_url) img.src = ch.image_url;
    img.alt = ch.name;
    img.hidden = false;
    cap.textContent = caption ?? ch.name;
  } else {
    img.removeAttribute('src');
    img.alt = '';
    img.hidden = true;
    cap.textContent = caption ?? '?';
  }
}

function renderGame() {
  const { room, you } = S;
  const m = S.match;
  const mySide = you.side;
  $('g-room-name').textContent = room.name || `Sala ${room.code}`;
  $('g-room-sub').textContent = `Sala ${room.code} · ${isDuel() ? 'Duelo 1x1' : 'Time x Time'} · Tema ${room.settings.theme_name}`;
  const bn = bannerFor(mySide);
  const banner = $('g-banner');
  banner.textContent = bn.text;
  banner.classList.toggle('is-mine', bn.mine);
  banner.classList.toggle('is-other', !bn.mine && m && m.turn_side !== mySide);
  $('g-match-n').textContent = m ? (isDuel() ? `Partida ${m.number}` : `Partida ${m.number} de ${room.settings.best_of}`) : '';

  $('g-score-name-A').textContent = sideLabel('A', true);
  $('g-score-name-B').textContent = sideLabel('B', true);
  $('g-score').textContent = scoreText();
  $('g-score').setAttribute('aria-label', `${sideLabel('A')} ${S.score?.A ?? 0}, ${sideLabel('B')} ${S.score?.B ?? 0}`);

  $('g-secret-title').textContent = isDuel() ? 'Seu segredo' : 'Segredo do seu time';
  const secretCard = $('g-secret');
  secretCard.classList.toggle('secret-card-coral', mySide === 'B');
  setFigure(secretCard, m && charById(m.secrets?.[mySide]));

  // Times
  const sides = [mySide, other(mySide)];
  $('g-teams').replaceChildren(...sides.map((side) => {
    const mem = players().filter((p) => p.side === side);
    const title = side === mySide ? (isDuel() ? 'Você' : `Seu time · ${sideLabel(side, true)}`) : (isDuel() ? 'Adversário' : sideLabel(side));
    const downN = m?.down_counts?.[side] ?? m?.boards?.[side]?.down?.length;
    const left = m && downN != null ? `restam ${m.characters.length - downN}` : '';
    return h('div', { class: `team-block team-${side}` },
      h('div', { class: 'team-block-head' }, h('span', { class: `team-name side-color-${side}` }, title), h('span', { class: 'team-left' }, left)),
      h('ul', { class: 'member-list member-list-tight' }, mem.map((p) => {
        let tag = '';
        if (m && m.phase !== 'over') {
          if (p.id === m.asker_id) tag = 'PERGUNTA';
          else if (p.id === m.answerer_id) tag = 'RESPONDE';
        }
        return memberItem(p, { compact: true, tag });
      })));
  }));
  const nWatch = players().filter((p) => !p.side && p.connected).length;
  $('g-watchers').textContent = nWatch ? (nWatch === 1 ? '1 observador assistindo' : `${nWatch} observadores assistindo`) : '';

  // Painel de resposta
  const answering = m && room.status === 'playing' && m.phase === 'answering' && m.answerer_id === me.player_id;
  const ap = $('g-answer');
  ap.hidden = !answering;
  if (answering) {
    $('g-answer-who').textContent = `${nameOf(m.pending_question?.asker_id || m.asker_id)} perguntou:`;
    $('g-answer-q').textContent = m.pending_question?.text || '';
    $('g-answer-secret').textContent = charById(m.secrets?.[mySide])?.name || '';
  }

  // Modo chute
  if (guessMode && !canAsk()) guessMode = false;
  $('g-guessbar').hidden = !guessMode;
  $('g-board').classList.toggle('is-guessing', guessMode);

  renderBoard(m, mySide);

  // Pergunta / chute
  const ask = canAsk();
  const input = $('ask-input');
  input.disabled = !ask || guessMode;
  $('ask-send').disabled = !ask || guessMode;
  input.placeholder = ask ? 'Seu personagem usa chapéu?' : 'Aguarde a sua vez de perguntar';
  $('ask-label').textContent = ask ? 'Sua pergunta' : 'Sua pergunta (não é sua vez)';
  const gb = $('guess-btn');
  gb.disabled = !ask;
  gb.textContent = guessMode ? 'Cancelar chute' : 'Chutar personagem';

  renderLog($('g-log'), mySide);
}

function renderBoard(m, mySide) {
  const board = $('g-board');
  if (!m) { board.replaceChildren(); boardKey = ''; cardEls.clear(); return; }
  const key = `${m.number}|${m.characters.map((c) => c.id).join(',')}`;
  if (key !== boardKey) {
    boardKey = key;
    cardEls.clear();
    board.replaceChildren(...m.characters.map((c) => {
      const img = h('img', { src: c.image_url, alt: '', loading: 'lazy', draggable: 'false' });
      const btn = h('button', { type: 'button', class: 'char-card', dataset: { id: c.id } },
        h('span', { class: 'char-img' }, img), h('span', { class: 'char-name' }, c.name));
      btn.addEventListener('click', () => onCardClick(c.id));
      cardEls.set(c.id, btn);
      return btn;
    }));
  }
  const down = new Set(m.boards?.[mySide]?.down || []);
  const playing = S.room.status === 'playing' && m.phase !== 'over';
  for (const c of m.characters) {
    const btn = cardEls.get(c.id);
    const isDown = down.has(c.id);
    btn.classList.toggle('is-down', isDown);
    btn.setAttribute('aria-pressed', String(isDown));
    btn.setAttribute('aria-label', guessMode ? `Chutar ${c.name}` : `${c.name}${isDown ? ', virado' : ''}`);
    btn.disabled = !playing;
    btn.classList.toggle('is-target', m.phase === 'over' && m.secrets?.[other(mySide)] === c.id);
  }
  const left = m.characters.length - down.size;
  $('g-remaining').textContent = guessMode
    ? 'Escolha o personagem do chute'
    : `Clique para virar quem você já descartou · restam ${left}`;
  $('g-unflip').disabled = !playing || down.size === 0;
}

function onCardClick(id) {
  const m = S?.match;
  if (!m) return;
  if (guessMode) { openGuessDialog(id); return; }
  const down = (m.boards?.[S.you.side]?.down || []).includes(id);
  send({ type: 'flip', character_id: id, down: !down });
}

$('g-unflip').addEventListener('click', () => {
  const m = S?.match;
  if (!m) return;
  for (const id of m.boards?.[S.you.side]?.down || []) send({ type: 'flip', character_id: id, down: false });
});

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('ask-input');
  const text = input.value.replace(/\s+/g, ' ').trim();
  if (!text) { input.focus(); return; }
  if (text.length > 140) { toast('A pergunta pode ter no máximo 140 caracteres.', 'error'); return; }
  if (send({ type: 'ask', text })) input.value = '';
});

$('ans-yes').addEventListener('click', () => send({ type: 'answer', answer: 'yes' }));
$('ans-no').addEventListener('click', () => send({ type: 'answer', answer: 'no' }));

$('guess-btn').addEventListener('click', () => {
  if (!canAsk()) return;
  guessMode = !guessMode;
  renderGame();
  if (guessMode) {
    toast('Clique no personagem que você quer chutar.', 'info', 2500);
    cardEls.values().next().value?.focus();
  }
});
$('guess-cancel').addEventListener('click', () => { guessMode = false; renderGame(); $('guess-btn').focus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && guessMode && !$('guess-dialog').open) { guessMode = false; renderGame(); }
});

let guessPick = null;
function openGuessDialog(id) {
  const ch = charById(id);
  if (!ch) return;
  guessPick = id;
  setFigure($('guess-pick'), ch);
  $('guess-title').textContent = `Chutar ${ch.name}?`;
  $('guess-dialog').showModal();
  $('guess-confirm').focus();
}
$('guess-dialog').addEventListener('close', () => {
  const dlg = $('guess-dialog');
  if (dlg.returnValue === 'ok' && guessPick && canAsk()) {
    send({ type: 'guess', character_id: guessPick });
    guessMode = false;
    if (S) renderGame();
  }
  dlg.returnValue = '';
  guessPick = null;
});

// ======================== Log ========================
function badge(text, kind) {
  return h('span', { class: `badge badge-${kind}` }, text);
}

function logWho(e, mySide) {
  const name = nameOf(e.player_id);
  const verb = e.kind === 'guess' ? 'chutou' : e.kind === 'timeout' ? 'deixou o tempo acabar' : 'perguntou';
  if (e.player_id === me.player_id) return `Você ${verb}`;
  if (isDuel()) return `${name} ${verb}`;
  if (mySide) {
    if (e.side === mySide) return `${name} (seu time) ${verb}`;
    return `${name} (${sideLabel(e.side, true)}) ${verb}${e.kind === 'question' ? ' ao seu time' : ''}`;
  }
  return `${name} (${sideLabel(e.side, true)}) ${verb}`;
}

function renderLog(list, mySide) {
  const m = S.match;
  const items = [];
  if (m && m.phase === 'answering' && m.pending_question) {
    items.push(h('li', { class: `log-item log-pending side-${m.turn_side}` },
      h('span', { class: 'log-who' }, `${logWho({ kind: 'question', player_id: m.pending_question.asker_id || m.asker_id, side: m.turn_side }, mySide)} · aguardando`),
      h('div', { class: 'log-row' }, h('span', { class: 'log-text' }, m.pending_question.text), badge('…', 'wait'))));
  }
  const log = (m?.log || []).slice().reverse();
  for (const e of log) {
    let text = e.text || '';
    let b = null;
    if (e.kind === 'question') {
      b = e.answer === 'yes' ? badge('SIM', 'yes') : e.answer === 'no' ? badge('NÃO', 'no') : badge('TEMPO', 'time');
    } else if (e.kind === 'guess') {
      const ch = charByText(e.text);
      text = ch ? `É ${ch.name}?` : (text || 'Chute');
      b = e.correct ? badge('ACERTOU', 'hit') : badge('ERROU', 'no');
    } else if (e.kind === 'timeout') {
      text = text || 'Não perguntou a tempo.';
      b = badge('TEMPO', 'time');
    }
    items.push(h('li', { class: `log-item side-${e.side || 'x'}` },
      h('span', { class: 'log-who' }, logWho(e, mySide)),
      h('div', { class: 'log-row' }, h('span', { class: 'log-text' }, text), b)));
  }
  if (!items.length) items.push(h('li', { class: 'log-empty' }, 'Nenhuma pergunta ainda. As perguntas e respostas aparecem aqui.'));
  list.replaceChildren(...items);
}

// ======================== Observador ========================
const specBoards = { A: { key: '', els: new Map() }, B: { key: '', els: new Map() } };

function renderSpec() {
  const { room } = S;
  const m = S.match;
  $('s-room-name').textContent = room.name || `Sala ${room.code}`;
  $('s-room-sub').textContent = `Sala ${room.code} · Você está observando`;
  $('s-score-name-A').textContent = sideLabel('A');
  $('s-score-name-B').textContent = sideLabel('B');
  $('s-score').textContent = scoreText();

  const qp = $('s-queue');
  const pos = (S.queue || []).indexOf(me.player_id);
  qp.hidden = !(isDuel() && pos >= 0);
  qp.textContent = pos === 0 ? 'Você é o próximo da fila' : `Você é o ${pos + 1}º da fila`;

  let banner = 'Aguardando a partida…';
  if (m) {
    if (m.phase === 'over' || room.status !== 'playing') banner = m.winner_side ? `Fim da partida ${m.number}: ${sideLabel(m.winner_side)} venceu.` : 'Partida encerrada.';
    else if (m.phase === 'asking' && !m.asker_id) banner = `Vez de ${sideLabel(m.turn_side)}: ninguém conectado para perguntar.`;
    else if (m.phase === 'asking') banner = `Vez ${isDuel() ? 'de' : 'do'} ${sideLabel(m.turn_side)}: ${nameOf(m.asker_id)} pergunta.`;
    else banner = `${nameOf(m.asker_id)} perguntou "${m.pending_question?.text || ''}" · ${m.answerer_id ? nameOf(m.answerer_id) : 'o outro lado'} responde.`;
  }
  $('s-banner').textContent = banner;

  for (const side of ['A', 'B']) {
    const mem = players().filter((p) => p.side === side);
    $(`s-name-${side}`).textContent = sideLabel(side);
    $(`s-members-${side}`).textContent = mem.map((p) => p.name + (p.connected ? '' : ' (offline)')).join(', ') || 'Ninguém';
    let status = '';
    if (m && m.phase !== 'over') {
      if (m.turn_side === side) status = m.phase === 'asking' ? 'Perguntando agora' : 'Esperando a resposta';
      else status = m.phase === 'answering' ? 'Respondendo' : 'Aguardando';
    } else if (m?.winner_side) status = m.winner_side === side ? 'Venceu a partida' : 'Perdeu a partida';
    const down = m?.boards?.[side]?.down || [];
    if (m) status += `${status ? ' · ' : ''}restam ${m.characters.length - down.length}`;
    $(`s-status-${side}`).textContent = status;
    const sec = m && charById(m.secrets?.[side]);
    setFigure($(`s-secret-${side}`), sec);
    $(`s-secret-${side}`).setAttribute('aria-label', sec ? `Segredo: ${sec.name}` : 'Segredo');
    renderMiniBoard(side, m);
    document.querySelector(`.spec-board[data-side="${side}"]`).classList.toggle('is-turn', !!m && m.phase !== 'over' && m.turn_side === side);
  }
  renderLog($('s-log'), null);
}

function renderMiniBoard(side, m) {
  const sb = specBoards[side];
  const el = $(`s-board-${side}`);
  if (!m) { el.replaceChildren(); sb.key = ''; return; }
  const key = `${m.number}|${m.characters.map((c) => c.id).join(',')}`;
  if (key !== sb.key) {
    sb.key = key;
    sb.els.clear();
    el.replaceChildren(...m.characters.map((c) => {
      const d = h('div', { class: 'mini-card', role: 'img' },
        h('img', { src: c.image_url, alt: '', loading: 'lazy', draggable: 'false' }), h('span', {}, c.name));
      sb.els.set(c.id, d);
      return d;
    }));
  }
  const down = new Set(m.boards?.[side]?.down || []);
  const target = m.secrets?.[other(side)];
  for (const c of m.characters) {
    const d = sb.els.get(c.id);
    d.classList.toggle('is-down', down.has(c.id));
    d.classList.toggle('is-target', c.id === target);
    d.setAttribute('aria-label', `${c.name}${down.has(c.id) ? ', virado' : ''}${c.id === target ? ', é o alvo' : ''}`);
  }
}

// ======================== Timer ========================
const CIRC = 2 * Math.PI * 26;
let timerEnd = 0;
let timerTotal = 0;
let lastDeadline = null;

function syncTimer() {
  const m = S?.match;
  if (!m || S.room.status !== 'playing' || m.phase === 'over' || !m.deadline) {
    timerEnd = 0;
    lastDeadline = null;
    tick();
    return;
  }
  timerTotal = (S.room.settings.turn_seconds || 45) * 1000;
  if (m.deadline !== lastDeadline) {
    lastDeadline = m.deadline;
    // Usa a hora do servidor (server_now) para não depender do relógio do cliente.
    const ref = S.server_now || Date.now();
    const remaining = Math.max(0, Math.min(timerTotal, m.deadline - ref));
    timerEnd = performance.now() + remaining;
  }
  tick();
}

function tick() {
  const view = currentView();
  const el = view === 'game' ? $('g-timer') : view === 'spec' ? $('s-timer') : null;
  if (!el) return;
  const num = el.querySelector('.timer-num');
  const fg = el.querySelector('.timer-fg');
  fg.style.strokeDasharray = String(CIRC);
  if (!timerEnd) {
    num.textContent = '–';
    fg.style.strokeDashoffset = String(CIRC);
    el.dataset.level = 'idle';
    el.setAttribute('aria-label', 'Sem cronômetro');
    return;
  }
  const ms = Math.max(0, timerEnd - performance.now());
  const secs = Math.ceil(ms / 1000);
  num.textContent = String(secs);
  fg.style.strokeDashoffset = String(CIRC * (1 - ms / timerTotal));
  el.dataset.level = secs <= 5 ? 'danger' : secs <= 10 ? 'warn' : 'ok';
  el.setAttribute('aria-label', `Tempo restante ${secs} segundos`);
}
setInterval(tick, 250);

// ======================== Fim de partida ========================
let dismissedKey = '';
function renderResult() {
  const dlg = $('result-dialog');
  const reopen = $('result-reopen');
  const st = S.room.status;
  const m = S.match;
  const over = (st === 'match_over' || st === 'series_over') && m;
  if (!over) {
    if (dlg.open) dlg.close();
    reopen.hidden = true;
    return;
  }
  const key = `${st}|${m.number}`;
  const mySide = S.you.role === 'player' ? S.you.side : null;
  const win = st === 'series_over' ? (S.series_winner || m.winner_side) : m.winner_side;

  $('result-kicker').textContent = st === 'series_over' ? 'Fim da série' : `Fim da partida ${m.number}`;
  let title = 'Partida encerrada';
  if (win) {
    if (mySide) {
      const mine = win === mySide;
      if (st === 'series_over') title = mine ? (isDuel() ? 'Você é campeão!' : 'Vocês são campeões!') : `${sideLabel(win)} é campeão!`;
      else title = mine ? (isDuel() ? 'Você venceu!' : 'Seu time venceu!') : (isDuel() ? 'Você perdeu!' : 'Seu time perdeu!');
    } else {
      title = st === 'series_over' ? `${sideLabel(win)} é campeão!` : `${sideLabel(win)} venceu!`;
    }
  }
  $('result-title').textContent = title;
  $('result-title').className = `result-title${win ? ` side-color-${win}` : ''}`;

  const last = (m.log || [])[m.log.length - 1];
  let reason = '';
  if (last && last.kind === 'guess') {
    const ch = charByText(last.text);
    const who = last.player_id === me.player_id ? 'Você' : nameOf(last.player_id);
    reason = last.correct
      ? `${who} acertou: era ${ch ? ch.name : 'o personagem certo'}!`
      : (ch || last.text ? `${who} chutou ${ch ? ch.name : last.text} e errou.` : `${who} chutou errado.`);
  } else if (win) {
    reason = 'Vitória por W.O.: o outro lado ficou sem jogadores conectados.';
  }
  $('result-reason').textContent = reason;

  const sc = $('result-score');
  sc.replaceChildren(
    h('span', { class: 'side-color-A' }, sideLabel('A', true)),
    h('strong', {}, scoreText()),
    h('span', { class: 'side-color-B' }, sideLabel('B', true)));

  for (const side of ['A', 'B']) {
    const fig = $(`reveal-${side}`);
    fig.className = `reveal-card reveal-${side}${win === side ? ' is-winner' : ''}`;
    fig.querySelector('.reveal-label').textContent = isDuel() ? `Segredo de ${sideLabel(side)}` : `Segredo do ${sideLabel(side)}`;
    setFigure(fig, charById(m.secrets?.[side]));
  }

  const host = S.you.is_host;
  $('next-match').hidden = !(host && st === 'match_over');
  $('back-lobby').hidden = !host;
  const hostP = playerById(S.room.host_id);
  $('wait-host').hidden = host;
  $('wait-host').textContent = `Aguardando ${hostP ? hostP.name : 'o anfitrião'} ${st === 'match_over' ? 'começar a próxima partida' : 'voltar ao lobby'}…`;

  if (dismissedKey === key) {
    if (dlg.open) dlg.close();
    reopen.hidden = false;
  } else {
    reopen.hidden = true;
    if (!dlg.open) {
      for (const d of [$('guess-dialog')]) if (d.open) d.close();
      dlg.showModal();
      (host ? ($('next-match').hidden ? $('back-lobby') : $('next-match')) : $('result-close')).focus();
    }
  }
  $('result-close').onclick = () => { dismissedKey = key; dlg.close(); reopen.hidden = false; };
  dlg.oncancel = (e) => { e.preventDefault(); $('result-close').click(); };
}
$('result-reopen').addEventListener('click', () => { dismissedKey = ''; renderResult(); });
$('next-match').addEventListener('click', () => send({ type: 'next_match' }));
$('back-lobby').addEventListener('click', () => send({ type: 'back_to_lobby' }));

// ======================== Chat ========================
const chatBox = $('chat-box');
const chatList = $('chat-list');
let unread = 0;

function chatContext(view) {
  const playing = S?.room.status === 'playing';
  if (view === 'lobby' || !playing) return { title: 'Chat da sala', label: 'Mensagem para a sala', ph: 'Diga oi para a sala', tab: 'Chat da sala' };
  if (view === 'game') return { title: 'Chat do time', label: 'Mensagem (só seu time vê)', ph: 'Combine a próxima pergunta…', tab: 'Chat do time' };
  return { title: 'Chat dos observadores', label: 'Mensagem (só observadores veem)', ph: 'Comente a partida…', tab: 'Chat' };
}

function placeChat(view) {
  const slot = view === 'lobby' ? $('slot-lobby') : view === 'game' ? $('g-tab-chat') : view === 'spec' ? $('s-tab-chat') : null;
  if (!slot) return;
  if (chatBox.parentElement !== slot) {
    slot.append(chatBox);
    chatList.scrollTop = chatList.scrollHeight;
  }
  const ctx = chatContext(view);
  $('chat-title').textContent = ctx.title;
  $('chat-title').classList.toggle('sr-only', view !== 'lobby');
  $('chat-label').textContent = ctx.label;
  $('chat-input').placeholder = ctx.ph;
  const tabBtn = view === 'game' ? $('g-tabbtn-chat') : view === 'spec' ? $('s-tabbtn-chat') : null;
  if (tabBtn) tabBtn.firstChild.textContent = `${ctx.tab} `;
  updateUnread();
}

function chatVisible() {
  const v = currentView();
  if (v === 'lobby') return true;
  if (v === 'game') return !$('g-tab-chat').hidden;
  if (v === 'spec') return !$('s-tab-chat').hidden;
  return false;
}

function updateUnread() {
  if (chatVisible()) unread = 0;
  for (const id of ['g-unread', 's-unread']) {
    const el = $(id);
    el.hidden = unread === 0;
    el.textContent = unread > 9 ? '9+' : String(unread);
    el.setAttribute('aria-label', `${unread} mensagens novas`);
  }
}

const CHANNEL_TAG = { team: 'time', spectators: 'observadores' };
function addChat(msg) {
  const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 60;
  const mine = msg.player_id === me.player_id;
  const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const li = h('li', { class: `chat-msg${mine ? ' is-mine' : ''}` },
    h('span', { class: 'chat-dot', style: { background: safeColor(msg.color) }, 'aria-hidden': 'true' }),
    h('div', { class: 'chat-body' },
      h('span', { class: 'chat-meta' },
        h('strong', {}, msg.name || 'Alguém'),
        CHANNEL_TAG[msg.channel] ? h('span', { class: 'chat-chan' }, CHANNEL_TAG[msg.channel]) : null,
        time ? h('time', { class: 'chat-time' }, time) : null),
      h('span', { class: 'chat-text' }, msg.text || '')));
  chatList.append(li);
  while (chatList.children.length > 200) chatList.firstElementChild.remove();
  if (nearBottom || mine) chatList.scrollTop = chatList.scrollHeight;
  if (!chatVisible() && !mine) { unread += 1; }
  updateUnread();
}

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.replace(/\s+/g, ' ').trim();
  if (!text) return;
  if (send({ type: 'chat', text: text.slice(0, 200) })) input.value = '';
});

// ======================== Abas ========================
function setupTabs(pairs) {
  const btns = pairs.map(([b]) => $(b));
  pairs.forEach(([btnId, panelId], i) => {
    const btn = $(btnId);
    btn.addEventListener('click', () => select(i));
    btn.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const j = (i + d + pairs.length) % pairs.length;
      select(j);
      btns[j].focus();
    });
    btn.tabIndex = btn.getAttribute('aria-selected') === 'true' ? 0 : -1;
    void panelId;
  });
  function select(i) {
    pairs.forEach(([b, p], j) => {
      $(b).setAttribute('aria-selected', String(i === j));
      $(b).tabIndex = i === j ? 0 : -1;
      $(p).hidden = i !== j;
    });
    if (chatVisible()) { unread = 0; chatList.scrollTop = chatList.scrollHeight; }
    updateUnread();
  }
}
setupTabs([['g-tabbtn-log', 'g-tab-log'], ['g-tabbtn-chat', 'g-tab-chat']]);
setupTabs([['s-tabbtn-chat', 's-tab-chat'], ['s-tabbtn-log', 's-tab-log']]);

// ======================== Apelido / início ========================
function askName() {
  const dlg = $('name-dialog');
  const input = $('name-input');
  input.value = me.name || '';
  const picker = colorPicker($('name-colors'), me.color, (c) => { me = saveIdentity({ color: c }); });
  picker.set(me.color);
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  $('name-form').addEventListener('submit', (e) => {
    const name = cleanName(input.value);
    if (!name) {
      e.preventDefault();
      $('name-error').textContent = 'Digite um apelido de 1 a 20 caracteres.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    me = saveIdentity({ name });
    $('name-error').textContent = '';
    setTimeout(start, 0);
  });
  $('loading-text').textContent = 'Escolha um apelido para entrar.';
  dlg.showModal();
  input.focus();
}

function start() {
  me = getIdentity();
  $('loading-text').textContent = `Entrando na sala ${CODE}…`;
  connect();
  loadThemes(true);
}

if (!CODE) location.href = '/';
else if (!me.name) askName();
else start();
