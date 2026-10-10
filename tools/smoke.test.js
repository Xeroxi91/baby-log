// Smoke test: two devices on the same in-memory backend. Run: npm test (from tools/)
const {JSDOM} = require('jsdom'), fs = require('fs'), path = require('path'), assert = require('assert');
const {api, props} = require('./gasmock')([]);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const calls = [];
function device(pre){
  const dom = new JSDOM(html, {runScripts:'outside-only', url:'https://example.test/', pretendToBeVisual:true});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.open = false; };
  w.onerror = m => { throw new Error(m); }; w.scrollTo = ()=>{}; w.confirm = ()=>true;
  if (pre) pre(w.localStorage);
  w.localStorage.setItem('bl-key', 'GOOD'); w.localStorage.setItem('bl-api', 'https://script.google.com/macros/s/TEST/exec');
  w.fetch = async (u, o) => { const b = JSON.parse(o.body); const r = JSON.parse(api.doPost({postData:{contents:o.body}}).t);
    calls.push(b.action + (r.result && r.result.unchanged ? ':unchanged' : '')); return {json: async()=>r}; };
  // jsdom has no dynamic import(): modules/*.js are evaluated in the window instead; Web Crypto from Node
  Object.defineProperty(w, 'crypto', {value: require('crypto').webcrypto});
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.__imp = async p => w.eval(fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/^export /m, '') + ';({init})');
  w.eval(html.split('<script>')[1].split('</script>')[0].replace('import(`./', '__imp(`') + ';window.__t={get events(){return events},get allEvents(){return allEvents},refresh,featOn};');
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
  // signals: one family switch, off by default; a phone that had them on (up to 2.1) brings them on
  assert.ok(!A.__t.featOn('signals') && d.querySelector('#thrMode').closest('.sect').hidden, 'signals off, Signals section hidden');
  const C = device(ls => ls.setItem('bl-thr', JSON.stringify({on:true, auto:true}))); await sleep(400);
  assert.strictEqual(JSON.parse(props.FEATURES).on.signals, true, 'old per-phone choice migrated to the family');
  assert.strictEqual(JSON.parse(C.localStorage.getItem('bl-thr')).on, false, 'migrated once');
  await A.__t.refresh(); await sleep(50);
  assert.ok(A.__t.featOn('signals') && !d.querySelector('#thrMode').closest('.sect').hidden, 'Signals section shown on the other phone');
  // parents' reminders: off by default; a module loaded only when switched on
  assert.ok(!A.__t.featOn('pmeds') && !d.querySelector('#pmAdd'), "parents' reminders off by default");
  d.querySelector('[data-tab="settings"]').click();
  sw(A, 'pmeds').checked = true; sw(A, 'pmeds').dispatchEvent(new A.Event('change')); await sleep(300);
  assert.ok(d.querySelector('#pmAdd'), 'module loaded and shown in Settings');
  const addPm = async (dev, name, shared) => { const q = s => dev.document.querySelector(s);
    q('#pmAdd').click(); q('#pmName').value = name; q('#pmDue').value = '0';
    q(`#pmWhere [data-v="${shared ? 'shared' : 'local'}"]`).click();
    q('#pmForm').dispatchEvent(new dev.Event('submit', {cancelable:true})); await sleep(100); };
  await addPm(A, 'Iron', false);
  assert.strictEqual(JSON.parse(A.localStorage.getItem('bl-pmeds'))[0].name, 'Iron', 'kept on this phone');
  assert.ok(!props.PMEDS, 'nothing sent to the server');
  d.querySelector('[data-tab="log"]').click(); await sleep(50);
  assert.ok(d.querySelector('[data-pmgive]') && d.querySelector('#dayBadge').textContent === '1', '"For you" card and badge on the Day tab');
  d.querySelector('[data-pmgive]').click(); await sleep(50);
  assert.ok(d.querySelector('#dayBadge').hidden, 'badge gone once taken');
  assert.strictEqual(JSON.parse(A.localStorage.getItem('bl-pmeds-given')).length, 1, 'dose kept on this phone');
  // a dose taken can be edited (time) like a child's
  const hhmm = ts => { const x = new Date(ts); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}T${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`; };
  const earlier = Date.now() - 60*60000;
  d.querySelector('[data-pmdose]').click(); await sleep(20);
  assert.ok(d.querySelector('#pdDlg').open, 'dose editor opens');
  d.querySelector('#pdTs').value = hhmm(earlier);
  d.querySelector('#pdForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(50);
  assert.strictEqual(hhmm(JSON.parse(A.localStorage.getItem('bl-pmeds-given'))[0].ts), hhmm(earlier), 'dose time changed on this phone');
  // shared, encrypted: the passphrase is asked the first time
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  await addPm(A, 'Vitamin B12', true);
  assert.ok(d.querySelector('#ppDlg').open, 'passphrase asked');
  d.querySelector('#ppIn').value = 'correct horse'; d.querySelector('#ppRep').value = 'correct horse';
  d.querySelector('#ppForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(4000);
  const pm = JSON.parse(props.PMEDS);
  assert.strictEqual(pm.items.length, 1, 'shared reminder stored');
  // the name must not be readable, neither as text nor inside the base64 (a random "B12" in base64 is fine)
  const plain = s => s.includes('Vitamin');
  assert.ok(!plain(props.PMEDS) && !pm.items.some(x=>plain(Buffer.from(x.enc, 'base64').toString('latin1'))), 'server stores only encrypted text');
  // the other parent: locked until the passphrase is entered
  await B.__t.refresh(); await sleep(300);
  const b = B.document;
  b.querySelector('[data-tab="log"]').click(); await sleep(50);
  assert.ok(b.querySelector('[data-pmunlock]') && !b.querySelector('[data-pmgive]'), 'locked on device B');
  b.querySelector('[data-pmunlock]').click(); await sleep(20);
  b.querySelector('#ppIn').value = 'wrong passphrase';
  b.querySelector('#ppForm').dispatchEvent(new B.Event('submit', {cancelable:true})); await sleep(3000);
  assert.ok(!b.querySelector('#ppErr').hidden, 'wrong passphrase refused');
  b.querySelector('#ppIn').value = 'correct horse';
  b.querySelector('#ppForm').dispatchEvent(new B.Event('submit', {cancelable:true})); await sleep(3000);
  const gv = b.querySelector('[data-pmgive]');
  assert.ok(gv && gv.textContent.includes('Vitamin B12') && !b.body.textContent.includes('Iron'), 'device B sees the shared reminder only');
  gv.click(); await sleep(400);
  b.querySelector('[data-pmdose]').click(); await sleep(20);
  b.querySelector('#pdTs').value = hhmm(earlier);
  b.querySelector('#pdForm').dispatchEvent(new B.Event('submit', {cancelable:true})); await sleep(400);
  await A.__t.refresh(); await sleep(100);
  const pd = A.__t.allEvents.find(e=>e.kind==='pmed');
  assert.ok(pd && hhmm(pd.ts) === hhmm(earlier), 'dose of a shared reminder, edited on B, reaches device A');
  console.log('smoke test passed');
  process.exit(0);
})().catch(e=>{ console.error('FAILED:', e.stack); process.exit(1); });
