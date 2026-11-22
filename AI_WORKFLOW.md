# AI workflow note

## Tools

- **Claude Code (Claude Opus 5.5)** in the terminal for planning, writing code, tests, and docs.
- **Claude in Chrome**, so the AI could click through the running app and take screenshots, not just trust that the code worked.

I used it as a pair programmer. I set the scope and priorities and reviewed each change in the browser. Most of the typing was done by the AI.

## Where it actually saved time

- **Getting to a working first version fast.** Backend, frontend, schema, auth, sharing, import, and tests were running locally within the first part of the session. That left most of my time for product decisions and polish instead of boilerplate.
- **Boring but necessary code:** Express routes, input validation, the `.docx`/`.md` import converters, the sanitizer allowlist, and the docs.
- **Tests for the risky parts.** It wrote API tests for the sharing rules (owner / editor / viewer / no access), save conflicts, sanitization, and version history. These caught a real bug later (below).
- **Swapping the database layer.** Moving from built-in `node:sqlite` to libSQL/Turso meant making every query async. That's a tedious mechanical change, done in one pass with the tests as a safety net.

## What I changed or pushed back on

These were my calls after using the app, not things the AI suggested:

- **Persistence on the live site.** The first version used a local SQLite file, which Render's free tier wipes on every restart. Reviewers could share a doc, come back later, and find it gone. I had it moved to Turso (hosted SQLite) so data actually persists.
- **Last-write-wins wasn't good enough.** Two editors could silently overwrite each other. I asked for a version check: a stale save gets a 409, and the user picks *Load their version* or *Overwrite with mine*.
- **Server-side sanitization.** Content was only made safe when it loaded into the editor. I wanted stored HTML to be safe everywhere, so every save and import is now cleaned on the server.
- **Feature order.** With time left, I picked version history first, then Turso, then Markdown/PDF export. I cut the "someone else is viewing" live indicator: it's a lot of moving parts for a small win in this timebox.
- **UI tweaks:**
  - Removed the long import hint from the home page (kept it as a tooltip, since the brief asks for supported file types in the UI).
  - Replaced the browser `confirm()` popup on delete with an in-app two-click confirm.
  - Moved version history from the top of the page to a right-hand sidebar.
- **Kept the stack small.** Express + SQLite + Quill from a CDN, no framework or build step. That's less to break and easier to deploy and review.
- **Secrets stay out of the repo.** The Turso token goes in Render's environment settings and a gitignored `.env`, never in code.

## Things the AI got wrong (and how they were caught)

- **A refactor broke the syntax.** The async conversion produced `async async (req, res)`. The test run failed immediately and it was fixed.
- **Leftover junk in two places:** a dead block in the test setup and a dangling CSS rule after moving the history panel. Both were spotted on review and removed.
- **A layout bug.** The history preview spilled out of its card (Quill's container defaults to `height: 100%`). I caught it in a screenshot and it was fixed.
- **A false "it works."** The first live persistence check passed for the wrong reason: it hit the old server while a deploy was still rolling out. We re-ran it properly. I created a doc, forced a redeploy, and confirmed the doc and my session survived on the fresh server.

## How I verified it

- **Automated:** `npm test` runs 7 API tests:
  - sign-in rejection
  - the full share lifecycle (none → viewer → editor → revoked)
  - input validation
  - Markdown import and rejected file types
  - stale-save 409 then overwrite
  - HTML sanitization on save and import
  - version history (autosave bursts merged, original kept, access-controlled)
- **In a real browser:**
  - Formatting survives a reload.
  - A viewer gets a read-only editor.
  - An injected `<script>` / `<img onerror>` payload doesn't run.
  - The conflict banner appears when another user saves first.
  - Restoring an old version works and shows up as a new version.
  - Markdown export output is clean.
  - Two-click delete works.
- **Live site:** sign-in works, new deploys go live, and data survives a redeploy (Turso check above).
- **Import:** converted a real `.docx` and checked the resulting HTML.
