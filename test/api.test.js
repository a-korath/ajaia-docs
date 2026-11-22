import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server, base;
before(() => new Promise((resolve) => {
  server = createApp(':memory:').listen(0, () => {
    base = `http://localhost:${server.address().port}/api`;
    resolve();
  });
}));
after(() => server.close());

// Minimal client that keeps one user's session cookie.
async function login(email, password = 'demo1234') {
  const res = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  return { status: res.status, cookie, call };
}

test('rejects bad credentials and anonymous requests', async () => {
  assert.equal((await login('alice@ajaia.test', 'wrong')).status, 401);
  assert.equal((await fetch(`${base}/docs`)).status, 401);
});

test('sharing grants exactly the requested access', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');

  const { body: doc } = await alice.call('/docs', 'POST', { title: 'Plan' });
  await alice.call(`/docs/${doc.id}`, 'PATCH', { content: '<h1>Q1</h1><p><strong>Ship it</strong></p>' });

  // Not shared yet: invisible to Bob.
  assert.equal((await bob.call(`/docs/${doc.id}`)).status, 404);

  // Viewer can read, can't edit or re-share.
  assert.equal((await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'viewer' })).status, 201);
  const read = await bob.call(`/docs/${doc.id}`);
  assert.equal(read.body.role, 'viewer');
  assert.equal(read.body.content, '<h1>Q1</h1><p><strong>Ship it</strong></p>');
  assert.equal((await bob.call(`/docs/${doc.id}`, 'PATCH', { content: 'hacked' })).status, 403);
  assert.equal((await bob.call(`/docs/${doc.id}/shares`, 'POST', { email: 'carol@ajaia.test', role: 'editor' })).status, 403);
  assert.ok((await bob.call('/docs')).body.shared.some((d) => d.id === doc.id && d.owner_name === 'Alice'));

  // Upgrade to editor: Bob can now edit, but still can't delete.
  await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'editor' });
  assert.equal((await bob.call(`/docs/${doc.id}`, 'PATCH', { title: 'Plan v2' })).status, 200);
  assert.equal((await alice.call(`/docs/${doc.id}`)).body.title, 'Plan v2');
  assert.equal((await bob.call(`/docs/${doc.id}`, 'DELETE')).status, 403);

  // Carol was never invited; revoking Bob removes his access.
  assert.equal((await carol.call(`/docs/${doc.id}`)).status, 404);
  const bobId = (await bob.call('/me')).body.id;
  await alice.call(`/docs/${doc.id}/shares/${bobId}`, 'DELETE');
  assert.equal((await bob.call(`/docs/${doc.id}`)).status, 404);
});

test('validates input', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice.call('/docs', 'POST', {});
  assert.equal((await alice.call(`/docs/${doc.id}`, 'PATCH', { title: '   ' })).status, 400);
  assert.equal((await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'nobody@x.test', role: 'viewer' })).status, 404);
  assert.equal((await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'admin' })).status, 400);
});

test('imports markdown as a formatted document and rejects unsupported types', async () => {
  const alice = await login('alice@ajaia.test');
  const upload = (name, data) => fetch(`${base}/import`, {
    method: 'POST', headers: { cookie: alice.cookie, 'X-Filename': encodeURIComponent(name) }, body: data,
  });

  const res = await upload('Meeting notes.md', '# Agenda\n\n- **one**\n- two\n');
  assert.equal(res.status, 201);
  const { id, title } = await res.json();
  assert.equal(title, 'Meeting notes');
  const { body } = await alice.call(`/docs/${id}`);
  assert.match(body.content, /<h1>Agenda<\/h1>/);
  assert.match(body.content, /<li><strong>one<\/strong><\/li>/);

  assert.equal((await upload('report.pdf', 'x')).status, 400);
  assert.equal((await upload('empty.txt', '')).status, 400);
});
