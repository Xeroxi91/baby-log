/**
 * Baby log – children (part of the Apps Script backend; see Code.gs).
 */
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
