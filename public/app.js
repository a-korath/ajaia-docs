const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };
const MAX_UPLOAD = 5 * 1024 * 1024;

let me = null;
let current = null; // the open document
let dirty = false;
let saving = null;
let saveTimer = null;
let flash = '';
let conflict = null; // latest server copy when our save was rejected

async function api(path, { method = 'GET', body, headers } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch('/api' + path, {
    method,
    headers: isJson ? { 'Content-Type': 'application/json' } : headers,
    body: isJson ? JSON.stringify(body) : body,
  });
  if (res.status === 401 && path !== '/login') {
    me = null;
    show('login');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  }
  return res.status === 204 ? null : res.json();
}

function show(view) {
  for (const v of ['login', 'list', 'editor']) $(`view-${v}`).hidden = v !== view;
  $('topbar').hidden = view === 'login';
}

// --- editor ---
const quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Start writing…',
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote', 'link', 'clean'],
    ],
  },
});
const toolbar = quill.getModule('toolbar').container;
const preview = new Quill('#history-preview', { theme: 'snow', readOnly: true, modules: { toolbar: false } });
let selectedRev = null;

function setStatus(text, failed = false) {
  $('status').textContent = text;
  $('status').classList.toggle('failed', failed);
}

function markDirty() {
  dirty = true;
  setStatus('Unsaved changes');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

async function save() {
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (!dirty || !current || conflict) return;
  const body = { content: quill.root.innerHTML, version: current.version };
  const title = $('title').value.trim();
  if (title) body.title = title;
  dirty = false;
  setStatus('Saving…');
  saving = api(`/docs/${current.id}`, { method: 'PATCH', body })
    .then(({ version }) => {
      current.version = version;
      if (title) current.title = title;
      setStatus(dirty ? 'Unsaved changes' : title ? 'All changes saved' : 'Saved — title can’t be empty', !title);
    })
    .catch((err) => {
      dirty = true;
      if (err.status === 409) return showConflict(err.data.latest);
      const retry = !err.status || err.status >= 500;
      setStatus(`Save failed: ${err.message}${retry ? ' — retrying…' : ''}`, true);
      if (retry) saveTimer = setTimeout(save, 3000);
    })
    .finally(() => { saving = null; });
  await saving;
}

function showConflict(latest) {
  conflict = latest;
  setStatus('Not saved — conflict', true);
  $('conflict').hidden = false;
}

$('conflict-reload').onclick = () => {
  dirty = false;
  openDoc(current.id);
};
$('conflict-overwrite').onclick = () => {
  current.version = conflict.version;
  conflict = null;
  $('conflict').hidden = true;
  dirty = true;
  save();
};

quill.on('text-change', (_delta, _old, source) => { if (source === 'user') markDirty(); });
$('title').addEventListener('input', markDirty);
$('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') quill.focus(); });
window.addEventListener('beforeunload', (e) => { if (dirty || saving) e.preventDefault(); });

async function openDoc(id, { focusTitle = false } = {}) {
  const doc = await api(`/docs/${id}`);
  clearTimeout(saveTimer);
  dirty = false;
  conflict = null;
  $('conflict').hidden = true;
  current = doc;
  const readOnly = doc.role === 'viewer';
  $('title').value = doc.title;
  $('title').disabled = readOnly;
  // Stored HTML always goes through Quill's clipboard, which keeps only supported formats (drops scripts/handlers).
  quill.setContents(quill.clipboard.convert({ html: doc.content }), 'silent');
  quill.history.clear();
  quill.enable(!readOnly);
  toolbar.hidden = readOnly;
  $('role').textContent = ROLE_LABEL[doc.role];
  $('share-toggle').hidden = doc.role !== 'owner';
  $('share-panel').hidden = true;
  $('history-panel').hidden = true;
  $('share-error').textContent = '';
  setStatus(readOnly ? 'You can view but not edit this document' : 'All changes saved');
  renderShares();
  show('editor');
  if (focusTitle) $('title').select();
}

// --- sharing ---
function renderShares() {
  const { shares, role, owner_name } = current;
  const who = shares.length ? `Shared with ${shares.map((s) => s.name).join(', ')}` : 'Only you have access';
  $('doc-meta').textContent = role === 'owner' ? who : `Owned by ${owner_name} · ${who}`;
  $('share-list').replaceChildren(...shares.map((s) => {
    const select = el('select', { 'aria-label': `Access for ${s.name}`, onchange: () => share(s.email, select.value) },
      el('option', { value: 'editor', textContent: 'Can edit' }),
      el('option', { value: 'viewer', textContent: 'Can view' }));
    select.value = s.role;
    return el('li', {},
      el('span', { textContent: `${s.name} (${s.email})` }),
      select,
      el('button', { className: 'danger', textContent: 'Remove', onclick: () => unshare(s) }));
  }));
}

async function share(email, role) {
  try {
    const s = await api(`/docs/${current.id}/shares`, { method: 'POST', body: { email, role } });
    current.shares = [...current.shares.filter((x) => x.id !== s.id), s].sort((a, b) => a.name.localeCompare(b.name));
    $('share-error').textContent = '';
    renderShares();
    return true;
  } catch (err) {
    $('share-error').textContent = err.message;
  }
}

