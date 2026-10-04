/**
 * Baby log – Google Apps Script backend bound to a Google Sheet.
 * Exposes a small JSON API, protected by access codes, for the static page (e.g. GitHub Pages).
 *
 * Sheet "events": id | kind | child | ts | feedType | grams | dateTime | ml | duration | running | cm
 * The "child" column holds an internal child key; the page only ever sees opaque child ids.
 *
 * Setup: 1) run createAccessCodes()  2) Deploy > New deployment > Web app,
 *        Execute as: Me, Who has access: Anyone.
 */
const SHEET = 'events';
const LEGACY_SHEETS = ['eventi'];   // older versions of this project used this sheet name
const HEADER = ['id', 'kind', 'child', 'ts', 'feedType', 'grams', 'dateTime', 'ml', 'duration', 'running', 'cm'];
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
        listEvents:   () => listEvents().map(toClient_).filter(x => x.child),
        addEvents:    () => addEvents((args[0] || []).map(toSheet_)),
        updateEvent:  () => updateEvent(args[0], toSheet_(args[1])),
        deleteEvents: () => deleteEvents(args[0] || []),
        getProfile:   () => ({ children: children_().map(publicChild_) }),
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

/* ---------- children ---------- */
// Each child has an opaque id (seen by the page) and a key (value of the "child" column, never sent).
const CHILD_FIELDS = ['name', 'sex', 'birth', 'gaW', 'gaD', 'bw', 'bl', 'bh'];
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
      const c = prev ? Object.assign({}, prev) : { id: newId_() };
      if (!prev) c.key = c.id;
      CHILD_FIELDS.forEach(f => { if (x[f] !== undefined) c[f] = String(x[f]).slice(0, 60); });
      return c;
    });
    // a child that already has events is never removed
    const used = {};
    sheet_().getDataRange().getValues().slice(1).forEach(r => used[String(r[2])] = true);
    cur.forEach(c => { if (used[c.key] && !out.some(o => o.id === c.id)) out.push(c); });
    PropertiesService.getScriptProperties().setProperty('PROFILE', JSON.stringify({ children: out }));
    CHILDREN_CACHE_ = out;
    return out;
  });
}

function toSheet_(e) {
  if (!e) return e;
  const c = children_().find(x => x.id === e.child);
  if (!c) throw new Error('unknown child');
  const o = Object.assign({}, e, { kidKey: c.key });
  delete o.child;
  return o;
}

function toClient_(e) {
  const c = children_().find(x => x.key === e.kidKey);
  const o = Object.assign({}, e, { child: c ? c.id : null });
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

function row_(id, e) {
  return [id, e.kind, e.kidKey, Number(e.ts), e.feedType || '', e.grams || '', new Date(Number(e.ts)),
          e.ml || '', e.dur || '', e.live ? 1 : '', e.cm || ''];
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function listEvents() {
  const v = sheet_().getDataRange().getValues();
  v.shift();
  return v.filter(r => r[0]).map(r => {
    const e = { id: String(r[0]), kind: r[1], kidKey: r[2], ts: Number(r[3]) };
    if (r[4]) e.feedType = FEED_TYPES[r[4]] || r[4];
    if (r[5]) e.grams = Number(r[5]);
    if (r[7]) e.ml = Number(r[7]);
    if (r[8]) e.dur = Number(r[8]);
    if (r[9]) e.live = 1;
    if (r[10]) e.cm = Number(r[10]);
    return e;
  });
}

function addEvents(evs) {
  return withLock_(() => {
    const s = sheet_();
    const rows = evs.map(e => row_(Utilities.getUuid(), e));
    s.getRange(s.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    return rows.map(r => r[0]);
  });
}

function updateEvent(id, e) {
  return withLock_(() => {
    const s = sheet_();
    const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues();
    for (let i = 1; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        s.getRange(i + 1, 1, 1, HEADER.length).setValues([row_(id, e)]);
        return true;
      }
    }
    return false;
  });
}

function deleteEvents(delIds) {
  return withLock_(() => {
    const s = sheet_();
    const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues();
    for (let i = ids.length - 1; i >= 1; i--) {
      if (delIds.indexOf(String(ids[i][0])) >= 0) s.deleteRow(i + 1);
    }
    return true;
  });
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
