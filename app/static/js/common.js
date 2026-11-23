// Shared utilities: player identity, JSON fetch, toasts and safe element creation.
import { t, getLang, onLangChange } from './i18n.js';

export { t, getLang, onLangChange };

export const COLORS = ['#FFC93C', '#2EC4B6', '#FF9F5A', '#B8A6FF', '#FF7C9C', '#7EE8DD', '#8A6CFF', '#3A86FF'];
export const NAME_MAX = 20;
const KEY = 'cac_identity_v1';
const THEMES_KEY = 'cac_my_themes_v1';

function store() {
  try { return window.localStorage; } catch { return null; }
}

function readJSON(key, fallback) {
  try {
    const raw = store()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeJSON(key, value) {
  try { store()?.setItem(key, JSON.stringify(value)); } catch { /* no storage: keep it in memory only */ }
}

function uuid4() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Safe colour: only accepts #RRGGBB; otherwise uses the first one in the palette. */
export function safeColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : COLORS[0];
}

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

let memoryIdentity = null;

/** Persistent identity: {player_id, name, color}. Generates player_id the first time. */
export function getIdentity() {
  const saved = readJSON(KEY, null) || memoryIdentity || {};
  let changed = false;
  if (!saved.player_id || typeof saved.player_id !== 'string') { saved.player_id = uuid4(); changed = true; }
  if (!COLORS.includes(saved.color)) {
    saved.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    changed = true;
  }
  saved.name = cleanName(saved.name);
  if (changed) saveIdentity(saved);
  memoryIdentity = saved;
  return { ...saved };
}

export function saveIdentity(patch) {
  const cur = { ...(memoryIdentity || readJSON(KEY, {}) || {}), ...patch };
  if (patch.name !== undefined) cur.name = cleanName(patch.name);
  memoryIdentity = cur;
  writeJSON(KEY, cur);
  return { ...cur };
}

/** Themes created in this browser (to find private themes in the lobby). */
export function getMyThemes() {
  const list = readJSON(THEMES_KEY, []);
  return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string') : [];
}

export function rememberTheme(theme) {
  const list = getMyThemes().filter((x) => x.id !== theme.id);
  list.unshift({ id: theme.id, name: String(theme.name || '').slice(0, 40), count: theme.count | 0 });
  writeJSON(THEMES_KEY, list.slice(0, 30));
}

/** Initials of a name (up to 2 letters). */
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

/**
 * Create an element safely. Child strings become text nodes (never HTML).
 * attrs: class, text, dataset, style (object), on<event>, other attributes via setAttribute.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Stroke SVG icons, created via the DOM. */
const ICONS = {
  link: ['M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'],
  send: ['M5 12h14M13 6l6 6-6 6'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12l5 5L20 7'],
  image: ['M4 16l4-4 4 4 3-3 5 5', 'rect:3,4,18,16,3', 'circle:15.5,8.5,1.5'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'circle:12,12,3'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'circle:9,7,4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  crown: ['M3 18h18', 'M3 18l2-11 5 5 2-7 2 7 5-5 2 11'],
  target: ['circle:12,12,9', 'circle:12,12,5', 'circle:12,12,1'],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  plus: ['M12 5v14M5 12h14'],
  undo: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
};

export function icon(name, size = 18, strokeWidth = 2.5) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name] || []) {
    let node;
    if (d.startsWith('rect:')) {
      const [x, y, w, hh, r] = d.slice(5).split(',');
      node = document.createElementNS(SVG_NS, 'rect');
      Object.entries({ x, y, width: w, height: hh, rx: r }).forEach(([k, v]) => node.setAttribute(k, v));
    } else if (d.startsWith('circle:')) {
      const [cx, cy, r] = d.slice(7).split(',');
      node = document.createElementNS(SVG_NS, 'circle');
      Object.entries({ cx, cy, r }).forEach(([k, v]) => node.setAttribute(k, v));
    } else {
      node = document.createElementNS(SVG_NS, 'path');
      node.setAttribute('d', d);
    }
    svg.append(node);
  }
  return svg;
}

/** Small avatar square with initials on the player's colour. */
export function avatar(name, color, cls = '') {
  return h('span', { class: `avatar ${cls}`.trim(), style: { background: safeColor(color) }, 'aria-hidden': 'true' }, initials(name));
}

/** fetch that returns JSON and throws an Error with the server's `detail` message. */
export async function api(path, opts = {}) {
  const init = { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers['Content-Type'] = 'application/json';
    delete init.json;
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error(t('net.offline'));
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = new Error(detailMessage(data) || t('net.status', { status: res.status }));
    err.status = res.status;
    throw err;
  }
  return data;
}

function detailMessage(data) {
  if (!data) return '';
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d) => d?.msg).filter(Boolean).join(' ');
  return '';
}

/** Toast: kind = 'info' | 'error' | 'success'. */
export function toast(message, kind = 'info', ms = 3800) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast toast-${kind}` }, String(message));
  box.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function roomUrl(code) {
  return `/sala/${encodeURIComponent(code)}`;
}

export const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** Build the colour picker (radiogroup) inside `container`. */
export function colorPicker(container, current, onChange) {
  container.replaceChildren();
  container.setAttribute('role', 'radiogroup');
  const buttons = COLORS.map((c, i) => {
    const b = h('button', {
      type: 'button', class: 'swatch', role: 'radio', style: { background: c },
      'aria-label': t('color.n', { n: i + 1 }), 'aria-checked': String(c === current), tabindex: c === current ? '0' : '-1',
    });
    b.addEventListener('click', () => select(c, true));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = COLORS[(COLORS.indexOf(current) + d + COLORS.length) % COLORS.length];
      select(next, true);
      buttons[COLORS.indexOf(next)].focus();
    });
    container.append(b);
    return b;
  });
  onLangChange(() => buttons.forEach((b, i) => b.setAttribute('aria-label', t('color.n', { n: i + 1 }))));
  function select(c, notify) {
    current = c;
    buttons.forEach((b, i) => {
      const on = COLORS[i] === c;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (notify) onChange(c);
  }
  return { set: (c) => select(c, false) };
}

/** Room name for display: the server's default name ("Sala K7Q2") is translated. */
export function roomDisplayName(name, code) {
  return !name || name === `Sala ${code}` ? t('room.default_name', { code }) : name;
}

/** Theme name for display: the built-in "Clássico" theme becomes "Classic" in English. */
export function themeDisplayName(id, name) {
  return id === 'classic' || (!id && name === 'Clássico') ? t('theme.classic') : (name || '');
}
