/**
 * Baby log – reminders (part of the Apps Script backend; see Code.gs).
 */
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
      group: /^g[a-z0-9]{6,20}$/.test(String(m.group || '')) ? String(m.group) : '',      // same reminder for several children
      notify: [-1, 0, 15, 30, 60].indexOf(Number(m.notify)) >= 0 ? Number(m.notify) : 0  // -1 none, 0 once, N: every N min until given
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
