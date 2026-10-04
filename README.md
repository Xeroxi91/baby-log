# Baby log

A lightweight, self-hosted web app to log a newborn's day — feeds, diapers, weight, length and
head circumference — for **one or more children**, shared between caregivers, with growth charts
based on the **INTERGROWTH-21st** preterm standards and the **WHO Child Growth Standards**.

- 📱 Installable on iPhone/Android from the browser (*Add to Home Screen*), no App Store.
- 👥 Shared between two or more devices, synced automatically.
- ✈️ Works offline: opens instantly, entries are saved on the device and sent when back online.
- 🔒 Your data stays in **your own Google Sheet**; this repository contains no data and no backend address.
- 💸 Free: GitHub Pages + Google Apps Script.

> The user interface is in **English**. Italian localisation is planned.

---

## Features

**Quick logging**
- A floating **＋** button opens the logging panel from any screen; the bottom bar (*Day · Progress ·
  Settings*) stays within thumb reach.
- One-tap buttons: breastfeed, bottle/top-up (with ml), pee, poo, pee + poo, weight.
- Time: *now*, −15 / −30 / −60 min, or any date/time. Per child or for all children at once.
- Live breastfeeding timer with a *Stop* button, visible on every device; tandem feeding
  (one tap starts a timer for each child, *Stop all* ends them together).
- Breast side (left / right / both) with a suggestion of the side to start from next time.
- Bottle content: formula or expressed breast milk, with daily totals.
- Duplicate warning (same event for the same child within 10 minutes) and 5-second undo.

**Day**
- Time since the end of the last feed for each child, with a configurable highlight threshold.
- Per-day counters; breast + bottle within 60 minutes count as a single feed.
- Day-by-day log with one column per child, gaps of 2+ hours highlighted, "add forgotten event";
  day selector, daily summary and column names stay pinned while scrolling; *Day details* expands the
  per-child cards.

**Progress (one child at a time)**
- Child selector and period: 7 / 14 / 30 days / all.
- **Signals**, grouped as *Talk to your paediatrician*, *Keep an eye on*, *Going well*, *What may help*:
  feeds and wet diapers in the last 24 h, long stretches without feeding, stools, weight loss after birth,
  birth weight not regained, weight gain, centile crossing, missing weighings, top-up trend,
  feeding patterns (long feeds followed by top-ups, top-ups mostly formula).
- **Thresholds that follow the baby's age** (*Settings → Signals → Automatic by age*): minimum feeds and
  wet diapers, maximum hours between feeds and without poo, minimum weight gain change by age band
  (first month, 1–2, 2–3, 3–6, 6–12 months), based on values commonly given in NHS, AAP and WHO guidance;
  for babies born early the band follows the corrected age. Choose *Custom* to use the limits agreed
  with your paediatrician.
- **Growth**: weight and length on reference centiles, with latest value, percentile, centile channel,
  g/day and g/kg/day, birth-weight recovery, length gain, and the full list of measurements.
- **Feeding** and **Diapers** cards with sparklines and change vs the previous period: feeds, breastfeed
  duration, % feeds with top-up, top-up volume, bottle ml, expressed milk, ml/kg, interval between feeds,
  longest stretch, pee, poo.
- Feeding rhythm over 24 h, weekly summary and, as a secondary view, comparison between children.

**Settings**
- Children profiles, theme (auto / light / dark), feed highlight threshold, signal thresholds (automatic by age or custom).
- Sync status, *Sync now*, sharing (app link, API address), disconnect this device.
- About: version, references, license and source code.

**Other**
- Responsive layout, works full-screen from the Home Screen.
- Sync status always visible: *Updated 12:30*, *Syncing…*, *Offline · 2 to send*. Tap it to sync now.

---

## How it works

```
 iPhone / Android / browser                     Google (your account)
┌─────────────────────────┐   HTTPS + code   ┌──────────────────────────────┐
│ index.html (GitHub Pages)│ ───────────────▶ │ Apps Script web app (Code.gs) │
│ API URL + code stored    │ ◀─────────────── │        │                      │
│ only on the device       │      JSON        │        ▼                      │
└─────────────────────────┘                   │  Google Sheet "events"       │
                                              └──────────────────────────────┘
```

