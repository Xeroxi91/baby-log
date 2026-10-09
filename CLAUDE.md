# Baby log — notes for Claude Code

Read this first. It replaces the long design conversation the app came from.
**This repository is public: never commit personal data** (children's names, dates of birth,
access codes, the /exec URL, real exports). Use the sample data or synthetic fixtures.

## What it is
A personal, offline-first PWA to log a family's baby care (feeds, diapers, growth, notes,
reminders), shared between two parents. Static page on GitHub Pages + a private Google Apps
Script used as API + a Google Sheet as database. No build step, no dependencies at runtime.

- Live: `https://xeroxi91.github.io/baby-log/` (served from `main`, repository root)
- License: PolyForm Noncommercial 1.0.0 (author: Matteo Moschitta, Xeroxi91). Keep NOTICE/CITATION in sync.

## Files
| Path | Role |
|---|---|
| `index.html` | the whole app: HTML + CSS + JS in one file (~2.5k lines, sections marked `/* ---------- name ---------- */`) |
| `sw.js` | service worker: app shell cache, stale-while-revalidate. **Bump `CACHE` on every release** |
| `apps-script/Code.gs` | backend (copied by hand into Apps Script; not deployed from GitHub) |
| `manifest.webmanifest`, icons | PWA install |
| `README.md` | user documentation (English) |
| `NOTICE.md`, `LICENSE.md`, `CITATION.cff` | credits, third-party data, license |
| `tools/` | local test harness (Apps Script mock + smoke test), not used by the app |

## Architecture
**Client (`index.html`)**
- State: `base` (server copy, by id) + `outbox` (pending ops) → `rebuild()` → `events`.
  Cached in localStorage (`bl-cache`, `bl-outbox`). UI renders instantly from cache.
- One API action `sync` with `{since, ops, from, force}`; ops are `{op:"put", ev}` / `{op:"del", id}`,
  ids generated on the client (idempotent retries). Deletions are tombstones (`deleted = 1`).
- Polling: every 30 s if used in the last 5 min or outbox non-empty, else 2 min; only when visible;
  `visibilitychange` triggers a sync. Every ~20th sync or "Sync now" sends `force`.
- First load: only last 48 h (`from`); older events via action `history` on request
  (previous days, Progress, export). `histFrom` = oldest loaded time (0 = all).
- Modes: shared (URL + access code), local only (`bl-mode=local`), sample data (`bl-demo=1`).
- Stages per child: `newborn` / `infant` / `child` (`stageOf`, `logIds()` = children shown in the log).
- Signals (interpretive, "talk to your paediatrician"…) are **off by default** (descriptive view).
- i18n: UI strings are written in English; Italian is applied by translating rendered text
  (`IT` exact strings, `IT_T` templates with `{x}`, `IT_P` phrase replacements, `tr()`,
  MutationObserver). **Every new user-visible English string needs an IT entry.**
- Dialogs: `showModal` is wrapped so the dialog itself takes focus (iOS would open the first select).
  Forms use `novalidate`: the app validates (browser validation rejected valid values on iOS).
- App-like: no zoom/gestures/callouts; 16 px fields; status pill + bottom-nav line + top bar.

**Backend (`Code.gs`)**
- `doPost` with `{action, key, args}`; access codes in Script Properties `KEYS` (`createAccessCodes(n)`,
  `addAccessCode()`).
- Sheet `events` columns: `id kind child ts feedType grams dateTime ml duration running cm side milk
  updatedAt deleted tags text temp ref pre post`. Kinds: `feed pee poo weight len hc note med pump pmed`.
- Children are stored in Script Properties `PROFILE`; clients only see opaque ids (`c…`); the sheet keeps keys.
  `pump` and `pmed` rows belong to the parent (`child = parent`).
- `REV` property = time of last write. A sync with no ops and `since > REV` returns `{unchanged:true}`
  without lock or sheet access, **keeping `since`** (avoids losing concurrent writes).
- Reminders: `MEDS` (children; fields `id child name dose times due every until from group`).
- Parents' reminders: `PMEDS` = `{v, salt, check, items:[{id, enc}]}`, **encrypted on the phone**
  (AES-GCM, key from a family passphrase via PBKDF2); the server stores opaque text only.

## Conventions
- Each release: bump `APP_VERSION` (index.html), add a `CHANGELOG` entry **in EN and IT**
  (shown in Settings → What's new), bump `CACHE` in `sw.js`, update README if behaviour changes.
- If `Code.gs` changes, say so explicitly: it must be pasted into Apps Script and deployed
  (Manage deployments → edit → **New version**) **before** the page is updated.
- Commits: Conventional Commits in English (`feat(scope): …`, `fix(scope): …`), body with bullets.
- Branches: `main` = what the phones use (GitHub Pages). Work on `dev` / `feature/*`, PR to `main`.
  Tag releases (`v1.15.0`). Do not publish test builds under the same origin (localStorage is shared).
- Medical boundary: descriptive by default; no dosing advice, no breastfeeding-compatibility
  advice, no automatic mood/mental-health scores. Interpretive output only behind explicit opt-in.
- Privacy: no personal data in the repo; parents' medication data is local-only or encrypted.

## Testing
`tools/` contains a jsdom harness: `gasmock.js` runs `Code.gs` against an in-memory sheet;
`smoke.test.js` loads `index.html`, creates children, logs events on two "devices", checks sync,
deletion, quick unchanged polls and reminders. Run:
```
cd tools && npm install && npm test
```
Also check the UI with Playwright/Chromium screenshots at 390×844 (iPhone size), in EN and IT.

## Roadmap (agreed order)
1. **v2.0 modules**: Settings → Features with on/off switches, **family-wide** (stored on the server),
   disabling hides and never deletes; existing users keep what they use. Then move modules to
   `modules/*.js` loaded with dynamic `import()` only when enabled (cache them in `sw.js`), and split
   `Code.gs` into several `.gs` files.
2. **Parents' reminders** as the first separate module, **off by default**: "For you" card in Day,
   badge on the Day tab when something is due, per-reminder choice **this phone only (default)** or
   **shared encrypted** (family passphrase, not recoverable). Backend (`pmed`, `savePMeds`, `PMEDS`)
   is already in `Code.gs`; the client is to be written.
3. Suggest modules when a child changes stage (e.g. weaning at 5–6 months).
4. Then: illness episodes (fever, symptoms, timed medicines), weaning (foods, allergens, reactions),
   check-ups and vaccines; later push notifications (also app icon badge), import of the JSON backup.

Candidate modules: notes, children's reminders, parents' reminders, pumping, test weighing,
detailed progress, signals, older children & stages, night mode, export.
