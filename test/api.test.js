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
  await alice.call(`/docs/${doc.id}`, 'PATCH', { content: '<h1>Q1</h1><p><strong>Ship it</strong></p>', version: 1 });

  // Not shared yet: invisible to Bob.
  assert.equal((await bob.call(`/docs/${doc.id}`)).status, 404);

  // Viewer can read, can't edit or re-share.
  assert.equal((await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'viewer' })).status, 201);
  const read = await bob.call(`/docs/${doc.id}`);
  assert.equal(read.body.role, 'viewer');
  assert.equal(read.body.content, '<h1>Q1</h1><p><strong>Ship it</strong></p>');
  assert.equal((await bob.call(`/docs/${doc.id}`, 'PATCH', { content: 'hacked', version: 2 })).status, 403);
  assert.equal((await bob.call(`/docs/${doc.id}/shares`, 'POST', { email: 'carol@ajaia.test', role: 'editor' })).status, 403);
  assert.ok((await bob.call('/docs')).body.shared.some((d) => d.id === doc.id && d.owner_name === 'Alice'));

  // Upgrade to editor: Bob can now edit, but still can't delete.
  await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'editor' });
  assert.equal((await bob.call(`/docs/${doc.id}`, 'PATCH', { title: 'Plan v2', version: 2 })).status, 200);
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
  assert.equal((await alice.call(`/docs/${doc.id}`, 'PATCH', { title: '   ', version: 1 })).status, 400);
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

test('rejects a stale save with 409 and returns the latest copy', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const { body: doc } = await alice.call('/docs', 'POST', { title: 'Shared' });
  await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'editor' });

  // Both opened version 1. Bob saves first; Alice's save is now stale.
  assert.equal((await bob.call(`/docs/${doc.id}`, 'PATCH', { content: '<p>bob</p>', version: 1 })).body.version, 2);
  const stale = await alice.call(`/docs/${doc.id}`, 'PATCH', { content: '<p>alice</p>', version: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.latest.content, '<p>bob</p>');
  assert.equal(stale.body.latest.version, 2);

  // Alice chooses to overwrite using the latest version.
  assert.equal((await alice.call(`/docs/${doc.id}`, 'PATCH', { content: '<p>alice</p>', version: 2 })).status, 200);
  assert.equal((await bob.call(`/docs/${doc.id}`)).body.content, '<p>alice</p>');
  assert.equal((await alice.call(`/docs/${doc.id}`, 'PATCH', { content: 'x' })).status, 400); // version required
});

test('strips unsafe HTML on save and import, keeps formatting', async () => {
  const alice = await login('alice@ajaia.test');
  const { body: doc } = await alice.call('/docs', 'POST', {});
  await alice.call(`/docs/${doc.id}`, 'PATCH', {
    version: 1,
    content: '<h2 onclick="x()">Hi</h2><script>alert(1)</script><p><a href="javascript:alert(1)">bad</a> <a href="https://ok.test">ok</a></p>'
      + '<ol><li data-list="bullet" class="ql-indent-1 evil">item</li></ol><img src="x" onerror="alert(1)">',
  });
  const { content } = (await alice.call(`/docs/${doc.id}`)).body;
  assert.equal(content, '<h2>Hi</h2><p><a>bad</a> <a href="https://ok.test">ok</a></p>'
    + '<ol><li data-list="bullet" class="ql-indent-1">item</li></ol><img src="x" />');

  const res = await fetch(`${base}/import`, {
    method: 'POST', headers: { cookie: alice.cookie, 'X-Filename': 'x.md' }, body: '# T\n\n<script>alert(1)</script>',
  });
  const imported = (await alice.call(`/docs/${(await res.json()).id}`)).body.content;
  assert.match(imported, /<h1>T<\/h1>/);
  assert.doesNotMatch(imported, /script/);
});

test('records version history: original kept, autosave bursts merged, one entry per author', async () => {
  const alice = await login('alice@ajaia.test');
  const bob = await login('bob@ajaia.test');
  const carol = await login('carol@ajaia.test');
  const { body: doc } = await alice.call('/docs', 'POST', { title: 'History' });
  await alice.call(`/docs/${doc.id}/shares`, 'POST', { email: 'bob@ajaia.test', role: 'editor' });

  // Three quick autosaves by Alice collapse into one revision on top of the creation revision.
  for (const [i, text] of ['a', 'ab', 'abc'].entries()) {
    await alice.call(`/docs/${doc.id}`, 'PATCH', { content: `<p>${text}</p>`, version: i + 1 });
  }
  await bob.call(`/docs/${doc.id}`, 'PATCH', { content: '<p>bob</p>', version: 4 });

  const revs = (await alice.call(`/docs/${doc.id}/revisions`)).body;
  assert.deepEqual(revs.map((r) => [r.author_name, r.version]), [['Bob', 5], ['Alice', 4], ['Alice', 1]]);

  const original = await bob.call(`/docs/${doc.id}/revisions/${revs[2].id}`);
  assert.equal(original.body.content, '');
  assert.equal((await alice.call(`/docs/${doc.id}/revisions/${revs[1].id}`)).body.content, '<p>abc</p>');

  // History follows document access.
  assert.equal((await carol.call(`/docs/${doc.id}/revisions`)).status, 404);
  assert.equal((await carol.call(`/docs/${doc.id}/revisions/${revs[0].id}`)).status, 404);
});
