# Architecture note

## Shape

One Node process serves a JSON API and a static single-page frontend.

```
Browser (vanilla JS + Quill)  ──fetch/JSON──>  Express (src/app.js)  ──>  SQLite (node:sqlite)
```

- **Backend:** Express 5 plus Node's built-in `node:sqlite`. Four tables: `users`, `sessions`, `documents` (with a `version` counter), `shares(document_id, user_id, role)`. Foreign keys cascade, so deleting a document removes its shares.
- **Frontend:** plain HTML/JS with hash routing (`#/` and `#/doc/:id`). [Quill 2](https://quilljs.com) handles the editor. There's no bundler or framework, so the app has no build step.
- **Import:** the client uploads raw bytes. The server converts `.docx` → HTML with `mammoth` and `.md` → HTML with `marked`, and turns `.txt` into escaped paragraphs.
- **Sanitization:** every write (saves and imports) runs through `sanitize-html` with an allowlist that matches what the editor can render. Allowed: headings, inline marks, lists, quotes, code, links (http/https/mailto only), images, and `ql-*` classes.

## What I prioritized and why

1. **A coherent core loop:** create → edit with formatting → autosave → reopen. This is what a user feels first, so it got the most polish. Autosave shows its status (Unsaved / Saving / Saved / Failed), retries on network or server errors, and warns before closing the tab with unsaved changes.
2. **Access control that's correct, not just present.** One `roleFor(doc, user)` query decides every request. Owner, editor, and viewer each get exactly their rights. Users with no access get **404 rather than 403**, so document ids don't leak. The API tests cover this most heavily, because it's the part most likely to be quietly wrong.
3. **Import as "turn a file into a document".** This is the most product-relevant upload behavior. It reuses the normal document path instead of adding attachment storage.
4. **Low-friction deployment for reviewers:** one process, one SQLite file, no external services, nothing to pay for.

## Key decisions and tradeoffs

| Decision | Why | Cost / ceiling |
|---|---|---|
| Content stored as HTML, sanitized on write | Simple, readable, and it's what import converters produce. Cleaning at write time means stored HTML is safe wherever it's rendered later (export, previews), not only in Quill. | The allowlist has to grow with any new editor format. The client still loads content through Quill's converter as a second layer. |
| Optimistic concurrency instead of real-time co-editing | Real-time editing (CRDT/OT) is a big project. A version check is ~20 lines and prevents silent data loss. | Every save sends the version it was based on. If someone saved in between, the server returns **409** with the latest copy, and the editor shows a banner: *Load their version* or *Overwrite with mine*. There's no merging; conflicts are caught but not resolved automatically. Next step: Yjs for live collaboration. |
| Simple email/password login, seeded users | Sharing needs real identities. A full auth system was out of scope. | No sign-up or password reset. Passwords are hashed with scrypt; sessions are random tokens in an HttpOnly, SameSite=Lax cookie. |
| Share by email with viewer/editor roles | The minimum that shows clear intent. Roles cost about 10 extra lines. | No share links, groups, or transfer of ownership. |
| SQLite, built-in driver | No native build step, so it works on any Node 22.13+ host. | A single instance only. On Render's free tier the file is ephemeral (see README). Postgres would be the move for multiple instances. |
| Quill via CDN, no build step | Fastest way to a solid editor. Fewer moving parts. | The app depends on jsDelivr being reachable. |

## Deliberately out of scope

Real-time collaboration and presence, comments and suggestions, version history, export, attachments, sign-up, mobile-specific UI, and pagination of the document list.

## Next 2–4 hours

1. Poll for or push "this document changed" notices, so conflicts show up before you type rather than on save.
2. Export to Markdown/PDF.
3. Persistent storage in production (Render disk or Postgres).
4. A Playwright smoke test of the UI flow.
