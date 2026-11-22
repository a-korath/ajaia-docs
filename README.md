# Ajaia Docs

A lightweight collaborative document editor: create, rename, and edit rich-text documents, import files, and share them with other users as viewers or editors.

**Live demo:** _TODO: add Render URL_

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
- **Safe content:** HTML is sanitized on the server on every save and import.
- **Persistence:** everything lives in SQLite (users, sessions, documents, shares). Document content is stored as HTML.

## Run locally

Needs Node **22.13+** for the built-in `node:sqlite` module. There are no native deps and no other services.

```bash
npm install
npm start          # http://localhost:3000
npm test           # API tests (node:test)
```

The database file is `data.db` in the project root by default. Override it with `DB_PATH=/path/to/file.db`. Delete the file to reset to the seed data. The port is set with `PORT`.

## Deploy

`render.yaml` deploys to Render's free tier: **New → Blueprint** → pick the repo. No env vars are needed.

> ⚠️ Render's free tier has no persistent disk, so the database resets to the seed data whenever the service redeploys or restarts after idling. Data does persist across refreshes and sessions while the instance is up. For durable data, attach a Render disk and set `DB_PATH` to a file on it, or move to Postgres. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Project layout

```
server.js          entry point
src/app.js         Express app: schema + seed, auth, documents, import, sharing
public/            static frontend (index.html, app.js, style.css). No build step; Quill comes from a CDN
test/api.test.js   API tests: access control, validation, import
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for decisions and tradeoffs, and [AI_WORKFLOW.md](AI_WORKFLOW.md) for how AI tools were used.
