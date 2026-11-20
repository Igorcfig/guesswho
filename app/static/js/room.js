// Sala: lobby, partida (jogador), observador e fim de partida — tudo renderizado a partir do último snapshot `state`.
import {
  getIdentity, saveIdentity, cleanName, colorPicker, api, toast, h, avatar, safeColor,
  getMyThemes, normalizeCode, t, getLang, onLangChange, roomDisplayName, themeDisplayName,
} from './common.js';
import { locale } from './i18n.js';

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
  const q = new URLSearchParams({ player_id: me.player_id, name: me.name, color: me.color, lang: getLang() });
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
    else if (msg.type === 'error') toast(msg.message || t('r.invalid_action'), 'error');
  });
  sock.addEventListener('close', (ev) => {
    if (sock !== ws) return;
    if (ev.code === 4404) {
      location.href = '/?erro=sala_nao_encontrada';
      return;
    }
    if (ev.code === 4000) {
      stopWithMessage('r.other_tab', 'r.use_tab');
      return;
    }
    if (ev.code === 4409) {
      stopWithMessage('r.full', 'r.try_again');
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
  setConn(everConnected ? ['r.lost', { s: Math.ceil(delay / 1000) }] : ['r.connecting_room']);
  retryTimer = setTimeout(connect, delay);
}

// Aviso de conexão guardado como [chave, vars] para poder ser re-traduzido na troca de idioma.
let connMsg = null;
let connAction = null;
function setConn(msg, action = null) {
  connMsg = msg;
  connAction = action;
  const el = $('conn-status');
  el.hidden = !msg;
  el.replaceChildren(msg ? t(msg[0], msg[1]) : '');
  if (action) el.append(' ', h('button', { type: 'button', class: 'btn btn-white btn-sm conn-btn', onclick: action.onClick }, t(action.label)));
}

// Texto da tela de carregamento, também como [chave, vars].
let loadingMsg = ['room.entering', { code: CODE }];
function setLoading(key, vars) {
  loadingMsg = [key, vars];
  $('loading-text').textContent = t(key, vars);
}

/** Para de reconectar e mostra um aviso com botão para tentar de novo manualmente. */
function stopWithMessage(key, label) {
  clearTimeout(retryTimer);
  ws = null;
  setConn([key], { label, onClick: () => { retry = 0; setConn(['r.connecting']); connect(); } });
  if (!S) setLoading(key);
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast(t('r.no_conn'), 'error');
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
const nameOf = (id) => playerById(id)?.name || t('r.someone');
const isDuel = () => S?.room.mode === 'duel';
const charById = (id) => S?.match?.characters.find((c) => c.id === id);
// Entradas `guess` do log trazem o nome chutado em `text` (aceita id também).
const charByText = (txt) => charById(txt) || S?.match?.characters.find((c) => c.name === txt);

function sideLabel(side, short = false) {
  if (!side) return '';
  if (isDuel()) {
    const p = players().find((x) => x.side === side);
    return p ? p.name : t(side === 'A' ? 'r.p1' : 'r.p2');
  }
  if (short) return t(side === 'A' ? 'r.yellow' : 'r.coral');
  return t(side === 'A' ? 'r.team_a' : 'r.team_b');
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
  document.title = t('r.title', { name: roomName() });
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
const MODE_HINT = { team: 'r.hint_team', duel: 'r.hint_duel' };
const roomName = () => roomDisplayName(S.room.name, S.room.code);
const themeName = () => themeDisplayName(S.room.settings.theme_id, S.room.settings.theme_name);

function memberItem(p, { tag = '', compact = false, extra = '' } = {}) {
  const you = p.id === me.player_id;
  const li = h('li', { class: `member${p.connected ? '' : ' is-offline'}${compact ? ' member-compact' : ''}` },
    avatar(p.name, p.color, compact ? 'avatar-sm' : ''),
    h('span', { class: 'member-name' }, p.name, you ? h('span', { class: 'you-tag' }, t('r.you_tag')) : null),
    extra ? h('span', { class: 'member-extra' }, extra) : null,
    tag ? h('span', { class: 'member-tag' }, tag) : null,
    !p.connected ? h('span', { class: 'member-tag tag-off' }, t('r.offline')) : null);
  return li;
}

function renderLobby() {
  const { room, you } = S;
  const host = you.is_host;
  const duel = room.mode === 'duel';
  $('lobby-code').textContent = room.code;
  $('lobby-room-name').textContent = roomName();
  const hostP = playerById(room.host_id);
  $('lobby-host-note').textContent = host ? t('r.you_host') : (hostP ? t('r.host_is', { name: hostP.name }) : '');

  // Modo
  for (const [id, mode] of [['mode-duel', 'duel'], ['mode-team', 'team']]) {
    const b = $(id);
    b.setAttribute('aria-checked', String(room.mode === mode));
    b.disabled = !host;
    b.tabIndex = room.mode === mode ? 0 : -1;
  }
  $('mode-hint').textContent = t(MODE_HINT[room.mode]) + (host ? '' : t('r.only_host_mode'));

  // Lados
  for (const side of ['A', 'B']) {
    const members = players().filter((p) => p.side === side);
    $(`side-name-${side}`).textContent = duel ? t(side === 'A' ? 'r.p1' : 'r.p2') : sideLabel(side);
    $(`side-count-${side}`).textContent = duel ? `${members.length} / 1` : (members.length === 1 ? t('r.one_player') : t('r.n_players', { n: members.length }));
    const list = $(`side-list-${side}`);
    list.replaceChildren(...members.map((p) => memberItem(p, { tag: p.id === room.host_id ? t('r.host_tag') : '' })));
    if (!members.length) list.append(h('li', { class: 'member-empty' }, duel ? t('r.seat_free') : t('r.nobody_yet')));
    const btn = $(`join-${side}`);
    const occupied = duel && members.some((p) => p.id !== me.player_id);
    if (you.side === side) { btn.disabled = true; btn.textContent = duel ? t('r.you_here') : t('r.you_in_team'); }
    else if (occupied) { btn.disabled = true; btn.textContent = t('r.seat_taken'); }
    else { btn.disabled = false; btn.textContent = duel ? t('r.play_as', { who: t(side === 'A' ? 'r.p1' : 'r.p2') }) : t(side === 'A' ? 'r.join_team_a' : 'r.join_team_b'); }
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
    return memberItem(p, { compact: true, tag: p.id === room.host_id ? t('r.host_tag') : '', extra: duel && pos >= 0 ? t('r.queue_pos', { n: pos + 1 }) : '' });
  }));
  if (!watchers.length) $('obs-list').append(h('li', { class: 'member-empty' }, t('r.nobody_watching')));
  const ob = $('join-obs');
  ob.disabled = !you.side;
  ob.textContent = you.side ? t('r.become_spec') : t('r.watching');
  $('obs-hint').textContent = duel ? t('r.spec_hint_duel') : t('r.spec_hint_team');

  // Configurações
  const st = room.settings;
  renderThemeSelect();
  const turn = $('set-turn');
  if (![...turn.options].some((o) => o.value === String(st.turn_seconds))) {
    turn.append(h('option', { value: String(st.turn_seconds) }));
  }
  for (const o of turn.options) o.textContent = t('room.secs', { n: o.value });
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
    ? (ready ? t('r.ready') : t('r.need_players'))
    : t('r.waiting_start', { host: hostP ? hostP.name : t('r.the_host') });
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
    toast(t('r.copied'), 'success');
  } catch {
    const tmp = h('input', { value: url, 'aria-hidden': 'true', class: 'sr-only' });
    document.body.append(tmp);
    tmp.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    tmp.remove();
    toast(ok ? t('r.copied') : t('r.copy_this', { url }), ok ? 'success' : 'info', 6000);
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
  const pubIds = new Set(pub.map((x) => x.id));
  const mine = getMyThemes().filter((x) => !pubIds.has(x.id));
  const known = pubIds.has(st.theme_id) || mine.some((x) => x.id === st.theme_id);
  const sig = JSON.stringify([getLang(), pub.map((x) => [x.id, x.name, x.count]), mine.map((x) => x.id), st.theme_id, st.theme_name]);
  if (sel.dataset.sig !== sig) {
    const opts = pub.map((x) => h('option', { value: x.id },
      x.id === 'classic'
        ? t('r.theme_opt_classic', { name: themeDisplayName(x.id, x.name), n: x.count })
        : t('r.theme_opt', { name: x.name, author: x.author, n: x.count })));
    if (!pub.length && st.theme_id === 'classic') opts.push(h('option', { value: 'classic' }, t('r.theme_opt_classic', { name: t('theme.classic'), n: 24 })));
    const nodes = [...opts];
    if (mine.length) nodes.push(h('optgroup', { label: t('r.my_themes') }, mine.map((x) => h('option', { value: x.id }, x.name))));
    if (!known && !(st.theme_id === 'classic' && !pub.length)) nodes.push(h('option', { value: st.theme_id }, themeName() || t('r.chosen_theme')));
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
  if (!m) return { text: t('r.preparing'), mine: false };
  if (m.phase === 'over' || S.room.status !== 'playing') {
    return { text: m.winner_side ? t('r.game_over_w', { phrase: winnerPhrase(m.winner_side) }) : t('r.match_ended'), mine: false };
  }
  const asker = nameOf(m.asker_id);
  const answerer = m.answerer_id ? nameOf(m.answerer_id) : '';
  if (m.phase === 'asking') {
    if (!m.asker_id) return { text: m.turn_side === mySide ? t('r.turn_nobody_mine') : t('r.turn_nobody', { side: sideLabel(m.turn_side) }), mine: false };
    if (m.asker_id === me.player_id) return { text: t('r.your_turn'), mine: true };
    if (m.turn_side === mySide) return { text: t('r.team_asking', { name: asker }), mine: false };
    return { text: isDuel() ? t('r.duel_asking', { name: asker }) : t('r.other_asking', { side: sideLabel(m.turn_side), name: asker }), mine: false };
  }
  // answering
  const q = m.pending_question?.text || '';
  if (m.answerer_id === me.player_id) return { text: t('r.answer_q', { q }), mine: true };
  if (m.turn_side === mySide) return { text: t('r.waiting_answer', { name: answerer || t('r.other_side') }), mine: false };
  return { text: t('r.answering', { name: answerer || t('r.your_team'), q }), mine: false };
}

function winnerPhrase(side) {
  const mySide = S.you.side;
  if (mySide && S.you.role === 'player') {
    if (side === mySide) return isDuel() ? t('r.w_you') : t('r.w_your_team');
    return isDuel() ? t('r.w_duel', { side: sideLabel(side) }) : t('r.w_team', { side: sideLabel(side) });
  }
  return t('r.w_duel', { side: sideLabel(side) });
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
  $('g-room-name').textContent = roomName();
  $('g-room-sub').textContent = t('r.room_sub', { code: room.code, mode: t(isDuel() ? 'room.duel' : 'room.team'), theme: themeName() });
  const bn = bannerFor(mySide);
  const banner = $('g-banner');
  banner.textContent = bn.text;
  banner.classList.toggle('is-mine', bn.mine);
  banner.classList.toggle('is-other', !bn.mine && m && m.turn_side !== mySide);
  $('g-match-n').textContent = m ? (isDuel() ? t('r.match_n', { n: m.number }) : t('r.match_n_of', { n: m.number, of: room.settings.best_of })) : '';

  $('g-score-name-A').textContent = sideLabel('A', true);
  $('g-score-name-B').textContent = sideLabel('B', true);
  $('g-score').textContent = scoreText();
  $('g-score').setAttribute('aria-label', `${sideLabel('A')} ${S.score?.A ?? 0}, ${sideLabel('B')} ${S.score?.B ?? 0}`);

  $('g-secret-title').textContent = isDuel() ? t('r.your_secret') : t('r.team_secret');
  const secretCard = $('g-secret');
  secretCard.classList.toggle('secret-card-coral', mySide === 'B');
  setFigure(secretCard, m && charById(m.secrets?.[mySide]));

  // Times
  const sides = [mySide, other(mySide)];
  $('g-teams').replaceChildren(...sides.map((side) => {
    const mem = players().filter((p) => p.side === side);
    const title = side === mySide ? (isDuel() ? t('r.you') : t('r.your_team_side', { side: sideLabel(side, true) })) : (isDuel() ? t('r.opponent') : sideLabel(side));
    const downN = m?.down_counts?.[side] ?? m?.boards?.[side]?.down?.length;
    const left = m && downN != null ? t('r.left_n', { n: m.characters.length - downN }) : '';
    return h('div', { class: `team-block team-${side}` },
      h('div', { class: 'team-block-head' }, h('span', { class: `team-name side-color-${side}` }, title), h('span', { class: 'team-left' }, left)),
      h('ul', { class: 'member-list member-list-tight' }, mem.map((p) => {
        let tag = '';
        if (m && m.phase !== 'over') {
          if (p.id === m.asker_id) tag = t('r.tag_asks');
          else if (p.id === m.answerer_id) tag = t('r.tag_answers');
        }
        return memberItem(p, { compact: true, tag });
      })));
  }));
  const nWatch = players().filter((p) => !p.side && p.connected).length;
  $('g-watchers').textContent = nWatch ? (nWatch === 1 ? t('r.one_watcher') : t('r.n_watchers', { n: nWatch })) : '';

  // Painel de resposta
  const answering = m && room.status === 'playing' && m.phase === 'answering' && m.answerer_id === me.player_id;
  const ap = $('g-answer');
  ap.hidden = !answering;
  if (answering) {
    $('g-answer-who').textContent = t('r.asked', { name: nameOf(m.pending_question?.asker_id || m.asker_id) });
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
  input.placeholder = ask ? t('r.ask_ph') : t('r.wait_turn_ph');
  $('ask-label').textContent = ask ? t('r.your_q') : t('r.your_q_wait');
  const gb = $('guess-btn');
  gb.disabled = !ask;
  gb.textContent = guessMode ? t('r.cancel_guess') : t('r.guess_char');

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
    btn.setAttribute('aria-label', guessMode ? t('r.guess_name', { name: c.name }) : `${c.name}${isDown ? t('r.flipped') : ''}`);
    btn.disabled = !playing;
    btn.classList.toggle('is-target', m.phase === 'over' && m.secrets?.[other(mySide)] === c.id);
  }
  const left = m.characters.length - down.size;
  $('g-remaining').textContent = guessMode
    ? t('r.pick_guess')
    : t('r.flip_hint', { n: left });
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
  if (text.length > 140) { toast(t('r.q_too_long'), 'error'); return; }
  if (send({ type: 'ask', text })) input.value = '';
});

$('ans-yes').addEventListener('click', () => send({ type: 'answer', answer: 'yes' }));
$('ans-no').addEventListener('click', () => send({ type: 'answer', answer: 'no' }));

$('guess-btn').addEventListener('click', () => {
  if (!canAsk()) return;
  guessMode = !guessMode;
  renderGame();
  if (guessMode) {
    toast(t('r.click_guess'), 'info', 2500);
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
  $('guess-title').textContent = t('r.guess_title', { name: ch.name });
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
  const verb = t(e.kind === 'guess' ? 'log.v_guess' : e.kind === 'timeout' ? 'log.v_timeout' : 'log.v_question');
  if (e.player_id === me.player_id) return t('log.you', { verb });
  if (isDuel()) return t('log.name', { name, verb });
  const side = sideLabel(e.side, true);
  if (mySide) {
    if (e.side === mySide) return t('log.name_team', { name, verb });
    return t(e.kind === 'question' ? 'log.name_side_q' : 'log.name_side', { name, side, verb });
  }
  return t('log.name_side', { name, side, verb });
}

function renderLog(list, mySide) {
  const m = S.match;
  const items = [];
  if (m && m.phase === 'answering' && m.pending_question) {
    items.push(h('li', { class: `log-item log-pending side-${m.turn_side}` },
      h('span', { class: 'log-who' }, t('log.waiting', { who: logWho({ kind: 'question', player_id: m.pending_question.asker_id || m.asker_id, side: m.turn_side }, mySide) })),
      h('div', { class: 'log-row' }, h('span', { class: 'log-text' }, m.pending_question.text), badge('…', 'wait'))));
  }
  const log = (m?.log || []).slice().reverse();
  for (const e of log) {
    let text = e.text || '';
    let b = null;
    if (e.kind === 'question') {
      b = e.answer === 'yes' ? badge(t('log.yes'), 'yes') : e.answer === 'no' ? badge(t('log.no'), 'no') : badge(t('log.time'), 'time');
    } else if (e.kind === 'guess') {
      const ch = charByText(e.text);
      text = ch ? t('log.is_it', { name: ch.name }) : (text || t('log.guess'));
      b = e.correct ? badge(t('log.hit'), 'hit') : badge(t('log.miss'), 'no');
    } else if (e.kind === 'timeout') {
      text = text || t('log.no_ask');
      b = badge(t('log.time'), 'time');
    }
    items.push(h('li', { class: `log-item side-${e.side || 'x'}` },
      h('span', { class: 'log-who' }, logWho(e, mySide)),
      h('div', { class: 'log-row' }, h('span', { class: 'log-text' }, text), b)));
  }
  if (!items.length) items.push(h('li', { class: 'log-empty' }, t('log.empty')));
  list.replaceChildren(...items);
}

// ======================== Observador ========================
const specBoards = { A: { key: '', els: new Map() }, B: { key: '', els: new Map() } };

function renderSpec() {
  const { room } = S;
  const m = S.match;
  $('s-room-name').textContent = roomName();
  $('s-room-sub').textContent = t('r.observing', { code: room.code });
  $('s-score-name-A').textContent = sideLabel('A');
  $('s-score-name-B').textContent = sideLabel('B');
  $('s-score').textContent = scoreText();

  const qp = $('s-queue');
  const pos = (S.queue || []).indexOf(me.player_id);
  qp.hidden = !(isDuel() && pos >= 0);
  qp.textContent = pos === 0 ? t('r.queue_next') : t('r.queue_nth', { n: pos + 1 });

  let banner = t('r.waiting_match');
  if (m) {
    if (m.phase === 'over' || room.status !== 'playing') banner = m.winner_side ? t('r.s_over_w', { n: m.number, side: sideLabel(m.winner_side) }) : t('r.s_ended');
    else if (m.phase === 'asking' && !m.asker_id) banner = t('r.turn_nobody', { side: sideLabel(m.turn_side) });
    else if (m.phase === 'asking') banner = t(isDuel() ? 'r.s_turn_duel' : 'r.s_turn_team', { side: sideLabel(m.turn_side), name: nameOf(m.asker_id) });
    else banner = t('r.s_answering', { asker: nameOf(m.asker_id), q: m.pending_question?.text || '', answerer: m.answerer_id ? nameOf(m.answerer_id) : t('r.other_side') });
  }
  $('s-banner').textContent = banner;

  for (const side of ['A', 'B']) {
    const mem = players().filter((p) => p.side === side);
    $(`s-name-${side}`).textContent = sideLabel(side);
    $(`s-members-${side}`).textContent = mem.map((p) => p.name + (p.connected ? '' : t('r.offline_paren'))).join(', ') || t('r.nobody');
    let status = '';
    if (m && m.phase !== 'over') {
      if (m.turn_side === side) status = m.phase === 'asking' ? t('r.s_asking_now') : t('r.s_wait_answer');
      else status = m.phase === 'answering' ? t('r.s_answering_now') : t('r.s_waiting');
    } else if (m?.winner_side) status = m.winner_side === side ? t('r.s_won') : t('r.s_lost');
    const down = m?.boards?.[side]?.down || [];
    if (m) status += `${status ? ' · ' : ''}${t('r.left_n', { n: m.characters.length - down.length })}`;
    $(`s-status-${side}`).textContent = status;
    const sec = m && charById(m.secrets?.[side]);
    setFigure($(`s-secret-${side}`), sec);
    $(`s-secret-${side}`).setAttribute('aria-label', sec ? t('r.secret_of', { name: sec.name }) : t('r.secret'));
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
    d.setAttribute('aria-label', `${c.name}${down.has(c.id) ? t('r.flipped') : ''}${c.id === target ? t('r.is_target') : ''}`);
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
    el.setAttribute('aria-label', t('r.no_timer'));
    return;
  }
  const ms = Math.max(0, timerEnd - performance.now());
  const secs = Math.ceil(ms / 1000);
  num.textContent = String(secs);
  fg.style.strokeDashoffset = String(CIRC * (1 - ms / timerTotal));
  el.dataset.level = secs <= 5 ? 'danger' : secs <= 10 ? 'warn' : 'ok';
  el.setAttribute('aria-label', t('r.time_left', { n: secs }));
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

  $('result-kicker').textContent = st === 'series_over' ? t('r.series_over') : t('r.match_over_n', { n: m.number });
  let title = t('r.match_ended');
  if (win) {
    if (mySide) {
      const mine = win === mySide;
      if (st === 'series_over') title = mine ? t(isDuel() ? 'r.t_champ_you' : 'r.t_champ_team') : t('r.t_champ', { side: sideLabel(win) });
      else title = mine ? t(isDuel() ? 'r.t_won_you' : 'r.t_won_team') : t(isDuel() ? 'r.t_lost_you' : 'r.t_lost_team');
    } else {
      title = st === 'series_over' ? t('r.t_champ', { side: sideLabel(win) }) : t('r.t_won', { side: sideLabel(win) });
    }
  }
  $('result-title').textContent = title;
  $('result-title').className = `result-title${win ? ` side-color-${win}` : ''}`;

  const last = (m.log || [])[m.log.length - 1];
  let reason = '';
  if (last && last.kind === 'guess') {
    const ch = charByText(last.text);
    const who = last.player_id === me.player_id ? t('r.you') : nameOf(last.player_id);
    reason = last.correct
      ? t('r.reason_hit', { who, name: ch ? ch.name : t('r.right_char') })
      : (ch || last.text ? t('r.reason_miss', { who, name: ch ? ch.name : last.text }) : t('r.reason_wrong', { who }));
  } else if (win) {
    reason = t('r.reason_wo');
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
    fig.querySelector('.reveal-label').textContent = t(isDuel() ? 'r.secret_duel' : 'r.secret_team', { side: sideLabel(side) });
    setFigure(fig, charById(m.secrets?.[side]));
  }

  const host = S.you.is_host;
  $('next-match').hidden = !(host && st === 'match_over');
  $('back-lobby').hidden = !host;
  const hostP = playerById(S.room.host_id);
  $('wait-host').hidden = host;
  $('wait-host').textContent = t(st === 'match_over' ? 'r.wait_next' : 'r.wait_lobby', { host: hostP ? hostP.name : t('r.the_host') });

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
  if (view === 'lobby' || !playing) return { title: t('chat.room_title'), label: t('chat.room_label'), ph: t('chat.room_ph'), tab: t('chat.room_title') };
  if (view === 'game') return { title: t('chat.team_title'), label: t('chat.team_label'), ph: t('chat.team_ph'), tab: t('chat.team_title') };
  return { title: t('chat.spec_title'), label: t('chat.spec_label'), ph: t('chat.spec_ph'), tab: t('chat.tab') };
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
    el.setAttribute('aria-label', t('chat.unread', { n: unread }));
  }
}

const CHANNEL_TAG = { team: 'chat.ch_team', spectators: 'chat.ch_spec' };
function addChat(msg) {
  const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 60;
  const mine = msg.player_id === me.player_id;
  const time = msg.ts ? new Date(msg.ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';
  const li = h('li', { class: `chat-msg${mine ? ' is-mine' : ''}` },
    h('span', { class: 'chat-dot', style: { background: safeColor(msg.color) }, 'aria-hidden': 'true' }),
    h('div', { class: 'chat-body' },
      h('span', { class: 'chat-meta' },
        h('strong', {}, msg.name || t('r.someone')),
        CHANNEL_TAG[msg.channel] ? h('span', { class: 'chat-chan', dataset: { i18n: CHANNEL_TAG[msg.channel] } }, t(CHANNEL_TAG[msg.channel])) : null,
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
      $('name-error').textContent = t('r.name_error');
      $('name-error').dataset.i18n = 'r.name_error';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    me = saveIdentity({ name });
    $('name-error').textContent = '';
    delete $('name-error').dataset.i18n;
    setTimeout(start, 0);
  });
  setLoading('r.pick_name');
  dlg.showModal();
  input.focus();
}

function start() {
  me = getIdentity();
  setLoading('room.entering', { code: CODE });
  connect();
  loadThemes(true);
}

// ======================== Idioma ========================
// Troca sem recarregar: re-renderiza a partir do último snapshot e avisa o servidor (erros no novo idioma).
onLangChange((lang) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set_lang', lang }));
  if (connMsg) setConn(connMsg, connAction);
  if (!S) setLoading(loadingMsg[0], loadingMsg[1]);
  if (S) {
    const sel = $('set-theme');
    delete sel.dataset.sig;
    render();
  }
});

if (!CODE) location.href = '/';
else if (!me.name) askName();
else start();