- The page is static and public, but contains no personal data.
- The Apps Script API answers only to requests carrying a valid **access code**.
- Children are identified in the page by opaque random ids; names and profiles are returned
  only after authentication.
- **Offline-first**: a service worker (`sw.js`) keeps the app on the device; data are cached
  locally and every change goes into an outbox. A single `sync` call sends the outbox and
  receives only what changed since the last sync. Deletions are kept as tombstones so every
  device learns about them. Simultaneous edits of the same event: the last one wins.
- No external resources: system fonts, no CDNs, no analytics.

---

## Requirements

- A Google account (for the Sheet and Apps Script).
- A GitHub account (for hosting the page) — or any static hosting.
- 15 minutes, preferably on a computer for the first setup.

---

## Setup

### 1. Backend: Google Sheet + Apps Script

1. Create a new, empty **Google Sheet** (any name). Do not share it.
2. In the Sheet open **Extensions → Apps Script**. The script must be created from the Sheet
   (container-bound), otherwise it cannot find it.
3. Replace the content of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
4. Select the function **`createAccessCodes`** and click **Run**. Authorise the script when asked
   (*Advanced → Go to … (unsafe)* is expected for your own scripts).
   The **access codes** appear in the execution log — by default two, one per person.
   For a different number, run it from a helper function, e.g. `function createThreeCodes(){ createAccessCodes(3); }`.
5. **Deploy → New deployment → type: Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (required: the page calls the API without a Google login;
     requests without a valid code receive only `unauthorized`).
6. Copy the **Web app URL** — it ends with **`/exec`** (not `/dev`).

The `events` sheet and its columns are created automatically on first use.

### 2. Frontend: GitHub Pages

1. **Fork** this repository (or create a new public repository and upload the files).
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
3. After a minute the app is online at `https://<your-username>.github.io/<repository>/`.

No file needs to be edited.

### 3. First launch on each device

1. Open the page in **Safari** (iPhone) or **Chrome** (Android).
2. Install it: Safari → *Share → Add to Home Screen*; Chrome → *⋮ → Add to Home screen*.
3. Open the app **from the Home Screen** and enter the `/exec` URL and an access code
   (*Connect the log*). You can also choose **Use on this device only**: entries stay on the device
   and are uploaded later with *Settings → Connect to a shared log*. On iPhone the Home Screen app has its own storage, separate from Safari,
   so do this step inside the installed app.
4. Open **Settings → Edit children** and add each child: name, sex, date of birth, gestational age at birth
   (weeks + days), and optionally birth weight, length and head circumference.
   Gestational age is needed for corrected age and growth charts; use 40+0 for term babies if unknown.

To add another caregiver later, run **`addAccessCode()`** in Apps Script: it creates one new code
and keeps the existing ones. Share the app link and API address from *Settings → Sync and sharing*,
and the code through a private channel.

---

## Everyday use (quick guide)

| Action | How |
|---|---|
| Log an event | **＋** → choose the child (or *All*), the time, then tap a button |
| Breastfeeding timer | **＋** → *Breast* with time *Now* → tap **Stop** at the end |
| Bottle / top-up | *Bottle* → choose ml (±10 or 30/60/90/120) |
| Fix or delete | *Day* → tap the event |
| Forgotten event | *Day* → *＋ Forgotten event* |
| Weight / length | *Weight* button, or *Progress* → *Growth* → *＋ Add* |
| Change children or birth data | *Settings* → *Edit children* |
| Theme | *Settings* → *Appearance* |
| Remove a device | *Settings* → *Disconnect this device* (data already on the device stays visible) |

---

## Data

All data are in the `events` sheet of your Google Sheet, one row per event:

| Column | Content |
|---|---|
| `id` | unique id |
| `kind` | `feed`, `pee`, `poo`, `weight`, `len`, `hc` |
| `child` | internal child key (mapped to the child in the profile) |
| `ts` | timestamp (milliseconds since 1970, UTC) |
| `feedType` | `breast` or `bottle` |
| `grams` | weight in grams |
| `dateTime` | human-readable date/time |
| `ml` | bottle quantity |
| `duration` | breastfeeding duration in minutes |
| `running` | `1` while a breastfeeding timer is running |
| `cm` | length or head circumference |
| `side` | breast side: `L`, `R`, `B` (both) |
| `milk` | bottle content: `f` formula, `e` expressed breast milk |
| `updatedAt` | last change on the server (milliseconds), used by incremental sync |
| `deleted` | `1` for deleted events (tombstones) |