async function unshare(s) {
  try {
    await api(`/docs/${current.id}/shares/${s.id}`, { method: 'DELETE' });
    current.shares = current.shares.filter((x) => x.id !== s.id);
    renderShares();
  } catch (err) {
    $('share-error').textContent = err.message;
  }
}

$('share-toggle').onclick = () => {
  $('share-panel').hidden = !$('share-panel').hidden;
  $('history-panel').hidden = true;
};

// --- version history ---
async function loadHistory() {
  await save(); // so the newest edits show up as the current version
  selectedRev = null;
  $('history-restore').hidden = true;
  $('history-label').textContent = 'Select a version to preview';
  preview.setContents([], 'silent');
  preview.container.hidden = true;
  try {
    const revs = await api(`/docs/${current.id}/revisions`);
    $('history-list').replaceChildren(...revs.map((r, i) => {
      const tags = [r.author_name, i === 0 && 'Current', r.version === 1 && 'Created'].filter(Boolean).join(' · ');
      return el('li', {}, el('button', { onclick: (e) => previewRev(r, e.currentTarget) },
        el('strong', { textContent: fmt(r.created_at) }),
        el('span', { textContent: tags })));
    }));
  } catch (err) {
    $('history-label').textContent = err.message;
  }
}

async function previewRev(r, btn) {
  try {
    const rev = await api(`/docs/${current.id}/revisions/${r.id}`);
    selectedRev = rev;
    for (const b of $('history-list').querySelectorAll('button')) b.classList.toggle('active', b === btn);
    preview.setContents(preview.clipboard.convert({ html: rev.content }), 'silent');
    preview.container.hidden = false;
    $('history-label').textContent = `“${rev.title}” · ${fmt(rev.created_at)}`;
    $('history-restore').hidden = current.role === 'viewer' || rev.version === current.version;
  } catch (err) {
    $('history-label').textContent = err.message;
  }
}

// Restoring saves the old content as a new version, so a restore is itself undoable from history.
$('history-restore').onclick = async () => {
  quill.setContents(quill.clipboard.convert({ html: selectedRev.content }), 'silent');
  $('title').value = selectedRev.title;
  dirty = true;
  await save();
  if (!dirty) loadHistory();
};

$('history-toggle').onclick = () => {
  $('history-panel').hidden = !$('history-panel').hidden;
  $('share-panel').hidden = true;
  if (!$('history-panel').hidden) loadHistory();
};
$('share-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (await share(f.email.value, f.role.value)) f.email.value = '';
};

// --- document list ---
function fill(ul, docs, extra, emptyText) {
  ul.replaceChildren(...(docs.length
    ? docs.map((d) => el('li', {}, el('a', { href: `#/doc/${d.id}`, textContent: d.title }), ...extra(d)))
    : [el('li', { className: 'empty', textContent: emptyText })]));
}

async function showList() {
  current = null;
  const { owned, shared } = await api('/docs');
  fill($('owned'), owned, (d) => [
    el('small', { textContent: fmt(d.updated_at) }),
    el('button', { className: 'danger', textContent: 'Delete', onclick: (e) => deleteDoc(d, e.currentTarget) }),
  ], 'No documents yet — create one or import a file.');
  fill($('shared'), shared, (d) => [
    el('span', { className: 'badge', textContent: ROLE_LABEL[d.role] }),
    el('small', { textContent: `${d.owner_name} · ${fmt(d.updated_at)}` }),
  ], 'Nothing has been shared with you yet.');
  $('list-error').textContent = flash;
  flash = '';
  show('list');
}

async function deleteDoc(d, btn) {
  // First click arms the button; a second click within 3s deletes.
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Sure? Click again';
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = 'Delete';
    }, 3000);
    return;
  }
  try {
    await api(`/docs/${d.id}`, { method: 'DELETE' });
    await showList();
  } catch (err) {
    $('list-error').textContent = err.message;
  }
}

async function createAndOpen(promise) {
  $('list-error').textContent = '';
  try {
    const { id } = await promise;
    history.pushState(null, '', `#/doc/${id}`);
    await openDoc(id, { focusTitle: true });
  } catch (err) {
    $('list-error').textContent = err.message;
  }
}

$('new-doc').onclick = () => createAndOpen(api('/docs', { method: 'POST', body: {} }));
$('import-file').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_UPLOAD) {
    $('list-error').textContent = 'File is larger than 5 MB';
    return;
  }
  createAndOpen(api('/import', {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
  }));
};

// --- auth + routing ---
$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    me = await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
    f.reset();
    $('login-error').textContent = '';
    route();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
};

$('logout').onclick = async () => {
  await save();
  await api('/logout', { method: 'POST' }).catch(() => {});
  me = null;
  current = null;
  history.pushState(null, '', '#/');
  show('login');
};

async function route() {
  await save();
  try {
    me ??= await api('/me');
  } catch {
    return show('login');
  }
  $('me').textContent = me.name;
  const id = location.hash.match(/^#\/doc\/(\d+)$/)?.[1];
  try {
    await (id ? openDoc(id) : showList());
  } catch (err) {
    if (!me) return; // session expired; api() already showed the login screen
    flash = err.message;
    history.replaceState(null, '', '#/');
    await showList().catch(() => {});
  }
}

window.addEventListener('hashchange', route);
route();
