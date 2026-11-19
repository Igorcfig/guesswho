// Editor de tema: envia multipart para POST /api/themes.
import { getIdentity, saveIdentity, cleanName, api, toast, h, icon, rememberTheme, roomUrl } from './common.js';

const $ = (id) => document.getElementById(id);
const MIN = 12;
const MAX = 24;
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const BGS = ['#FFE7A3', '#BFF0EA', '#FFD3C2', '#DCD3FF', '#FFD0DD', '#D6F5C9'];

const grid = $('t-grid');
const dropzone = $('dropzone');
const fileInput = $('t-files');
const errorsBox = $('t-errors');
let items = []; // {key, file, url, name, el, input}
let seq = 0;
let sending = false;
let createdId = null;

const me = getIdentity();
$('t-author').value = me.name || '';

function nameFromFile(file) {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nice = base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
  return nice.slice(0, 20);
}

function addFiles(fileList) {
  const files = [...fileList];
  const problems = [];
  let skippedForLimit = 0;
  for (const file of files) {
    if (!TYPES.includes(file.type)) { problems.push(`"${file.name}" não é PNG, JPG ou WEBP.`); continue; }
    if (file.size > MAX_BYTES) { problems.push(`"${file.name}" tem mais de 2 MB.`); continue; }
    if (items.length >= MAX) { skippedForLimit += 1; continue; }
    addItem(file);
  }
  if (skippedForLimit) problems.push(`O tema aceita no máximo ${MAX} personagens; ${skippedForLimit} foto(s) ficaram de fora.`);
  if (problems.length) toast(problems.join(' '), 'error', 6000);
  update();
}

function addItem(file) {
  const key = `c${++seq}`;
  const url = URL.createObjectURL(file);
  const idx = items.length;
  const input = h('input', {
    class: 'input input-sm', maxlength: '20', value: nameFromFile(file), id: `name-${key}`,
    'aria-label': `Nome do personagem ${idx + 1}`, autocomplete: 'off', required: true,
  });
  const removeBtn = h('button', { type: 'button', class: 'remove-btn', 'aria-label': 'Remover personagem' }, icon('close', 14, 3));
  const el = h('div', { class: 'theme-item', dataset: { key } },
    h('div', { class: 'theme-thumb', style: { background: BGS[seq % BGS.length] } }, h('img', { src: url, alt: '' })),
    h('label', { class: 'theme-item-label', for: `name-${key}` }, 'Nome'),
    input,
    removeBtn);
  const item = { key, file, url, el, input };
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); updateLabels(); });
  removeBtn.addEventListener('click', () => {
    const i = items.indexOf(item);
    items.splice(i, 1);
    URL.revokeObjectURL(url);
    el.remove();
    update();
    const next = items[i] || items[i - 1];
    if (next) next.input.focus(); else dropzone.focus();
  });
  items.push(item);
  grid.insertBefore(el, dropzone);
}

function updateLabels() {
  items.forEach((it, i) => {
    const n = cleanName(it.input.value) || `personagem ${i + 1}`;
    it.el.querySelector('.remove-btn').setAttribute('aria-label', `Remover ${n}`);
    it.input.setAttribute('aria-label', `Nome do personagem ${i + 1}`);
  });
}

function update() {
  const n = items.length;
  $('t-count').textContent = `${n} / ${MAX}`;
  $('t-count').classList.toggle('is-ok', n >= MIN);
  $('t-count-hint').textContent = n < MIN ? `mínimo de ${MIN} personagens · faltam ${MIN - n}` : (n === MAX ? 'tema completo!' : `pode ter até ${MAX}`);
  dropzone.hidden = n >= MAX;
  updateLabels();
}

