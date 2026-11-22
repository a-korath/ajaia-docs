# AI workflow note

> _TODO (author): this draft records what happened in the AI session. Add your own review, edits, and judgment calls in your own words before submitting._

## Tools used

- **Claude Code (Claude Opus 5.5)** in the terminal: scaffolding, implementation, tests, docs.
- **Claude in Chrome** for driving the running app in a real browser for UI checks.

## Where AI materially sped things up

- Turning the brief into a scoped plan and a working first version of the backend, frontend, and tests in one pass.
- Boilerplate-heavy parts: SQLite schema, Express routes, validation, the import converters (mammoth/marked), and the docs.
- Writing the API tests that exercise the sharing rules end to end.

## What was changed or rejected

- **Rejected a heavier stack** (Next.js/Prisma/Tiptap with a bundler) in favor of Express, built-in `node:sqlite`, and Quill from a CDN. That meant no build step, no native modules, and an easier deploy.
- **Rejected rendering stored HTML directly** (`innerHTML`). All content loads through Quill's clipboard converter, and this was verified in the browser with an injected `<script>` and `<img onerror>` payload. Neither ran.
- **Changed logout** from deleting all of a user's sessions to deleting only the current one.
- **Changed access errors** to return 404 instead of 403 when a user has no access, so document ids don't leak.
- _TODO (author): add anything you changed after reviewing the code yourself._

## How correctness was verified

- **Automated:** `npm test` runs 4 API tests: auth rejection, the full share lifecycle (none → viewer → editor → revoked, plus a non-invited user), input validation, and Markdown import plus rejected file types.
- **Manual, in a real browser:** signed in, opened a doc, typed bold text, reloaded, and confirmed it persisted. Shared a doc as viewer, signed in as that user, and confirmed it's read-only (toolbar hidden, not editable, "View only" badge). Ran the XSS payload check above.
- **Import:** converted a real `.docx` via curl and checked the resulting HTML.
- **UX:** reviewed screenshots of the login, list, and editor views.
