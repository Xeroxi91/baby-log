// Smoke test: two devices on the same in-memory backend. Run: npm test (from tools/)
const {JSDOM} = require('jsdom'), fs = require('fs'), path = require('path'), assert = require('assert');
const {api, props} = require('./gasmock')([]);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const calls = [];
function device(){
  const dom = new JSDOM(html, {runScripts:'outside-only', url:'https://example.test/', pretendToBeVisual:true});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.open = false; };
  w.onerror = m => { throw new Error(m); }; w.scrollTo = ()=>{}; w.confirm = ()=>true;
  w.localStorage.setItem('bl-key', 'GOOD'); w.localStorage.setItem('bl-api', 'https://script.google.com/macros/s/TEST/exec');
  w.fetch = async (u, o) => { const b = JSON.parse(o.body); const r = JSON.parse(api.doPost({postData:{contents:o.body}}).t);
    calls.push(b.action + (r.result && r.result.unchanged ? ':unchanged' : '')); return {json: async()=>r}; };
  w.eval(html.split('<script>')[1].split('</script>')[0] + ';window.__t={get events(){return events},get allEvents(){return allEvents},refresh,featOn};');
  return w;
}
const sleep = ms => new Promise(r=>setTimeout(r, ms));
(async()=>{
  const A = device(), d = A.document; await sleep(200);
  const set = (i,k,v) => { d.querySelector(`[data-i="${i}"][data-k="${k}"]`).value = v; };
  d.querySelector('#addKid').click();
  set(0,'name','Baby A'); set(0,'birth','2026-09-18'); set(0,'gaW','36'); set(0,'gaD','5');
  set(1,'name','Baby B'); set(1,'sex','f'); set(1,'birth','2026-09-18');
  d.querySelector('#profForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(200);
  assert.strictEqual(JSON.parse(props.PROFILE).children.length, 2, 'children saved');

  [...d.querySelectorAll('#who button')].forEach(b=>{ if (b.getAttribute('aria-pressed')!=='true') b.click(); });
  d.querySelector('[data-a="pee"]').click(); await sleep(400);
  assert.strictEqual(A.__t.events.length, 2, 'pee logged for both');

  const B = device(); await sleep(300);
  assert.strictEqual(B.__t.events.length, 2, 'device B sees the events');

  // after its own write a device does one full check, then idle polls get the quick answer
  calls.length = 0; await A.__t.refresh(); await A.__t.refresh(); await A.__t.refresh();
  assert.strictEqual(calls[calls.length-1], 'sync:unchanged', 'idle polls are quick: ' + calls.join(','));

  B.document.querySelector('.ritem button').click(); await sleep(20);
  B.document.querySelector('#fDel').click(); await sleep(400);
  await A.__t.refresh();
  assert.strictEqual(A.__t.events.length, 1, 'deletion reaches device A');

  d.querySelector('[data-tab="settings"]').click(); d.querySelector('#addMed').click();
  d.querySelectorAll('#mKids button').forEach(b=>{ if (b.getAttribute('aria-pressed')!=='true') b.click(); });
  d.querySelector('#mName').value = 'Vitamin D';
  d.querySelector('#medForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(200);
  const meds = JSON.parse(props.MEDS);
  assert.ok(meds.length === 2 && meds[0].group && meds[0].group === meds[1].group, 'one reminder for two children');

  // features: family-wide switches stored on the server; turning one off hides, never deletes
  assert.ok(!A.__t.featOn('pump') && d.querySelector('[data-a="pump"]').hidden, 'pumping starts off for a new family');
  assert.ok(A.__t.featOn('notes'), 'notes start on');
  const sw = (dev, k) => dev.document.querySelector(`[data-feat="${k}"]`);
  d.querySelector('[data-tab="settings"]').click();
  sw(A, 'pump').checked = true; sw(A, 'pump').dispatchEvent(new A.Event('change')); await sleep(200);
  assert.strictEqual(JSON.parse(props.FEATURES).on.pump, true, 'switch saved on the server');
  assert.ok(!d.querySelector('[data-a="pump"]').hidden, 'pump button shown when on');
  d.querySelector('[data-a="note"]').click(); await sleep(20);
  d.querySelector('#fText').value = 'test note';
  d.querySelector('#dlgForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(400);
  const nNotes = dev => dev.__t.events.filter(e=>e.kind==='note').length;
  assert.strictEqual(nNotes(A), 1, 'note logged');
  sw(A, 'notes').checked = false; sw(A, 'notes').dispatchEvent(new A.Event('change')); await sleep(200);
  assert.ok(d.querySelector('[data-a="note"]').hidden, 'note button hidden when off');
  assert.strictEqual(nNotes(A), 0, 'notes hidden when off');
  assert.strictEqual(A.__t.allEvents.filter(e=>e.kind==='note').length, 1, 'but not deleted');
  await B.__t.refresh(); await sleep(50);
  assert.ok(!B.__t.featOn('notes') && B.__t.featOn('pump'), 'the other device follows the family choice');
  assert.strictEqual(nNotes(B), 0, 'device B hides notes too');
  // a module never chosen follows its default, unless its entries already exist (existing users keep what they use)
  props.FEATURES = JSON.stringify({on:{}}); props.REV = String(Date.now() + 1);
  await B.__t.refresh(); await sleep(50);
  assert.ok(B.__t.featOn('notes') && !B.__t.featOn('pump'), 'defaults when nothing was chosen');
  assert.ok(A.__t.featOn('pump'), 'device A has not synced yet: pumping still on there');
  d.querySelector('[data-a="pump"]').click(); await sleep(20);
  d.querySelector('#fMl').value = '80';
  d.querySelector('#dlgForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(400);
  props.FEATURES = JSON.stringify({on:{}}); props.REV = String(Date.now() + 1);
  await B.__t.refresh(); await sleep(50);
  assert.ok(B.__t.featOn('pump'), 'pumping already used: on without a choice');
  console.log('smoke test passed');
  process.exit(0);
})().catch(e=>{ console.error('FAILED:', e.message); process.exit(1); });