function showErrors(list) {
  errorsBox.replaceChildren(...(list.length > 1 ? [h('ul', {}, list.map((e) => h('li', {}, e)))] : list.map((e) => h('p', {}, e))));
  errorsBox.hidden = !list.length;
  if (list.length) errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function validate() {
  const errs = [];
  const name = cleanName($('t-name').value);
  const author = cleanName($('t-author').value);
  for (const [el, bad] of [[$('t-name'), !name], [$('t-author'), !author]]) {
    if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }
  if (!name) errs.push('Dê um nome ao tema (até 40 caracteres).');
  if (!author) errs.push('Diga quem é o autor (até 20 caracteres).');
  if (items.length < MIN) errs.push(`Adicione pelo menos ${MIN} personagens (faltam ${MIN - items.length}).`);
  if (items.length > MAX) errs.push(`No máximo ${MAX} personagens.`);
  const seen = new Map();
  let emptyCount = 0;
  const dups = new Set();
  for (const it of items) {
    const v = cleanName(it.input.value);
    it.input.removeAttribute('aria-invalid');
    if (!v) { emptyCount += 1; it.input.setAttribute('aria-invalid', 'true'); continue; }
    const k = v.toLocaleLowerCase('pt-BR');
    if (seen.has(k)) {
      dups.add(v);
      it.input.setAttribute('aria-invalid', 'true');
      seen.get(k).input.setAttribute('aria-invalid', 'true');
    } else seen.set(k, it);
  }
  if (emptyCount) errs.push(emptyCount === 1 ? 'Um personagem está sem nome.' : `${emptyCount} personagens estão sem nome.`);
  if (dups.size) errs.push(`Nomes repetidos: ${[...dups].join(', ')}. Cada personagem precisa de um nome diferente.`);
  return errs;
}

$('theme-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sending || createdId) return;
  const errs = validate();
  showErrors(errs);
  if (errs.length) {
    document.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const fd = new FormData();
  const name = cleanName($('t-name').value).slice(0, 40);
  const author = cleanName($('t-author').value);
  fd.append('name', name);
  fd.append('author', author);
  fd.append('public', $('t-public').value === 'false' ? 'false' : 'true');
  for (const it of items) {
    fd.append('names', cleanName(it.input.value));
    fd.append('images', it.file, it.file.name);
  }
  saveIdentity({ name: me.name || author });
  sending = true;
  const btn = $('save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const res = await api('/api/themes', { method: 'POST', body: fd });
    createdId = res.id;
    rememberTheme({ id: res.id, name, count: items.length });
    done(name, $('t-public').value !== 'false');
  } catch (err) {
    showErrors([err.message]);
    toast(err.message, 'error', 6000);
    btn.disabled = false;
    btn.textContent = 'Salvar tema';
  } finally {
    sending = false;
  }
});

function done(name, isPublic) {
  document.querySelector('.theme-card').hidden = true;
  $('save-btn').hidden = true;
  $('add-files').hidden = true;
  $('done-text').textContent = isPublic
    ? `"${name}" já aparece na lista de temas das salas. Escolha-o nas configurações do lobby.`
    : `"${name}" é privado: só aparece para você neste navegador e para quem entrar numa sala que o use.`;
  const sec = $('t-done');
  sec.hidden = false;
  sec.focus();
  toast('Tema salvo!', 'success');
}

$('done-room').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const nick = getIdentity().name || cleanName($('t-author').value);
    if (nick) saveIdentity({ name: nick });
    const r = await api('/api/rooms', { method: 'POST', json: { name: nick ? `Sala de ${nick}` : null, public: false } });
    location.href = `${roomUrl(r.code)}?tema=${encodeURIComponent(createdId)}`;
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
});

// Seleção e arrastar-e-soltar
$('add-files').addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

const overlay = $('drop-overlay');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || createdId) return;
  e.preventDefault();
  dragDepth += 1;
  overlay.hidden = false;
  dropzone.classList.add('is-over');
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { overlay.hidden = true; dropzone.classList.remove('is-over'); }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  dropzone.classList.remove('is-over');
  if (!createdId) addFiles(e.dataTransfer.files);
});

update();