Children profiles and access codes are stored in the script's **Script Properties**
(`PROFILE`, `KEYS`). **Backup**: *File → Download* in Google Sheets, or *File → Make a copy*.

---

## Security and privacy

- The repository and the published page contain **no personal data, no backend URL, no codes**.
- Access to data requires the `/exec` URL **and** a valid access code (40 random characters).
- URL and code are stored only in the device's local storage.
- **Add a caregiver**: run `addAccessCode()` (existing codes keep working).
- **Revoke access**: run `createAccessCodes()` again — all previous codes stop working; re-enter the new
  ones on the devices you still use.
- Keep the Google Sheet **unshared**, and archive old deployments you no longer use
  (*Deploy → Manage deployments*).
- Do not commit codes or the `/exec` URL to the repository, and avoid pasting them into
  synced notes or chats.

---

## Upgrading from an earlier version

The backend migrates automatically: a sheet named `eventi` is renamed to `events`, the header row is
rewritten in English (new columns are added at the end) and legacy feed values (`seno`, `art`) are
read as `breast` / `bottle`. Existing rows need no changes.
Optionally run `normaliseLegacyValues()` once to rewrite them in the sheet.

## Updating

- **Page**: in your fork use *Sync fork*, or replace `index.html` / `sw.js`. GitHub Pages republishes
  automatically. Installed apps pick up the new version at the **next launch** (the service worker
  refreshes it in the background); close and reopen the app to apply it.
- **Backend**: if `apps-script/Code.gs` changed, paste it into Apps Script, then
  *Deploy → Manage deployments → ✏️ → Version: New version → Deploy*. The URL stays the same.

---

## Customisation

In `index.html`:

- `SESSION_GAP` — breast and bottle within this time count as one feed (default 60 min).
- `DUP_WINDOW` — duplicate warning window (default 10 min).
- `LIVE_MAX` — how long a running breastfeeding timer stays visible (default 60 min).
- CSS variables `--k0` … `--k5` — colours of the children (six, reused after the sixth).

All interface text is in `index.html` (English). Localisation is planned.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| *Address not reachable or not valid* | Use the URL ending in `/exec`; deployment access must be **Anyone**; after code changes deploy a **New version** |
| *Invalid code* | Copy the code exactly from the execution log; run `createAccessCodes()` again if lost |
| The Home Screen app asks for URL and code again | Normal on iPhone: it has storage separate from Safari |
| Changes not visible on the other phone | The app syncs every 20 s while open, when it comes back to the foreground and when the connection returns; tap the status pill to sync now |
| Status shows *Offline · n to send* | Entries are safe on the device and will be sent automatically when the connection returns |
| An update does not appear | Close the app completely and reopen it (the new version is downloaded in the background first) |
| Google warns the app is unverified | Expected for your own scripts: *Advanced → Go to …* |
| Growth chart missing | Fill in date of birth and gestational age in *Settings → Edit children* |

---

## Medical disclaimer

This is **not a medical device**. Signals, tips, percentiles, reference bands and indicators are a support for
conversations with your paediatrician and do not replace clinical assessment. Choosing the right
reference (especially for preterm infants) and interpreting growth is a clinician's task.

---

## Author

Created by **Matteo Moschitta** — [@Xeroxi91](https://github.com/Xeroxi91) · [matteomoschitta.it](https://matteomoschitta.it)

## Credits and references

- WHO Child Growth Standards (2006).
- Villar J. et al., *Postnatal growth standards for preterm infants: the Preterm Postnatal
  Follow-up Study of the INTERGROWTH-21st Project*, Lancet Global Health, 2015.
- Reference tables via the open-source R package [gigs](https://github.com/lshtm-gigs/gigs) (LSHTM).

See [`NOTICE.md`](NOTICE.md) for third-party terms.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free to use, study, modify and fork for
noncommercial purposes, keeping the `Required Notice` line. Commercial use is not permitted.
If you reuse or adapt it, please cite it — see [`CITATION.cff`](CITATION.cff) or the
*Cite this repository* button on GitHub.
