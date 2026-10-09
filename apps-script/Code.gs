/**
 * Baby log – Google Apps Script backend bound to a Google Sheet.
 * Exposes a small JSON API, protected by access codes, for the static page (e.g. GitHub Pages).
 *
 * Sheet "events": id | kind | child | ts | feedType | grams | dateTime | ml | duration | running | cm
 *                 | side | milk | updatedAt | deleted | tags | text | temp | ref | pre | post
 * The "child" column holds an internal child key; the page only ever sees opaque child ids.
 * Sync model: the page keeps a local copy and an outbox of changes; one "sync" call sends the
 * outbox and receives everything changed since the last sync (deletions are kept as tombstones).
 *
 * Setup: 1) run createAccessCodes()  2) Deploy > New deployment > Web app,
 *        Execute as: Me, Who has access: Anyone.
 *
 * Files (one Apps Script project, all in the same global scope; paste each into a file with the same name):
 *   Code.gs       API, access codes, sheet, sync
 *   Children.gs   children profile
 *   Reminders.gs  children's reminders and parents' encrypted reminders
 *   Features.gs   modules switched on and off for the whole family
 */
const SHEET = 'events';
const LEGACY_SHEETS = ['eventi'];   // older versions of this project used this sheet name
const HEADER = ['id', 'kind', 'child', 'ts', 'feedType', 'grams', 'dateTime', 'ml', 'duration', 'running', 'cm',
                'side', 'milk', 'updatedAt', 'deleted', 'tags', 'text', 'temp', 'ref', 'pre', 'post'];
const COL = {}; HEADER.forEach((h, i) => COL[h] = i);
const FEED_TYPES = { seno: 'breast', art: 'bottle', breast: 'breast', bottle: 'bottle' }; // legacy values are normalised

