/**
 * Baby log – features (part of the Apps Script backend; see Code.gs).
 */
/* ---------- features: modules switched on and off for the whole family ----------
   Property FEATURES = {on: {key: true | false}}: only the choices made in Settings → Features.
   Keys never chosen follow the app's defaults; `used` tells the app which kinds of entries already
   exist in the sheet, so an update never hides something the family uses.
   Switching a module off only hides it: nothing is deleted. */
const FEATURE_KEY = /^[a-z][A-Za-z0-9]{1,15}$/;

function features_(data) {
  const raw = PropertiesService.getScriptProperties().getProperty('FEATURES');
  return { on: raw ? (JSON.parse(raw).on || {}) : {}, used: usedKinds_(data) };
}

/** Kinds of entries in the sheet (plus "tw" for test weighings), from the rows already read by sync. */
function usedKinds_(data) {
  const seen = {};
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || r[COL.deleted]) continue;
    seen[r[COL.kind]] = true;
    if (r[COL.pre] && r[COL.post]) seen.tw = true;
  }
  if (meds_().length) seen.med = true;
  return Object.keys(seen).sort();
}

/** Merges the choices sent by the app (only the switches changed, so two phones never overwrite each other). */
function saveFeatures_(on) {
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('FEATURES');
    const cur = raw ? (JSON.parse(raw).on || {}) : {};
    Object.keys(on).slice(0, 40).forEach(k => { if (FEATURE_KEY.test(k) && typeof on[k] === 'boolean') cur[k] = on[k]; });
    props.setProperty('FEATURES', JSON.stringify({ on: cur }));
    bump_(Date.now());
    return { on: cur };
  });
}
