# Submission

- **Live app:** https://ajaia-docs-9rv6.onrender.com (free tier, so the first load after an idle period can take about 30s)
- **Source:** https://github.com/a-korath/ajaia-docs (also included in this folder)
- **Walkthrough video:** see `VIDEO_URL.txt`
- **Test accounts:** `alice@ajaia.test`, `bob@ajaia.test`, `carol@ajaia.test`, all with password `demo1234`

## Quick review path (about 5 min)

1. Sign in as **Alice** and open "Welcome to Ajaia Docs". Edit it and try the toolbar. Changes autosave.
2. Click **Share** and add `carol@ajaia.test` as *Can view*. Click **History** to see versions, and **Export** for Markdown or PDF.
3. Sign out and sign in as **Carol**. The doc is under *Shared with me* and opens read-only.
4. Sign in as **Bob**, an editor on the welcome doc, to test editing a shared doc.
5. Back on the home page, use **Import file** with a `.txt`, `.md`, or `.docx` file to create a new document.

## Included

| Path | What |
|---|---|
| `README.md` | Setup, run, test, and deploy instructions; demo accounts |
| `ARCHITECTURE.md` | Architecture note: priorities, tradeoffs, next steps |
| `AI_WORKFLOW.md` | AI tools used, what I changed or rejected, how I verified |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `server.js`, `src/` | Backend (Express + libSQL: SQLite file locally, Turso in production) |
| `public/` | Frontend (HTML/JS/CSS, Quill editor) |
| `test/` | Automated API tests (`npm test`, 7 tests) |
| `render.yaml` | Render deployment blueprint |
| `.env.example` | Optional Turso settings for local runs |
| `package.json`, `package-lock.json` | Dependencies |

To run locally: `npm install && npm start`, then open http://localhost:3000. No accounts or services are needed.

## Status

**Working end to end:**
- Sign in and out.
- Create, rename, edit, autosave, reopen, and delete documents (delete takes two clicks to confirm).
- Rich text: H1–H3, bold, italic, underline, strikethrough, lists, quotes, links.
- Import of `.txt`, `.md`, and `.docx` files as new documents.
- Sharing by email with viewer or editor roles, plus changing roles and revoking access.
- Separate lists for owned and shared documents.
- Save-conflict detection with a reload or overwrite choice.
- Server-side HTML sanitization.
- Persistence that survives restarts and redeploys (Turso).

**Stretch features done:**
- Version history with preview and restore.
- Export to Markdown and PDF.
- Role-based sharing (viewer / editor).

**Incomplete / known limits:**
- No real-time co-editing: conflicts are detected and the user chooses, but nothing is merged.
- No sign-up; accounts are seeded.
- PDF export goes through the browser's print dialog.

**Next 2–4 hours:**
- A UI smoke test (Playwright).
- A diff view in version history.
- Conflict notices before you type, not just on save.
- Comments.
