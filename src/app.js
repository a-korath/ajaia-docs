import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000; // ~1 MB of HTML per document
const IMPORT_TYPES = ['.txt', '.md', '.docx'];
const REVISION_WINDOW_MS = 5 * 60 * 1000; // one revision per author per 5-minute editing burst

const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;

function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 32));
}

// Allowlist matching what the editor can render. Applied to every write so stored HTML is safe
// wherever it's rendered, not just inside Quill.
const SANITIZE = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'a', 'span', 'img'],
  allowedAttributes: { a: ['href', 'target', 'rel'], li: ['data-list'], img: ['src', 'alt'], '*': ['class'] },
  allowedClasses: { '*': ['ql-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
};
const clean = (html) => sanitizeHtml(html, SANITIZE);

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Copies the document's current state into a new revision.
function snapshot(db, docId, authorId) {
  db.prepare(`INSERT INTO revisions (document_id, author_id, version, title, content, created_at)
    SELECT id, ?, version, title, content, updated_at FROM documents WHERE id = ?`).run(authorId, docId);
}

function initDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      PRIMARY KEY (document_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_by_doc ON revisions (document_id, id);
  `);

  // Seed demo accounts on first boot so reviewers can test sharing immediately.
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const addUser = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
    for (const [email, name] of [['alice@ajaia.test', 'Alice'], ['bob@ajaia.test', 'Bob'], ['carol@ajaia.test', 'Carol']]) {
      addUser.run(email, name, hashPassword('demo1234'));
    }
    const now = new Date().toISOString();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (1, ?, ?, ?, ?)'
    ).run('Welcome to Ajaia Docs', '<h1>Welcome</h1><p>This document is owned by <strong>Alice</strong> and shared with Bob as an <em>editor</em>.</p><ul><li>Edit anything — changes autosave.</li><li>Use the toolbar for headings, lists and formatting.</li></ul>', now, now);
    db.prepare("INSERT INTO shares (document_id, user_id, role) VALUES (?, 2, 'editor')").run(lastInsertRowid);
    snapshot(db, lastInsertRowid, 1);
  }
  return db;
}

export function createApp(dbPath = process.env.DB_PATH || 'data.db') {
  const db = initDb(dbPath);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  function auth(req, res, next) {
    const token = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const user = token && db.prepare(
      'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    ).get(token);
    if (!user) return res.status(401).json({ error: 'Please sign in' });
    req.user = user;
    req.token = token;
    next();
  }

  function roleFor(docId, userId) {
    return db.prepare(`
      SELECT CASE WHEN d.owner_id = ? THEN 'owner' ELSE s.role END AS role
      FROM documents d LEFT JOIN shares s ON s.document_id = d.id AND s.user_id = ?
      WHERE d.id = ?`).get(userId, userId, docId)?.role ?? null;
  }

  // 404 (not 403) when the user has no access at all, so document ids don't leak.
  const access = (...allowed) => (req, res, next) => {
    const role = roleFor(Number(req.params.id), req.user.id);
    if (!role) return res.status(404).json({ error: 'Document not found' });
    if (!allowed.includes(role)) return res.status(403).json({ error: `You have ${role} access to this document` });
    req.role = role;
    next();
  };

  function validTitle(title) {
    if (typeof title !== 'string' || !title.trim()) throw badRequest('Title is required');
    if (title.length > MAX_TITLE) throw badRequest(`Title must be at most ${MAX_TITLE} characters`);
    return title.trim();
  }

  function createDoc(ownerId, title, content = '') {
    content = clean(content);
    if (content.length > MAX_CONTENT) throw badRequest('Document is too large');
    const now = new Date().toISOString();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ownerId, title, content, now, now);
    snapshot(db, lastInsertRowid, ownerId);
    return { id: Number(lastInsertRowid), title };
  }

  // Autosave fires every second while typing, so consecutive saves by the same author within
  // REVISION_WINDOW_MS update one revision instead of creating many. The creation revision
  // (version 1) is never merged, so the original/imported text is always restorable.
  function recordRevision(docId, authorId, savedAt) {
    const last = db.prepare('SELECT id, author_id, version, created_at FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(docId);
    if (last && last.version > 1 && last.author_id === authorId && Date.parse(savedAt) - Date.parse(last.created_at) < REVISION_WINDOW_MS) {
      db.prepare(`UPDATE revisions SET (version, title, content) = (SELECT version, title, content FROM documents WHERE id = ?)
        WHERE id = ?`).run(docId, last.id);
    } else {
      snapshot(db, docId, authorId);
    }
  }

  // --- auth ---
  app.post('/api/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const user = typeof email === 'string' && db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user || typeof password !== 'string' || !checkPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, new Date().toISOString());
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/api/logout', auth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json(req.user));

  // --- documents ---
  app.get('/api/docs', auth, (req, res) => {
    res.json({
      owned: db.prepare('SELECT id, title, updated_at FROM documents WHERE owner_id = ? ORDER BY updated_at DESC').all(req.user.id),
      shared: db.prepare(`
        SELECT d.id, d.title, d.updated_at, s.role, u.name AS owner_name
        FROM shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
        WHERE s.user_id = ? ORDER BY d.updated_at DESC`).all(req.user.id),
    });
  });

  app.post('/api/docs', auth, (req, res) => {
    res.status(201).json(createDoc(req.user.id, validTitle(req.body?.title ?? 'Untitled document')));
  });

  app.post('/api/import', auth, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    const filename = decodeURIComponent(req.get('X-Filename') || '');
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!IMPORT_TYPES.includes(ext)) throw badRequest(`Unsupported file type. Use ${IMPORT_TYPES.join(', ')}`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('File is empty');

    let html;
    if (ext === '.docx') {
      try {
        html = (await mammoth.convertToHtml({ buffer: req.body })).value;
      } catch {
        throw badRequest('Could not read .docx file');
      }
    } else {
      const text = req.body.toString('utf8');
      html = ext === '.md' ? marked.parse(text) : text.split(/\r?\n/).map((l) => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
    }
    const title = filename.slice(0, -ext.length).trim().slice(0, MAX_TITLE) || 'Imported document';
    res.status(201).json(createDoc(req.user.id, title, html));
  });

  app.get('/api/docs/:id', auth, access('owner', 'editor', 'viewer'), (req, res) => {
    const doc = db.prepare(`
      SELECT d.id, d.title, d.content, d.version, d.updated_at, u.name AS owner_name, u.email AS owner_email
      FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?`).get(Number(req.params.id));
    const shares = db.prepare(`
      SELECT u.id, u.name, u.email, s.role FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.document_id = ? ORDER BY u.name`).all(doc.id);
    res.json({ ...doc, role: req.role, shares });
  });

  app.patch('/api/docs/:id', auth, access('owner', 'editor'), (req, res) => {
    const { title, content, version } = req.body ?? {};
    if (!Number.isInteger(version)) throw badRequest('version is required');
    const updates = {};
    if (title !== undefined) updates.title = validTitle(title);
    if (content !== undefined) {
      if (typeof content !== 'string') throw badRequest('Content must be a string');
      updates.content = clean(content);
      if (updates.content.length > MAX_CONTENT) throw badRequest('Document is too large');
    }
    if (!Object.keys(updates).length) throw badRequest('Nothing to update');
    updates.updated_at = new Date().toISOString();
    const id = Number(req.params.id);
    const cols = Object.keys(updates);
    // Optimistic concurrency: only save if nobody else has saved since this client last loaded/saved.
    const { changes } = db.prepare(
      `UPDATE documents SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = version + 1 WHERE id = ? AND version = ?`
    ).run(...cols.map((c) => updates[c]), id, version);
    if (!changes) {
      const latest = db.prepare('SELECT title, content, version, updated_at FROM documents WHERE id = ?').get(id);
      return res.status(409).json({ error: 'This document was changed by someone else', latest });
    }
    recordRevision(id, req.user.id, updates.updated_at);
    res.json({ version: version + 1, updated_at: updates.updated_at });
  });

  app.delete('/api/docs/:id', auth, access('owner'), (req, res) => {
    db.prepare('DELETE FROM documents WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  });

  // --- version history ---
  app.get('/api/docs/:id/revisions', auth, access('owner', 'editor', 'viewer'), (req, res) => {
    res.json(db.prepare(`
      SELECT r.id, r.version, r.title, r.created_at, u.name AS author_name
      FROM revisions r JOIN users u ON u.id = r.author_id
      WHERE r.document_id = ? ORDER BY r.id DESC LIMIT 100`).all(Number(req.params.id)));
  });

  app.get('/api/docs/:id/revisions/:revId', auth, access('owner', 'editor', 'viewer'), (req, res) => {
    const rev = db.prepare('SELECT id, version, title, content, created_at FROM revisions WHERE id = ? AND document_id = ?')
      .get(Number(req.params.revId), Number(req.params.id));
    if (!rev) return res.status(404).json({ error: 'Revision not found' });
    res.json(rev);
  });

  // --- sharing ---
  app.post('/api/docs/:id/shares', auth, access('owner'), (req, res) => {
    const { email, role } = req.body ?? {};
    if (!['viewer', 'editor'].includes(role)) throw badRequest('Role must be viewer or editor');
    const user = typeof email === 'string' && db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user) return res.status(404).json({ error: 'No user with that email' });
    if (user.id === req.user.id) throw badRequest('You already own this document');
    db.prepare(`INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`).run(Number(req.params.id), user.id, role);
    res.status(201).json({ ...user, role });
  });

  app.delete('/api/docs/:id/shares/:userId', auth, access('owner'), (req, res) => {
    db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?').run(Number(req.params.id), Number(req.params.userId));
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return app;
}