/* ---------- API ---------- */
function doGet() {
  return ContentService.createTextOutput('ok');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (!isValidKey_(req.key)) {
      out = { error: 'unauthorized' };
    } else {
      const args = req.args || [];
      const api = {
        sync:         () => sync_(args[0] || {}),
        history:      () => history_(args[0] || {}),
        getProfile:   () => ({ children: children_().map(publicChild_) }),
        saveMeds:     () => ({ meds: saveMeds_((args[0] && args[0].meds) || []) }),
        savePMeds:    () => ({ pmeds: savePMeds_((args[0] && args[0].pmeds) || null) }),
        saveFeatures: () => ({ features: saveFeatures_((args[0] && args[0].on) || {}) }),
        saveProfile:  () => ({ children: saveChildren_((args[0] && args[0].children) || []).map(publicChild_) })
      };
      out = api[req.action] ? { result: api[req.action]() } : { error: 'unknown action' };
    }
  } catch (err) {
    out = { error: 'error' };          // no details are returned to the client
    console.error(err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- access codes ---------- */
function isValidKey_(k) {
  if (!k) return false;
  const keys = (PropertiesService.getScriptProperties().getProperty('KEYS') || '')
    .split(',').map(s => s.trim()).filter(String);
  return keys.indexOf(String(k)) >= 0;
}

/**
 * Run from the editor: creates N access codes (default 2), replacing the previous ones,
 * and prints them in the execution log. For a different number use a helper, e.g.
 *   function createThreeCodes() { createAccessCodes(3); }
 */
function createAccessCodes(n) {
  n = Number(n) || 2;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  PropertiesService.getScriptProperties().setProperty('KEYS', keys.join(','));
  keys.forEach((k, i) => console.log('Access code ' + (i + 1) + ': ' + k));
}

/** Run from the editor: adds ONE new access code (e.g. for a new caregiver) and keeps the existing ones. */
function addAccessCode() {
  const props = PropertiesService.getScriptProperties();
  const keys = (props.getProperty('KEYS') || '').split(',').map(s => s.trim()).filter(String);
  const k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  keys.push(k);
  props.setProperty('KEYS', keys.join(','));
  console.log('New access code (' + keys.length + ' active): ' + k);
}

/* ---------- sheet ---------- */
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(SHEET);
  if (!s) {
    const legacy = LEGACY_SHEETS.map(n => ss.getSheetByName(n)).find(Boolean);
    if (legacy) { legacy.setName(SHEET); s = legacy; }      // keeps existing data
    else { s = ss.insertSheet(SHEET); s.setFrozenRows(1); }
  }
  // header row: always the current English column names (positions never change)
  const cur = s.getRange(1, 1, 1, HEADER.length).getValues()[0];
  if (HEADER.some((h, i) => cur[i] !== h)) s.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  return s;
}

function row_(id, e, updatedAt, deleted) {
  return [id, e.kind, e.kidKey, Number(e.ts), e.feedType || '', e.grams || '', new Date(Number(e.ts)),
          e.ml || '', e.dur || '', e.live ? 1 : '', e.cm || '', e.side || '', e.milk || '',
          updatedAt || '', deleted ? 1 : '', e.tags || '', e.text ? String(e.text).slice(0, 500) : '',
          e.temp || '', e.ref || '', e.pre || '', e.post || ''];
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function rowToEvent_(r) {
  const e = { id: String(r[COL.id]), kind: r[COL.kind], kidKey: r[COL.child], ts: Number(r[COL.ts]) };
  if (r[COL.feedType]) e.feedType = FEED_TYPES[r[COL.feedType]] || r[COL.feedType];
  if (r[COL.grams]) e.grams = Number(r[COL.grams]);
  if (r[COL.ml]) e.ml = Number(r[COL.ml]);
  if (r[COL.duration]) e.dur = Number(r[COL.duration]);
  if (r[COL.running]) e.live = 1;
  if (r[COL.cm]) e.cm = Number(r[COL.cm]);
  if (r[COL.side]) e.side = String(r[COL.side]);
  if (r[COL.milk]) e.milk = String(r[COL.milk]);
  if (r[COL.deleted]) e.deleted = 1;
  if (r[COL.tags]) e.tags = String(r[COL.tags]);
  if (r[COL.text]) e.text = String(r[COL.text]);
  if (r[COL.temp]) e.temp = Number(r[COL.temp]);
  if (r[COL.ref]) e.ref = String(r[COL.ref]);
  if (r[COL.pre]) e.pre = Number(r[COL.pre]);
  if (r[COL.post]) e.post = Number(r[COL.post]);
  return e;
}

const validId_ = id => /^[A-Za-z0-9_-]{6,64}$/.test(String(id || ''));
const KINDS = { feed: 1, pee: 1, poo: 1, weight: 1, len: 1, hc: 1, note: 1, med: 1, pump: 1, pmed: 1 };
const PARENT = 'parent';   // pumping sessions belong to the parent, not to a child

/* Revision: time of the last write (events, children, reminders or features). Lets a sync with nothing to
   send answer without opening the spreadsheet when nothing changed. Edits made by hand in the
   sheet do not move it: clients force a full check now and then. */
function rev_() { return Number(PropertiesService.getScriptProperties().getProperty('REV')) || 0; }
function bump_(t) { PropertiesService.getScriptProperties().setProperty('REV', String(t)); }

/**
 * Applies the client's outbox and returns what changed since `since`, plus children and reminders.
 * First load (since = 0): only events from `from` on (older ones via the "history" action).
 * Nothing to send and nothing changed: quick answer, no lock, no sheet access, `since` kept.
 */
function sync_(p) {
  const since0 = Number(p.since) || 0, ops0 = p.ops || [];
  if (!ops0.length && since0 > 0 && !p.force && rev_() < since0) {
    return { serverTime: since0, events: [], unchanged: true };
  }
  return withLock_(() => {
    const now = Date.now();
    if ((p.ops || []).length) bump_(now);              // before writing: concurrent quick checks see the change
    const s = sheet_();
    const data = s.getRange(1, 1, Math.max(1, s.getLastRow()), HEADER.length).getValues();
    const idx = {};
    for (let i = 1; i < data.length; i++) if (data[i][0]) idx[String(data[i][0])] = i;
    const dirty = {}, firstNew = data.length;
    (p.ops || []).slice(0, 500).forEach(o => {
      try {
        if (o.op === 'put' && o.ev && validId_(o.ev.id) && KINDS[o.ev.kind]) {
          const row = row_(String(o.ev.id), toSheet_(o.ev), now, false);
          const i = idx[o.ev.id];
          if (i != null) { data[i] = row; dirty[i] = 1; }
          else { idx[o.ev.id] = data.length; data.push(row); }
        } else if (o.op === 'del' && idx[o.id] != null) {
          const i = idx[o.id];
          data[i][COL.updatedAt] = now; data[i][COL.deleted] = 1; dirty[i] = 1;
        }
      } catch (err) { console.warn('skipped op', err); }   // a bad op never blocks the queue
    });
    Object.keys(dirty).forEach(k => { const i = Number(k); if (i < firstNew) s.getRange(i + 1, 1, 1, HEADER.length).setValues([data[i]]); });
    if (data.length > firstNew) s.getRange(firstNew + 1, 1, data.length - firstNew, HEADER.length).setValues(data.slice(firstNew));

    const since = Number(p.since) || 0, from = since === 0 ? Number(p.from) || 0 : 0;
    const events = [];
    let older = false;
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;
      if (since === 0) {
        if (r[COL.deleted]) continue;
        if (from && (Number(r[COL.ts]) || 0) < from) { older = true; continue; }
      } else if ((Number(r[COL.updatedAt]) || 0) < since) continue;
      const e = toClient_(rowToEvent_(r));
      if (e.child) events.push(e);
    }
    return { serverTime: now, events: events, children: children_().map(publicChild_), meds: meds_(), pmeds: pmeds_(), features: features_(data), older: older };
  });
}

/** Events that happened before `before` (loaded on request: earlier days, Progress, export). */
function history_(p) {
  const before = Number(p.before) || 0;
  const s = sheet_(), data = s.getRange(1, 1, Math.max(1, s.getLastRow()), HEADER.length).getValues();
  const events = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || r[COL.deleted] || (before && (Number(r[COL.ts]) || 0) >= before)) continue;
    const e = toClient_(rowToEvent_(r));
    if (e.child) events.push(e);
  }
  return { events: events };
}

/**
 * Optional, run once from the editor: rewrites legacy feed type values ("seno", "art")
 * as "breast" / "bottle" in the sheet. The API already normalises them when reading.
 */
function normaliseLegacyValues() {
  const s = sheet_(), n = s.getLastRow() - 1;
  if (n < 1) return;
  const rng = s.getRange(2, 5, n, 1), v = rng.getValues();
  rng.setValues(v.map(r => [FEED_TYPES[r[0]] || r[0]]));
}
