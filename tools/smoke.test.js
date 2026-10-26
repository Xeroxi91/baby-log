// Smoke test: two devices on the same in-memory backend. Run: npm test (from tools/)
const {JSDOM} = require('jsdom'), fs = require('fs'), path = require('path'), assert = require('assert');
const {api, props, data} = require('./gasmock')([]);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const calls = [];
function device(pre, setup){
  const dom = new JSDOM(html, {runScripts:'outside-only', url:'https://example.test/', pretendToBeVisual:true});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.open = false; };
  w.onerror = m => { throw new Error(m); }; w.scrollTo = ()=>{}; w.confirm = ()=>true;
  if (pre) pre(w.localStorage);
  if (setup) setup(w);
  w.localStorage.setItem('bl-key', 'GOOD'); w.localStorage.setItem('bl-api', 'https://script.google.com/macros/s/TEST/exec');
  w.fetch = async (u, o) => { const b = JSON.parse(o.body); const r = JSON.parse(api.doPost({postData:{contents:o.body}}).t);
    calls.push(b.action + (r.result && r.result.unchanged ? ':unchanged' : '')); return {json: async()=>r}; };
  // jsdom has no dynamic import(): modules/*.js are evaluated in the window instead; Web Crypto from Node
  Object.defineProperty(w, 'crypto', {value: require('crypto').webcrypto});
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.__imp = async p => w.eval(fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/^export /m, '') + ';({init})');
  w.eval(html.split('<script>')[1].split('</script>')[0].replace('import(`./', '__imp(`') + ';window.__t={get events(){return events},get allEvents(){return allEvents},refresh,featOn,FEATURES,notices,exportData,KID};');
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
  // a colour chosen for a child is shared with the profile; anything but a colour name is dropped
  const ch0 = JSON.parse(props.PROFILE).children.map(c=>({id:c.id, name:c.name}));
  const saved = JSON.parse(api.doPost({postData:{contents:JSON.stringify({key:'GOOD', action:'saveProfile', args:[{children:[{...ch0[0], color:'blue'}, {...ch0[1], color:'red;}'}]}]})}}).t).result.children;
  assert.ok(saved[0].color==='blue' && saved[1].color==='' && saved[0].name==='Baby A', 'child colour saved and checked');
  await A.__t.refresh(); await sleep(50);
  assert.strictEqual(A.__t.KID(saved[1].id).c, 'var(--kid-azure)', 'no colour: the tint of the position (2nd = azure)');
  // chosen in the child form: the same tint as a sibling is allowed, the monogram then has two letters
  d.querySelector('[data-tab="settings"]').click(); await sleep(20); d.querySelector('#setKids').click(); await sleep(20);
  d.querySelector('[data-tint="blue"][data-ti="1"]').click(); await sleep(20);
  d.querySelector('#profForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(300);
  assert.strictEqual(JSON.parse(props.PROFILE).children[1].color, 'blue', 'colour chosen in the form, saved with the profile');
  assert.ok(A.__t.KID(saved[0].id).c === 'var(--kid-blue)' && A.__t.KID(saved[0].id).m === 'BA' && A.__t.KID(saved[1].id).m === 'BB', 'same tint: two-letter monograms');

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
  // badge on the Day tab = reminders due now (children's and parents'), the rows highlighted in Day
  const lateRows = () => d.querySelectorAll('#tab-log .remi.late').length;
  const badge = () => d.querySelector('#dayBadge').hidden ? 0 : Number(d.querySelector('#dayBadge').textContent);
  assert.ok(d.querySelector('[data-pmgive].late') && badge() === lateRows() && badge() >= 1, '"For you" reminder and badge on the Day tab');
  const before = badge();
  d.querySelector('[data-pmgive]').click(); await sleep(50);
  assert.strictEqual(badge(), before - 1, 'one less once taken');
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
  // notifications (this phone): off by default; banner in the app, once per event; phone notification in the background
  const banner = () => d.querySelector('#notice').hidden ? '' : d.querySelector('#noticeTxt').textContent;
  A.checkNotices(); assert.strictEqual(banner(), '', 'notifications off by default');
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  d.querySelector('#ntOn').checked = true; d.querySelector('#ntOn').dispatchEvent(new A.Event('change')); await sleep(20);
  const [k1, k2] = JSON.parse(props.PROFILE).children.map(c=>c.id);
  await A.addEvents([{kind:'feed', feedType:'breast', child:k1, ts:Date.now()-4*36e5, dur:10}]); await sleep(400);
  A.checkNotices();
  assert.ok(banner().includes('since the end of the last feed'), 'banner for a feed gap over the threshold: ' + banner());
  d.querySelector('#noticeX').click(); A.checkNotices();
  assert.strictEqual(banner(), '', 'each event is notified once');
  await A.addEvents([{kind:'feed', feedType:'breast', child:k2, ts:Date.now()-50*60000, live:1}]); await sleep(400);
  A.checkNotices();
  assert.ok(banner().includes('breastfeeding timer running'), 'banner for a timer still running: ' + banner());
  d.querySelector('#noticeX').click();
  // in the background: a phone notification (quiet hours off so that the test does not depend on the time)
  const sent = []; A.Notification = class { constructor(t, o){ sent.push(o.body); } }; A.Notification.permission = 'granted';
  d.querySelector('#ntQuiet').checked = false; d.querySelector('#ntQuiet').dispatchEvent(new A.Event('change'));
  Object.defineProperty(d, 'visibilityState', {value:'hidden', configurable:true});
  await A.addEvents([{kind:'feed', feedType:'breast', child:k1, ts:Date.now()-50*60000, live:1}]); await sleep(400);
  A.checkNotices();
  assert.ok(sent.length === 1 && sent[0].includes('breastfeeding timer running') && banner() === '', 'phone notification when the app is in the background');
  // a type turned off
  d.querySelector('[data-nt="timer"]').checked = false; d.querySelector('[data-nt="timer"]').dispatchEvent(new A.Event('change'));
  await A.addEvents([{kind:'feed', feedType:'breast', child:k2, ts:Date.now()-55*60000, live:1}]); await sleep(400);
  A.checkNotices();
  assert.strictEqual(sent.length, 1, 'no notification for a type turned off');
  delete d.visibilityState;
  // frequency chosen in each reminder (for the family): repeated ones come back until given, also in quiet hours
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  d.querySelector('#addMed').click(); d.querySelector('#mName').value = 'Antibiotic'; d.querySelector('#mDue').value = '0';
  d.querySelector('#mNotify').value = '15'; d.querySelector('#mNight').checked = true;
  d.querySelector('#medForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(300);
  const ab = JSON.parse(props.MEDS).find(m=>m.name==='Antibiotic');
  assert.ok(ab.notify === 15 && ab.night === true, 'frequency and "also at night" saved with the reminder');
  const RealDate = A.Date, night = new RealDate(); night.setHours(23, 30, 0, 0); let fake = night.getTime();
  A.Date = class extends RealDate { constructor(...a){ a.length ? super(...a) : super(fake); } static now(){ return fake; } };
  d.querySelector('#ntQuiet').checked = true; d.querySelector('#ntQuiet').dispatchEvent(new A.Event('change'));
  Object.defineProperty(d, 'visibilityState', {value:'hidden', configurable:true});
  const n0 = sent.length;
  await A.__t.refresh(); A.checkNotices();
  assert.ok(sent.length === n0 + 1 && sent[n0].includes('Antibiotic for') && !sent[n0].includes('Vitamin D'), 'quiet hours: only the reminder set to ring also at night: ' + sent[n0]);
  A.checkNotices(); assert.strictEqual(sent.length, n0 + 1, 'not again before 15 min');
  fake += 16*60000; await A.__t.refresh(); A.checkNotices();
  assert.ok(sent.length === n0 + 2 && sent[n0+1].includes('Antibiotic for'), 'again after 15 min, until given');
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  const editAb = () => [...d.querySelectorAll('[data-medit]')].find(b=>b.closest('li').textContent.includes('Antibiotic')).click();
  editAb(); d.querySelector('#mNight').checked = false;
  d.querySelector('#medForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(300);
  fake += 16*60000; await A.__t.refresh(); A.checkNotices();
  assert.strictEqual(sent.length, n0 + 2, 'repeating but not "also at night": silent in quiet hours');
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  editAb(); d.querySelector('#mNotify').value = '-1';
  d.querySelector('#medForm').dispatchEvent(new A.Event('submit', {cancelable:true})); await sleep(300);
  fake += 16*60000; await A.__t.refresh(); A.checkNotices();
  assert.strictEqual(sent.length, n0 + 2, 'no notification when the reminder is set to none');
  A.Date = RealDate; delete d.visibilityState;
  // log an event: the six usual entries; height, notes and pumping behind "More"; Close at the bottom
  d.querySelector('#fab').click(); await sleep(20);
  assert.ok(!d.querySelector('.sheet .actions').classList.contains('open') && !d.querySelector('#moreLn').hidden, 'less used entries closed');
  assert.ok(d.querySelector('#moreTxt').textContent.startsWith('Height'), 'the line says what is behind More');
  d.querySelector('#moreBtn').click();
  assert.ok(d.querySelector('.sheet .actions').classList.contains('open') && d.querySelector('#moreLn').hidden, 'More opens them');
  d.querySelector('#sheetClose').click(); d.querySelector('#fab').click(); await sleep(20);
  assert.ok(!d.querySelector('.sheet .actions').classList.contains('open'), 'closed again at the next opening'); d.querySelector('#sheetClose').click();
  // Settings: an index; each page has its own address, so Back returns to the index; no ＋ in Settings
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  assert.ok(!d.querySelector('.sindex').hidden && d.querySelector('#fab').hidden && d.querySelector('#title').textContent==='Settings', 'Settings index, no ＋');
  d.querySelector('.srow[data-page="features"]').click(); await sleep(50);
  assert.ok(A.location.hash==='#settings/features' && !d.querySelector('.spage[data-page="features"]').hidden && d.querySelector('.sindex').hidden, 'a page with its own address');
  assert.ok(d.querySelector('#title').textContent==='Features' && !d.querySelector('#backBtn').hidden, 'page title and back link');
  d.querySelector('#backBtn').click(); await sleep(80);
  assert.ok(!d.querySelector('.sindex').hidden && d.querySelector('.spage[data-page="features"]').hidden, 'Back returns to the index');
  d.querySelector('[data-tab="log"]').click(); await sleep(20);
  assert.ok(!A.location.hash && !d.querySelector('#fab').hidden && !d.querySelector('#livebar').hidden, 'Day: no address, ＋ and feeds in progress back');
  // Italian: every interface text has its translation (a missing one is logged as an error)
  const missing = [];
  const I = device(ls => ls.setItem('bl-lang', 'it'), w => { w.console.error = (...a) => { if (String(a[0]).startsWith('Missing Italian')) missing.push(a[0]); }; });
  await sleep(400); const di = I.document;
  const [i1] = JSON.parse(props.PROFILE).children.map(c=>c.id);
  await I.addEvents([{kind:'feed', feedType:'breast', child:i1, ts:Date.now()-5*60000, live:1, side:'L'}]); await sleep(400);
  for (const t of ['log', 'trend', 'settings']) { di.querySelector(`[data-tab="${t}"]`).click(); await sleep(50); }
  di.querySelector('[data-tab="log"]').click(); di.querySelector('#fab').click(); await sleep(50); di.querySelector('#sheetClose').click();
  assert.deepStrictEqual(missing, [], 'no missing Italian');
  // one card for a feed in progress: the live bar, not a second card in the row of children
  const lives = di.querySelectorAll('#livebar .live').length, name = I.__t.events.find(e=>e.live && e.child===i1) && JSON.parse(props.PROFILE).children[0].name;
  assert.ok(lives >= 1 && di.querySelector('#livebar .endfeed').textContent === 'Termina poppata', 'feed in progress with "Termina poppata"');
  assert.ok(![...di.querySelectorAll('#sincebar .scard')].some(c=>c.textContent.includes(name)), 'no second card for the same feed');
  // family rows (modules shared by the whole family): any module kind, fields in "data", never in the baby screens
  const old = Date.now() - 10*864e5;
  await A.addEvents([{kind:'tstock', child:'family', ts: old, data:{name:'Rice', qty:2, ok:true, 'bad key':1, nested:{x:1}, long:'x'.repeat(300)}},
                     {kind:'feed', child:'family', ts: Date.now(), feedType:'bottle', ml:50}]); await sleep(400);
  const fam = data.filter(r=>r[2]==='family');
  assert.strictEqual(fam.length, 1, 'family row stored, a baby kind for the family refused');
  const fd = JSON.parse(fam[0][21]);
  assert.ok(fd.name==='Rice' && fd.qty===2 && fd.ok===true && !('bad key' in fd) && !fd.nested && fd.long.length===200, 'data cleaned on the server: ' + fam[0][21]);
  assert.ok(!A.__t.events.some(e=>e.child==='family') && A.__t.allEvents.some(e=>e.child==='family'), 'family rows stay out of the baby screens');
  const D = device(); await sleep(400);
  const dr = D.__t.allEvents.find(e=>e.kind==='tstock');
  assert.ok(dr && dr.child==='family' && dr.data.name==='Rice', 'first load brings family rows older than 48 h');
  assert.ok(!D.__t.events.some(e=>e.kind==='tstock'), 'and keeps them out of the baby screens');
  assert.ok(!JSON.parse(api.doPost({postData:{contents:JSON.stringify({key:'GOOD', action:'history', args:[{before: Date.now()}]})}}).t).result.events.some(e=>e.child==='family'), 'history skips family rows');
  let csv = ''; A.Blob = class { constructor(p){ csv = p.join(''); } }; A.URL.createObjectURL = ()=>''; A.URL.revokeObjectURL = ()=>{};
  await A.__t.exportData('csv');
  assert.ok(csv.includes('feed') && !csv.includes('tstock'), 'the spreadsheet is about the children only');
  // module hooks: its own tab before Settings, ＋ on that tab, notifications switched with its feature
  A.__t.FEATURES.push({k:'tmod', name:'Test module', desc:'', def:true, file:'../tools/fixtures/tabmod'});
  await A.__t.refresh(); await sleep(200);
  const tb = d.querySelector('[data-tab="m-tmod"]');
  assert.ok(tb && tb.nextElementSibling.dataset.tab==='settings', 'module tab added before Settings');
  tb.click(); await sleep(20);
  assert.ok(!d.querySelector('#tab-m-tmod').hidden && d.querySelector('#tab-log').hidden, 'module tab shown');
  assert.ok(d.querySelector('#tmBody').dataset.bound==='1' && d.querySelector('#tmBody').textContent.startsWith('1 '), 'module tab rendered with the family rows');
  d.querySelector('#fab').click(); await sleep(20);
  assert.ok(A.__tmFab===1 && !d.querySelector('#sheet').open, '＋ runs the module action on its tab');
  d.querySelector('[data-tab="log"]').click(); d.querySelector('#fab').click(); await sleep(20);
  assert.ok(d.querySelector('#sheet').open, '＋ logs baby events on Day'); d.querySelector('#sheetClose').click();
  assert.ok(A.__t.notices().some(n=>n.text==='test module notice'), 'module notices included');
  d.querySelector('[data-tab="settings"]').click(); await sleep(20);
  const nt = d.querySelector('[data-nt="tmod"]'); assert.ok(nt, 'module notification type listed in Settings');
  nt.checked = false; nt.dispatchEvent(new A.Event('change'));
  assert.ok(!A.__t.notices().some(n=>n.text==='test module notice'), 'module notices off with their switch');
  tb.click(); await sleep(20);                                   // switched off (e.g. from another phone) while its tab is open
  sw(A, 'tmod').checked = false; sw(A, 'tmod').dispatchEvent(new A.Event('change')); await sleep(200);
  assert.ok(!d.querySelector('[data-tab="m-tmod"]') && !d.querySelector('#tab-m-tmod'), 'module tab removed when turned off');
  assert.ok(!d.querySelector('#tab-log').hidden && !d.querySelector('#fab').hidden, 'back to Day, ＋ shown');
  console.log('smoke test passed');
  process.exit(0);
})().catch(e=>{ console.error('FAILED:', e.stack); process.exit(1); });
