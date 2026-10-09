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

/* ---------- children ---------- */
// Each child has an opaque id (seen by the page) and a key (value of the "child" column, never sent).
const CHILD_FIELDS = ['name', 'sex', 'birth', 'gaW', 'gaD', 'bw', 'bl', 'bh', 'stage'];
const newId_ = () => 'c' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);

let CHILDREN_CACHE_ = null;
function children_() {
  if (CHILDREN_CACHE_) return CHILDREN_CACHE_;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('PROFILE');
  const p = raw ? JSON.parse(raw) : null;
  if (p && Array.isArray(p.children)) return (CHILDREN_CACHE_ = p.children);
  // migration: build the children from the keys already in the sheet (and from a legacy profile, if any)
  const keys = {};
  sheet_().getDataRange().getValues().slice(1).forEach(r => { if (r[2]) keys[String(r[2])] = true; });
  const ch = Object.keys(keys).map(k => {
    const old = (p && p[k]) || {};
    return { id: newId_(), key: k, name: old.name || (k.charAt(0).toUpperCase() + k.slice(1)), sex: old.sex || 'm',
             birth: old.birth || '', gaW: old.gaW || 40, gaD: old.gaD || 0, bw: old.bw || '', bl: old.bl || '', bh: old.bh || '' };
  });
  props.setProperty('PROFILE', JSON.stringify({ children: ch }));
  return (CHILDREN_CACHE_ = ch);
}

function publicChild_(c) {
  const o = { id: c.id };
  CHILD_FIELDS.forEach(f => o[f] = c[f]);
  return o;
}

function saveChildren_(list) {
  return withLock_(() => {
    const cur = children_(), byId = {};
    cur.forEach(c => byId[c.id] = c);
    const out = list.slice(0, 12).map(x => {
      const prev = x.id && byId[x.id];
      // new children keep the id created on the device (local mode), so their entries can be uploaded
      const ok = x.id && /^c[a-z0-9]{6,20}$/.test(String(x.id)) && !byId[x.id];
      const c = prev ? Object.assign({}, prev) : { id: ok ? String(x.id) : newId_() };
      if (!prev) c.key = c.id;
      CHILD_FIELDS.forEach(f => { if (x[f] !== undefined) c[f] = String(x[f]).slice(0, 60); });
      return c;
    });
    // a child that already has events is never removed
    const used = {};
    sheet_().getDataRange().getValues().slice(1).forEach(r => used[String(r[2])] = true);
    cur.forEach(c => { if (used[c.key] && !out.some(o => o.id === c.id)) out.push(c); });
    PropertiesService.getScriptProperties().setProperty('PROFILE', JSON.stringify({ children: out }));
    bump_(Date.now());
    CHILDREN_CACHE_ = out;
    return out;
  });
}

function toSheet_(e) {
  if (!e) return e;
  if (e.kind === 'pump' || e.kind === 'pmed') { const o = Object.assign({}, e, { kidKey: PARENT }); delete o.child; return o; }
  const c = children_().find(x => x.id === e.child);
  if (!c) throw new Error('unknown child');
  const o = Object.assign({}, e, { kidKey: c.key });
  delete o.child;
  return o;
}

function toClient_(e) {
  const c = children_().find(x => x.key === e.kidKey);
  const o = Object.assign({}, e, { child: e.kidKey === PARENT ? PARENT : c ? c.id : null });
  delete o.kidKey;
  return o;
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

/* Revision: time of the last write (events, children or reminders). Lets a sync with nothing to
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
    return { serverTime: now, events: events, children: children_().map(publicChild_), meds: meds_(), pmeds: pmeds_(), older: older };
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

/* ---------- daily reminders (vitamin D, prescribed medicines…) ---------- */
function meds_() {
  const raw = PropertiesService.getScriptProperties().getProperty('MEDS');
  return raw ? JSON.parse(raw) : [];
}

function saveMeds_(list) {
  return withLock_(() => {
    const ids = {};
    children_().forEach(c => ids[c.id] = true);
    const out = list.slice(0, 30).filter(m => m && ids[m.child] && String(m.name || '').trim()).map(m => ({
      id: /^m[a-z0-9]{6,20}$/.test(String(m.id)) ? String(m.id) : 'm' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
      child: String(m.child),
      name: String(m.name).trim().slice(0, 40),
      dose: String(m.dose || '').slice(0, 40),
      times: Math.max(1, Math.min(12, Number(m.times) || 1)),
      due: Math.max(0, Math.min(23, Number(m.due) || 0)),
      every: Math.max(0, Math.min(48, Number(m.every) || 0)),          // hours between doses (0 = times a day)
      until: /^\d{4}-\d{2}-\d{2}$/.test(String(m.until || '')) ? String(m.until) : '',
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(m.from || '')) ? String(m.from) : '',          // first day it applies
      group: /^g[a-z0-9]{6,20}$/.test(String(m.group || '')) ? String(m.group) : ''       // same reminder for several children
    }));
    PropertiesService.getScriptProperties().setProperty('MEDS', JSON.stringify(out));
    bump_(Date.now());
    return out;
  });
}

/* ---------- parents' reminders, end-to-end encrypted ----------
   The app encrypts them on the phone with a family passphrase; here they are opaque text:
   neither the sheet nor these properties contain readable names or doses. */
function pmeds_() {
  const raw = PropertiesService.getScriptProperties().getProperty('PMEDS');
  return raw ? JSON.parse(raw) : null;
}

function savePMeds_(pm) {
  return withLock_(() => {
    const ok = s => typeof s === 'string' && s.length <= 4000 && /^[A-Za-z0-9+/=]*$/.test(s);
    if (!pm || !ok(pm.salt) || !ok(pm.check)) throw new Error('invalid');
    const items = (pm.items || []).slice(0, 50)
      .filter(x => x && /^p[a-z0-9]{6,20}$/.test(String(x.id)) && ok(x.enc))
      .map(x => ({ id: String(x.id), enc: x.enc }));
    const out = { v: 1, salt: pm.salt, check: pm.check, items: items };
    PropertiesService.getScriptProperties().setProperty('PMEDS', JSON.stringify(out));
    bump_(Date.now());
    return out;
  });
}
