# Submission

- **Live app:** https://ajaia-docs-9rv6.onrender.com
- **Walkthrough video:** see `VIDEO_URL.txt`
- **Test accounts:** `alice@ajaia.test`, `bob@ajaia.test`, `carol@ajaia.test`, all with password `demo1234`

## Included

| Path | What |
|---|---|
| `README.md` | Setup, run, test, deploy instructions; demo accounts |
| `ARCHITECTURE.md` | Architecture note: priorities, tradeoffs, next steps |
| `AI_WORKFLOW.md` | AI tools used, what was changed or rejected, verification |
| `VIDEO_URL.txt` | Walkthrough video link |
| `server.js`, `src/` | Backend (Express + SQLite) |
| `public/` | Frontend (HTML/JS/CSS, Quill editor) |
| `test/` | Automated API tests (`npm test`) |
| `render.yaml` | Render deployment blueprint |
| `package.json`, `package-lock.json` | Dependencies |

## Status

**Working end to end:** sign in/out; create, rename, edit, autosave, reopen, delete; rich text (H1–H3, bold, italic, underline, strike, lists, quotes, links); import of `.txt`/`.md`/`.docx` as new documents; sharing by email with viewer/editor roles, role changes and revoking; owned vs shared lists; save-conflict detection with a reload/overwrite choice; version history with preview and restore; export to Markdown and PDF; server-side HTML sanitization; persistence in SQLite (Turso in production).

**Incomplete / known limits:** no real-time co-editing (conflicts are detected and the user chooses, but nothing is merged); no sign-up; PDF export goes through the browser's print dialog; the free Render instance takes about 30s to wake after being idle.

**Next 2–4 hours:** a UI smoke test (Playwright), a diff view in history, earlier conflict notices, comments.
