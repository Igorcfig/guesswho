import {
  COLORS, getIdentity, saveIdentity, cleanName, colorPicker, api, toast, h, initials,
  roomUrl, normalizeCode, CODE_RE,
} from './common.js';

const $ = (id) => document.getElementById(id);
const nick = $('nick');
const avatarBg = $('avatar-bg');
const codeInput = $('code');
const list = $('rooms-list');
const countEl = $('rooms-count');

let me = getIdentity();
nick.value = me.name || '';

const picker = colorPicker($('colors'), me.color, (c) => setColor(c));
function setColor(c) {
  me = saveIdentity({ color: c });
  avatarBg.setAttribute('fill', c);
  picker.set(c);
}
setColor(me.color);

$('avatar-next').addEventListener('click', () => {
  setColor(COLORS[(COLORS.indexOf(me.color) + 1) % COLORS.length]);
});

nick.addEventListener('input', () => { me = saveIdentity({ name: nick.value }); });
$('profile-form').addEventListener('submit', (e) => e.preventDefault());

/** Garante apelido válido antes de entrar numa sala. */
function requireName() {
  const name = cleanName(nick.value);
  if (!name) {
    toast('Escolha um apelido antes de jogar.', 'error');
    nick.focus();
    nick.setAttribute('aria-invalid', 'true');
    return null;
  }
  nick.removeAttribute('aria-invalid');
  me = saveIdentity({ name });
  return name;
}

let busy = false;
async function withBusy(btn, fn) {
  if (busy) return;
  busy = true;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message, 'error'); } finally {
    busy = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

async function createRoom(isPublic) {
  const name = requireName();
  if (!name) return;
  const data = await api('/api/rooms', { method: 'POST', json: { name: `Sala de ${name}`.slice(0, 40), public: isPublic } });
  location.href = roomUrl(data.code);
}

$('create-room').addEventListener('click', (e) => withBusy(e.currentTarget, () => createRoom(false)));

$('play-now').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
  if (!requireName()) return;
  let rooms = [];
  try { rooms = await api('/api/rooms'); } catch { rooms = []; }
  const open = (rooms || []).find((r) => r.status === 'lobby' && r.players < (r.max_players || 12));
  if (open) location.href = roomUrl(open.code);
  else await createRoom(true);
}));

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeCode(codeInput.value);
  if (!CODE_RE.test(code)) {
    toast('O código tem 4 letras ou números, como K7Q2.', 'error');
    codeInput.setAttribute('aria-invalid', 'true');
    codeInput.focus();
    return;
  }
  if (!requireName()) return;
  location.href = roomUrl(code);
});
codeInput.addEventListener('input', () => {
  const pos = codeInput.selectionStart;
  codeInput.value = normalizeCode(codeInput.value);
  codeInput.removeAttribute('aria-invalid');
  try { codeInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
});

// ---------- Lista de salas públicas ----------
const ROOM_COLORS = ['#FFC93C', '#2EC4B6', '#FF9F5A', '#B8A6FF', '#FF7C9C', '#7EE8DD'];
function colorFor(code) {
  let n = 0;
  for (const ch of String(code)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return ROOM_COLORS[n % ROOM_COLORS.length];
}

function renderRooms(rooms) {
  countEl.textContent = rooms.length === 1 ? '1 sala · atualiza sozinho' : `${rooms.length} salas · atualiza sozinho`;
  if (!rooms.length) {
    list.replaceChildren(h('div', { class: 'rooms-empty' },
      h('strong', {}, 'Nenhuma sala aberta agora.'),
      h('span', {}, 'Crie uma sala ou clique em "Jogar agora" para abrir a primeira.')));
    return;
  }
  list.replaceChildren(...rooms.map((r) => {
    const full = r.players >= (r.max_players || 12);
    const name = r.name || `Sala ${r.code}`;
    const status = r.status === 'playing' ? 'em partida' : 'esperando';
    const mode = r.mode === 'team' ? 'Time x Time' : 'Duelo';
    const enter = h('a', {
      class: 'btn btn-yellow btn-sm', href: roomUrl(r.code), 'aria-label': `Entrar na sala ${name}`,
    }, 'Entrar');
    enter.addEventListener('click', (e) => { if (!requireName()) e.preventDefault(); });
    return h('article', { class: 'room-row' },
      h('span', { class: 'room-initial', style: { background: colorFor(r.code) }, 'aria-hidden': 'true' }, initials(name)),
      h('div', { class: 'room-info' },
        h('span', { class: 'room-name' }, name),
        h('span', { class: 'room-meta' }, `Tema: ${r.theme_name || 'Clássico'} · ${mode} · ${status}`)),
      h('span', { class: 'room-players', 'aria-label': `${r.players} de ${r.max_players || 12} pessoas` }, `${r.players}/${r.max_players || 12}`),
      full ? h('span', { class: 'btn btn-sm btn-disabled', 'aria-disabled': 'true' }, 'Lotada') : enter);
  }));
}

let loadedOnce = false;
async function loadRooms() {
  if (document.hidden && loadedOnce) return;
  try {
    const rooms = await api('/api/rooms');
    loadedOnce = true;
    renderRooms(Array.isArray(rooms) ? rooms : []);
  } catch {
    if (!loadedOnce) {
      countEl.textContent = 'sem conexão';
      list.replaceChildren(h('div', { class: 'rooms-empty' }, h('strong', {}, 'Não deu para carregar as salas.'), h('span', {}, 'Tentando de novo em instantes…')));
    }
  }
}
loadRooms();
setInterval(loadRooms, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRooms(); });

// Aviso vindo de redirect (sala inexistente).
const params = new URLSearchParams(location.search);
if (params.get('erro') === 'sala_nao_encontrada' || params.get('erro') === 'sala') {
  toast('Essa sala não existe ou já foi fechada.', 'error', 5000);
  history.replaceState(null, '', '/');
}
if (!me.name) nick.focus();
