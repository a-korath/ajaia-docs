# Ajaia Docs

A lightweight collaborative document editor: create, rename, and edit rich-text documents, import files, and share them with other users as viewers or editors.

**Live demo:** https://ajaia-docs-9rv6.onrender.com

## Demo accounts

All passwords are `demo1234`.

| Email | Notes |
|---|---|
| `alice@ajaia.test` | Owns "Welcome to Ajaia Docs" (shared with Bob) |
| `bob@ajaia.test` | Sees the welcome doc under **Shared with me** (can edit) |
| `carol@ajaia.test` | Starts with nothing shared, so use her to test granting access |

**Testing sharing:** sign in as Alice, open a document, click **Share**, add `carol@ajaia.test` as *Can view*, and sign out. Then sign in as Carol. The doc shows up under *Shared with me* and opens read-only.

## Features

- **Documents:** create, rename (click the title), edit, and delete (owner only). Changes autosave about 0.8s after you stop typing.
- **Formatting:** headings (H1–H3), bold, italic, underline, strikethrough, numbered and bulleted lists, blockquotes, links.
- **File import:** `.txt`, `.md`, and `.docx` files up to 5 MB. Each import becomes a new editable document, titled with the file name. Markdown and Word headings, lists, and emphasis carry over. Other file types are rejected with a clear message.
- **Sharing:** the owner grants access by email with a role: **Can edit** or **Can view**. The owner can also change a role or revoke access. The home page splits documents into *My documents* and *Shared with me*, showing the owner and your role.
- **Conflict detection:** if two people edit the same document and one saves first, the other sees a warning with *Load their version* or *Overwrite with mine*, instead of silently overwriting.
- **Version history:** **History** lists past versions, one entry per author per 5-minute editing burst, plus the original. You can preview any version read-only, and editors can **Restore** it. A restore saves as a new version, so it can be undone too.
- **Export:** **Export → Markdown** downloads a `.md` file. **Export → PDF** opens the print dialog with a clean, document-only layout; choose *Save as PDF*.
- **Safe content:** HTML is sanitized on the server on every save and import.
- **Persistence:** SQLite through libSQL. In development it's a local file; in production it's [Turso](https://turso.tech), a free hosted SQLite service, so data survives restarts and redeploys. Document content is stored as HTML.

## Run locally

Needs Node **22.13+**. No other services are needed locally.

```bash
npm install
npm start          # http://localhost:3000
npm test           # API tests (node:test)
```

The database is a local SQLite file, `data.db`, in the project root by default. Override it with `DB_PATH=/path/to/file.db`, and delete the file to reset to the seed data. To use Turso instead, copy `.env.example` to `.env` and fill in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. `npm start` loads `.env` automatically, and git ignores it. The port is set with `PORT`.

## Deploy

`render.yaml` deploys to Render's free tier: **New → Blueprint** → pick the repo.

For durable data, create a free Turso database and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the Render service's environment. The schema and demo data are created automatically on first boot. Without these variables, the app falls back to a local file, which Render's free tier wipes on every restart.

The free Render instance sleeps when idle, so the first request after a break takes about 30 seconds.

## Project layout

```
server.js          entry point
src/app.js         Express app: schema + seed, auth, documents, import, sharing, history
public/            static frontend (index.html, app.js, style.css). No build step; Quill and Turndown come from a CDN
test/api.test.js   API tests: access control, validation, import, conflicts, sanitization, history
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for decisions and tradeoffs, and [AI_WORKFLOW.md](AI_WORKFLOW.md) for how AI tools were used.
