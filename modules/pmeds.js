/* Parents' reminders: a module of Baby log (Settings → Features), loaded by index.html only when it is on.

   A parent's own medicines or supplements, with the same schedules as the children's reminders
   (times a day, or every few hours; optional last day). Each reminder is kept either
   - on this phone only (default): reminder and doses never leave the device; or
   - shared with the family, end-to-end encrypted: the phone encrypts it (AES-GCM, 256-bit key derived
     from a family passphrase with PBKDF2-SHA-256) and the server stores opaque text only (PMEDS).
     Doses of shared reminders are `pmed` entries holding only the reminder id. The passphrase is never
     sent anywhere and cannot be recovered: if it is forgotten, the shared reminders are lost.
   Organisational only: the app gives no advice on doses or on medicines while breastfeeding. */

const ITER = 600000;                     // PBKDF2 iterations (fixed for format v1)
const CHECK = "baby-log";                // encrypted with the key: tells a wrong passphrase apart
const H = 36e5;
const LS = {list: "bl-pmeds", given: "bl-pmeds-given", key: "bl-pkey"};

const IT = {
  "For you": "Per te", "This phone only": "Solo su questo telefono", "Shared, encrypted": "Condiviso, cifrato",
  "New reminder for you": "Nuovo promemoria per te", "Edit reminder for you": "Modifica promemoria per te",
  "＋ Add reminder for you": "＋ Aggiungi promemoria per te", "e.g. Iron": "es. Ferro", "Kept": "Dove si trova",
  "Family passphrase": "Frase segreta della famiglia", "Passphrase": "Frase segreta", "Repeat the passphrase": "Ripeti la frase segreta",
  "Unlock": "Sblocca", "Set passphrase": "Imposta la frase segreta", "Lock on this phone": "Blocca su questo telefono",
  "Forgot it? Start over": "Dimenticata? Ricomincia",
  "Family passphrase: not set.": "Frase segreta della famiglia: non impostata.",
  "Family passphrase: unlocked on this phone.": "Frase segreta della famiglia: sbloccata su questo telefono.",
  "Family passphrase: locked on this phone.": "Frase segreta della famiglia: bloccata su questo telefono.",
  "Shared reminders need a shared log.": "I promemoria condivisi richiedono un diario condiviso.",
  "Reminders kept on this phone only never leave it. Shared reminders are encrypted on the phone with the family passphrase: the server stores only unreadable text.":
    "I promemoria tenuti solo su questo telefono non lo lasciano mai. Quelli condivisi sono cifrati sul telefono con la frase segreta della famiglia: il server conserva solo testo illeggibile.",
  "Choose a passphrase to share reminders with the other parent, encrypted. Tell it in person, not in a chat.":
    "Scegli una frase segreta per condividere i promemoria con l'altro genitore, cifrati. Diglielo di persona, non in chat.",
  "It cannot be recovered: if it is forgotten, the shared reminders are lost.":
    "Non si può recuperare: se viene dimenticata, i promemoria condivisi vanno persi.",
  "Enter the family passphrase to see the shared reminders on this phone.":
    "Inserisci la frase segreta della famiglia per vedere i promemoria condivisi su questo telefono.",
  "At least 8 characters": "Almeno 8 caratteri", "The two passphrases are different": "Le due frasi segrete sono diverse",
  "Wrong passphrase": "Frase segreta errata", "Checking…": "Verifica…",
  "Remove all shared reminders and choose a new passphrase? Reminders kept on this phone only are not affected.":
    "Rimuovere tutti i promemoria condivisi e scegliere una nuova frase segreta? I promemoria tenuti solo su questo telefono non cambiano.",
  "Lock shared reminders on this phone? The passphrase will be needed to see them again.":
    "Bloccare i promemoria condivisi su questo telefono? Per rivederli servirà la frase segreta.",
  "Delete this reminder?": "Eliminare questo promemoria?",
  "Shared reminders need a connection": "Per i promemoria condivisi serve la connessione",
  "Not saved": "Non salvato", "no notifications": "nessuna notifica", "also at night": "anche di notte",
  "Every 15 min until taken": "Ogni 15 min finché non è preso", "Every 30 min until taken": "Ogni 30 min finché non è preso", "Every hour until taken": "Ogni ora finché non è preso", "due now": "da prendere", "Dose taken": "Dose presa", "Edit reminder": "Modifica promemoria",
  "Your own reminders, e.g. medicines or supplements. They appear in Day under “For you”; doses are not checked by the app.":
    "I tuoi promemoria, per esempio farmaci o integratori. Compaiono in Giorno sotto “Per te”; l'app non controlla le dosi."
};
const IT_T = [
  ["Shared reminders locked on this phone ({x})", "Promemoria condivisi bloccati su questo telefono ({x})"],
  ["{x} (for you): due now", "{x} (per te): da prendere ora"], ["notify every {x} min", "notifica ogni {x} min"], ["due at {x}", "da prendere dalle {x}"], ["Edit the dose of {x} at {x}", "Modifica la dose di {x} delle {x}"], ["every {x} h", "ogni {x} h"], ["{x}× a day", "{x}× al giorno"],
  ["remind after {x}", "ricorda dopo le {x}"], ["until {x}", "fino al {x}"],
  ["{x} already given today. Undo the last one?", "{x} già preso oggi. Annullare l'ultimo?"],
  ["Next dose of {x} is at {x}. Log a dose now anyway?", "La prossima dose di {x} è alle {x}. Registrare comunque una dose ora?"]
];

export function init(app){
  app.addIT(IT, IT_T);
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch(e) { return d; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} }
  };
  let local = store.get(LS.list, []);                 // reminders kept on this phone only
  let localGiven = store.get(LS.given, []);           // their doses: [{id, ref, ts}]
  let key = null, keySalt = "";                       // CryptoKey for the shared reminders (when unlocked)
  let shared = [], openedFor = "";                    // decrypted shared reminders; blob they come from
  const saveLocal = () => { store.set(LS.list, local); store.set(LS.given, localGiven); };
  // doses older than 90 days are not needed for the checklist
  localGiven = localGiven.filter(g => g.ts > Date.now() - 90*864e5);

  /* ---------- encryption (Web Crypto) ---------- */
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = u => { let s = ""; new Uint8Array(u).forEach(c => s += String.fromCharCode(c)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pass, salt){
    const base = await crypto.subtle.importKey("raw", te.encode(pass.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256"}, base, {name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
  }
  async function seal(k, obj){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, k, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return b64(out);
  }
  async function unseal(k, s){
    const u = unb64(s);
    return JSON.parse(td.decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: u.slice(0, 12)}, k, u.slice(12))));
  }
  // the key stays on this phone (like the access code), so the passphrase is asked once per phone
  async function keepKey(k, salt){
    key = k; keySalt = salt;
    store.set(LS.key, {salt, raw: b64(await crypto.subtle.exportKey("raw", k))});
  }
  async function loadKey(){
    const st = store.get(LS.key, null), blob = app.pmeds;
    if (!st || !blob || st.salt !== blob.salt){ key = null; keySalt = ""; return; }   // another phone started over
    if (key && keySalt === st.salt) return;
    key = await crypto.subtle.importKey("raw", unb64(st.raw), "AES-GCM", true, ["encrypt", "decrypt"]);
    keySalt = st.salt;
  }
  function forgetKey(){ key = null; keySalt = ""; shared = []; openedFor = ""; store.set(LS.key, null); }
  async function openShared(){              // decrypts the shared reminders when the blob or the key changed
    const blob = app.pmeds;
    await loadKey();
    if (!blob || !key){ shared = []; openedFor = ""; return; }
    const sig = JSON.stringify(blob) + keySalt;
    if (sig === openedFor) return;
    const out = [];
    for (const it of blob.items || []){
      try { out.push(Object.assign(await unseal(key, it.enc), {id: it.id, shared: true})); } catch(e) {}
    }
    shared = out; openedFor = sig;
  }
  const refresh = () => { const was = openedFor; return openShared().then(() => { if (openedFor !== was){ app.render(); app.renderSettings(); } }).catch(() => {}); };

  /* ---------- schedule (same rules as the children's reminders) ---------- */
  const today = () => app.dayKey(Date.now());
  const all = () => local.concat(shared);
  const locked = () => !key && app.pmeds && (app.pmeds.items || []).length ? app.pmeds.items.length : 0;
  // doses: kept on this phone, or `pmed` entries for shared reminders (both, if a reminder moved)
  const given = m => localGiven.filter(g => g.ref === m.id).concat(app.events.filter(e => e.kind === "pmed" && e.ref === m.id));
  const givenOn = (m, k) => given(m).filter(e => app.dayKey(e.ts) === k).sort((a, b) => a.ts - b.ts);
  const lastGiven = m => given(m).filter(e => e.ts <= Date.now()).reduce((a, e) => Math.max(a, e.ts), 0);
  const nextDose = m => { const l = lastGiven(m); return Number(m.every) > 0 && l ? l + Number(m.every)*H : null; };
  const shows = (m, k) => givenOn(m, k).length || (k >= (m.from || "") && (!m.until || k <= m.until));
  function late(m, k = today()){
    if (k !== today() || !shows(m, k) || (m.until && k > m.until)) return false;
    if (Number(m.every) > 0){ const n = nextDose(m); return !!n && Date.now() >= n; }
    return new Date().getHours() >= Number(m.due || 0) && givenOn(m, k).length < Number(m.times || 1);
  }
  function nextTxt(m){
    const n = nextDose(m); if (!n) return Number(m.every) > 0 ? "first dose any time" : "";
    const when = app.dayKey(n) === today() ? app.hm(n) : (app.dayKey(n) === app.dayKey(Date.now() + 864e5) ? "tomorrow " : app.fmtDate(n) + " ") + app.hm(n);
    return Date.now() >= n ? `due at ${app.hm(n)}` : `next ${when} (in ${app.inTxt(n - Date.now())})`;
  }
  // one text node per part, so that each part is translated on its own
  const parts = list => list.filter(Boolean).map(x => `<span>${x}</span>`).join("<span> · </span>");
  const schedParts = m => (Number(m.every) > 0 ? [`every ${m.every} h`, m.times ? `${m.times}× a day` : ""] : [`${m.times}× a day`, `remind after ${String(m.due).padStart(2, "0")}:00`])
    .concat(m.until ? [`until ${app.fmtDate(new Date(m.until + "T12:00").getTime())}`] : [])
    .concat(Number(m.notify) < 0 ? ["no notifications"] : Number(m.notify) > 0 ? [`notify every ${m.notify} min`] : [])
    .concat(m.night && Number(m.notify) >= 0 ? ["also at night"] : []);

  /* ---------- giving a dose ---------- */
  async function give(m){
    const ts = Date.now(), k = today(), g = givenOn(m, k), n = Number(m.times || 1), nd = nextDose(m);
    if (Number(m.every) > 0 && nd && ts < nd - 30*60000){
      if (!confirm(`Next dose of ${m.name} is at ${app.hm(nd)}. Log a dose now anyway?`)) return;
    } else if (g.length >= n){
      if (confirm(`${m.name} already given today. Undo the last one?`)) removeDose(g[g.length - 1]);
      return;
    }
    if (m.shared){
      const ids = await app.addEvents([{kind: "pmed", child: "parent", ts, ref: m.id}]);
      app.toast(`${m.name} · ${app.hm(ts)}`, () => app.delEvents(ids));
    } else {
      const d = {id: "g" + app.uid().replace(/-/g, "").slice(0, 10), ref: m.id, ts};
      localGiven.push(d); saveLocal(); app.render();
      app.toast(`${m.name} · ${app.hm(ts)}`, () => removeDose(d));
    }
  }
  function removeDose(d){
    if (localGiven.some(g => g.id === d.id)){ localGiven = localGiven.filter(g => g.id !== d.id); saveLocal(); app.render(); }
    else app.delEvents([d.id]);
  }

  /* ---------- Day: one card per reminder, like a child's, with "For you" as its owner ---------- */
  function dayHtml(k, isToday){
    const list = all().filter(m => shows(m, k));
    const lk = isToday ? locked() : 0;
    const card = m => {
      const g = givenOn(m, k), n = Number(m.times || 1), done = g.length >= n, lt = late(m, k);
      const sub = parts(["For you", m.dose ? app.esc(m.dose) : "", isToday && Number(m.every) > 0 ? nextTxt(m) : (!g.length && lt ? "due now" : "")]);
      return `<div class="remw${lt ? " late" : ""}" style="--c:var(--parent)"><button class="remi${done ? " done" : ""}${lt ? " late" : ""}" data-pmgive="${app.esc(m.id)}" ${isToday ? "" : "disabled"}>
        <span class="rck">${done ? "✓" : g.length ? g.length + "/" + n : "○"}</span><span><b>${app.esc(m.name)}</b><small>${sub}</small></span></button>
        ${g.length ? `<div class="remg">${g.map(e => `<button data-pmdose="${app.esc(e.id)}" aria-label="Edit the dose of ${app.esc(m.name)} at ${app.hm(e.ts)}">${app.hm(e.ts)}</button>`).join("")}</div>` : ""}</div>`;
    };
    return list.map(card).join("")
      + (lk ? `<div class="remw pmlock" style="--c:var(--parent)"><span>🔒 <span>Shared reminders locked on this phone (${lk})</span></span><button class="btn ghost" data-pmunlock>Unlock</button></div>` : "");
  }
  function bindDay(root){
    root.querySelectorAll("[data-pmgive]").forEach(b => b.onclick = () => { const m = all().find(x => x.id === b.dataset.pmgive); if (m) give(m); });
    root.querySelectorAll("[data-pmdose]").forEach(b => b.onclick = () => editDose(b.dataset.pmdose));
    root.querySelectorAll("[data-pmunlock]").forEach(b => b.onclick = () => askPass());
  }

  /* ---------- Settings ---------- */
  function settingsHtml(){
    const st = app.isLocal() ? "Shared reminders need a shared log." : !app.pmeds ? "Family passphrase: not set." : key ? "Family passphrase: unlocked on this phone." : "Family passphrase: locked on this phone.";
    const lk = locked();
    return `<div class="sect">${app.sh("Parents' reminders", "pmeds", all().length ? "Your own reminders, e.g. medicines or supplements. They appear in Day under “For you”; doses are not checked by the app." : "",
        "Reminders kept on this phone only never leave it. Shared reminders are encrypted on the phone with the family passphrase: the server stores only unreadable text.")}
      ${all().length ? `<ul class="kids">${all().map(m => `<li><i class="sw" style="--c:var(--parent)"></i><span><b>${app.esc(m.name)}</b><small>${parts([m.shared ? "Shared, encrypted" : "This phone only", m.dose ? app.esc(m.dose) : ""].concat(schedParts(m)))}</small></span><button class="linkbtn" data-pmedit="${app.esc(m.id)}">Edit</button></li>`).join("")}</ul>`
        : `<p class="note" style="margin:0">Your own reminders, e.g. medicines or supplements. They appear in Day under “For you”; doses are not checked by the app.</p>`}
      ${lk ? `<p class="note" style="margin:0">Shared reminders locked on this phone (${lk})</p>` : ""}
      <button class="btn ghost wide" id="pmAdd">＋ Add reminder for you</button>
      <p class="row2" style="margin:4px 0 0">${st}</p>
      ${app.isLocal() ? "" : !app.pmeds ? `<button class="btn ghost wide" data-pmunlock>Set passphrase</button>`
        : key ? `<button class="btn ghost wide" id="pmLock">Lock on this phone</button>` : `<button class="btn ghost wide" data-pmunlock>Unlock</button>`}</div>`;
  }
  function bindSettings(root){
    if (root.querySelector("#pmAdd")) root.querySelector("#pmAdd").onclick = () => openEdit(null);
    root.querySelectorAll("[data-pmedit]").forEach(b => b.onclick = () => openEdit(b.dataset.pmedit));
    root.querySelectorAll("[data-pmunlock]").forEach(b => b.onclick = () => askPass());
    const lb = root.querySelector("#pmLock");
    if (lb) lb.onclick = () => { if (confirm("Lock shared reminders on this phone? The passphrase will be needed to see them again.")){ forgetKey(); app.render(); app.renderSettings(); } };
  }

  /* ---------- dialogs ---------- */
  document.head.insertAdjacentHTML("beforeend", `<style>
.remw.pmlock{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 12px;font-size:.85rem;color:var(--muted)}
.remw.pmlock .btn{min-height:36px;padding:4px 12px;font-size:.85rem;flex:none}
</style>`);
  document.body.insertAdjacentHTML("beforeend", `
<dialog id="pmDlg" tabindex="-1"><form class="dlg" id="pmForm" novalidate>
  <h2 id="pmTitle">New reminder for you</h2>
  <label>What<input id="pmName" maxlength="40" placeholder="e.g. Iron"></label>
  <label>Dose (optional)<input id="pmDose" maxlength="40" placeholder="e.g. 4 drops"></label>
  <div class="seg" id="pmMode"><button type="button" data-v="day">Times a day</button><button type="button" data-v="every">Every few hours</button></div>
  <div class="two" id="pmDayWrap"><label>Times a day<input type="number" id="pmTimes" inputmode="numeric" min="1" max="6"></label>
  <label>Remind after<select id="pmDue">${Array.from({length: 24}, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label></div>
  <div class="two" id="pmEveryWrap"><label>Every (hours)<input type="number" id="pmEvery" inputmode="decimal" min="1" max="48" step="0.5" placeholder="8"></label>
  <label>Doses a day<input type="number" id="pmTimesE" inputmode="numeric" min="1" max="12" placeholder="3"></label></div>
  <label>Until (optional)<input type="date" id="pmUntil"></label>
  <label>Notifications<select id="pmNotify"><option value="0">Once</option><option value="-1">No notification</option><option value="15">Every 15 min until taken</option><option value="30">Every 30 min until taken</option><option value="60">Every hour until taken</option></select></label>
  <label class="chk" id="pmNightWrap"><input type="checkbox" id="pmNight"> Also at night</label>
  <div class="lblc"><span>Kept</span><div class="seg" id="pmWhere"><button type="button" data-v="local">This phone only</button><button type="button" data-v="shared">Shared, encrypted</button></div></div>
  <p class="note" id="pmWhereNote" style="margin:-4px 0 0"></p>
  <div class="row"><button type="button" class="btn del" id="pmDel">Delete</button><button type="button" class="btn ghost" id="pmCancel">Close</button><button type="submit" class="btn">Save</button></div>
</form></dialog>
<dialog id="pdDlg" tabindex="-1"><form class="dlg" id="pdForm" novalidate>
  <h2 id="pdTitle">Dose taken</h2>
  <label>When<input type="datetime-local" id="pdTs"></label>
  <button type="button" class="linkbtn" id="pdRem" style="align-self:flex-start;padding-left:0">Edit reminder</button>
  <div class="row"><button type="button" class="btn del" id="pdDel">Delete</button><button type="button" class="btn ghost" id="pdCancel">Close</button><button type="submit" class="btn">Save</button></div>
</form></dialog>
<dialog id="ppDlg" tabindex="-1"><form class="dlg" id="ppForm" novalidate>
  <h2>Family passphrase</h2>
  <p class="note" id="ppIntro" style="margin:0"></p>
  <label>Passphrase<input type="password" id="ppIn" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
  <label id="ppRepWrap">Repeat the passphrase<input type="password" id="ppRep" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
  <p class="note" id="ppWarn" style="margin:0;color:var(--danger)">It cannot be recovered: if it is forgotten, the shared reminders are lost.</p>
  <p class="note" id="ppErr" style="margin:0;color:var(--danger)" hidden></p>
  <div class="row"><button type="button" class="btn del" id="ppReset">Forgot it? Start over</button><button type="button" class="btn ghost" id="ppCancel">Close</button><button type="submit" class="btn" id="ppOk">Unlock</button></div>
</form></dialog>`);
  const $ = s => document.querySelector(s);
  const seg = (sel, v) => document.querySelectorAll(sel + " button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
  const segV = sel => { const b = document.querySelector(sel + ' button[aria-pressed="true"]'); return b ? b.dataset.v : ""; };
  $("#pmNotify").onchange = () => { $("#pmNightWrap").hidden = Number($("#pmNotify").value) < 0; };
  const setMode = v => { seg("#pmMode", v); $("#pmDayWrap").hidden = v !== "day"; $("#pmEveryWrap").hidden = v !== "every"; };
  const setWhere = v => { seg("#pmWhere", v); $("#pmWhereNote").textContent = v === "shared" ? "It cannot be recovered: if it is forgotten, the shared reminders are lost." : ""; };
  document.querySelectorAll("#pmMode button").forEach(b => b.onclick = () => setMode(b.dataset.v));
  document.querySelectorAll("#pmWhere button").forEach(b => b.onclick = () => setWhere(b.dataset.v));
  $("#pmCancel").onclick = () => $("#pmDlg").close();
  $("#ppCancel").onclick = () => $("#ppDlg").close();

  // a dose already taken: change its time, delete it, or edit the reminder (as for the children's doses)
  const pad = n => String(n).padStart(2, "0");
  const toInput = ts => { const d = new Date(ts); return `${app.dayKey(ts)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  let doseEditing = null;
  function editDose(id){
    const d = all().flatMap(given).find(x => x.id === id); if (!d) return;
    const m = all().find(x => x.id === d.ref);
    doseEditing = d;
    $("#pdTitle").textContent = m ? m.name : "Dose taken";
    $("#pdTs").value = toInput(d.ts); $("#pdTs").classList.remove("invalid");
    $("#pdRem").hidden = !m; $("#pdRem").onclick = () => { $("#pdDlg").close(); openEdit(m.id); };
    $("#pdDlg").showModal();
  }
  $("#pdCancel").onclick = () => $("#pdDlg").close();
  $("#pdDel").onclick = () => { if (doseEditing) removeDose(doseEditing); $("#pdDlg").close(); };
  $("#pdForm").onsubmit = e => {
    e.preventDefault();
    const d = doseEditing, ts = new Date($("#pdTs").value).getTime();
    if (!d || !(ts > 0)){ $("#pdTs").classList.add("invalid"); return; }
    if (ts > Date.now() + 5*60000 && !confirm(`This time is in the future (${app.fmtDate(ts)} ${app.hm(ts)}). Save anyway?`)) return;
    $("#pdDlg").close();
    const l = localGiven.find(g => g.id === d.id);
    if (l){ l.ts = ts; saveLocal(); app.render(); }
    else { const {id, ...ev} = d; app.setEvent(id, {...ev, ts}); }
  };

  let editing = null;
  function openEdit(id){
    editing = id;
    const m = all().find(x => x.id === id) || {name: "", dose: "", times: 1, due: 9};
    $("#pmName").value = m.name; $("#pmDose").value = m.dose || ""; $("#pmTimes").value = m.times || 1; $("#pmDue").value = m.due ?? 9;
    $("#pmEvery").value = m.every || ""; $("#pmTimesE").value = Number(m.every) > 0 ? (m.times || "") : ""; $("#pmUntil").value = m.until || ""; $("#pmNotify").value = String(Number(m.notify) || 0); $("#pmNight").checked = !!m.night; $("#pmNightWrap").hidden = Number(m.notify) < 0;
    setMode(Number(m.every) > 0 ? "every" : "day");
    setWhere(m.shared ? "shared" : "local");
    $("#pmWhere").hidden = app.isLocal();                 // sharing needs a shared log
    $("#pmTitle").textContent = id ? "Edit reminder for you" : "New reminder for you";
    $("#pmDel").hidden = !id;
    $("#pmDlg").showModal();
  }
  $("#pmDel").onclick = async () => {
    const m = all().find(x => x.id === editing); if (!m || !confirm("Delete this reminder?")) return;
    $("#pmDlg").close();
    if (m.shared) await saveShared(null, m.id); else { local = local.filter(x => x.id !== m.id); saveLocal(); }
    app.render(); app.renderSettings();
  };
  $("#pmForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("#pmName").value.trim().slice(0, 40);
    if (!name){ $("#pmName").focus(); return; }
    const mode = segV("#pmMode"), ev = parseFloat(String($("#pmEvery").value).replace(",", "."));
    if (mode === "every" && !(ev > 0)){ $("#pmEvery").focus(); return; }
    const every = mode === "every" ? Math.max(1, Math.min(48, ev)) : 0;
    const prev = all().find(x => x.id === editing);
    const m = {id: prev ? prev.id : "p" + app.uid().replace(/-/g, "").slice(0, 10), name, dose: $("#pmDose").value.trim().slice(0, 40),
      times: every ? Math.max(1, Math.min(12, parseInt($("#pmTimesE").value, 10) || Math.round(24/every))) : Math.max(1, Math.min(6, parseInt($("#pmTimes").value, 10) || 1)),
      due: every ? 0 : Number($("#pmDue").value), every, until: $("#pmUntil").value || "", notify: Number($("#pmNotify").value) || 0, night: $("#pmNight").checked && Number($("#pmNotify").value) >= 0, from: prev ? (prev.from || today()) : today()};
    const toShared = !app.isLocal() && segV("#pmWhere") === "shared";
    if (toShared && !key){ if (!await askPass()) return; }
    $("#pmDlg").close();
    if (toShared){
      if (!await saveShared(m)) return;
      if (prev && !prev.shared){ local = local.filter(x => x.id !== m.id); saveLocal(); }   // moved to shared
    } else {
      if (prev && prev.shared && !await saveShared(null, prev.id)) return;                 // moved to this phone
      local = local.filter(x => x.id !== m.id).concat([m]); saveLocal();
    }
    app.render(); app.renderSettings();
  };

  // writes one shared reminder (m) or removes one (delId); the other items are kept as they are on the server
  async function saveShared(m, delId){
    const blob = app.pmeds; if (!blob || !key) return false;
    let items = (blob.items || []).filter(x => x.id !== (m ? m.id : delId));
    if (m){ const {id, shared: _s, ...data} = m; items = items.concat([{id, enc: await seal(key, data)}]); }
    try {
      const r = await app.run("savePMeds", {pmeds: {salt: blob.salt, check: blob.check, items}});
      app.setPmeds(r.pmeds); await openShared(); return true;
    } catch(err) {
      app.toast(err instanceof app.NetError ? "Shared reminders need a connection" : "Not saved");
      return false;
    }
  }

  // passphrase dialog: set it (no shared reminders yet, or starting over) or unlock this phone
  function askPass(reset){
    return new Promise(res => {
      const create = reset || !app.pmeds;
      $("#ppIntro").textContent = create ? "Choose a passphrase to share reminders with the other parent, encrypted. Tell it in person, not in a chat." : "Enter the family passphrase to see the shared reminders on this phone.";
      $("#ppRepWrap").hidden = !create; $("#ppWarn").hidden = !create; $("#ppReset").hidden = create;
      $("#ppOk").textContent = create ? "Set passphrase" : "Unlock";
      $("#ppIn").value = ""; $("#ppRep").value = ""; $("#ppErr").hidden = true;
      $("#ppIn").autocomplete = create ? "new-password" : "current-password";
      const err = t => { $("#ppErr").textContent = t; $("#ppErr").hidden = false; };
      let done = false; const finish = v => { if (!done){ done = true; res(v); } };
      $("#ppDlg").onclose = () => finish(false);
      $("#ppReset").onclick = () => {
        if (!confirm("Remove all shared reminders and choose a new passphrase? Reminders kept on this phone only are not affected.")) return;
        $("#ppDlg").onclose = null; $("#ppDlg").close(); askPass(true).then(finish);
      };
      $("#ppForm").onsubmit = async e => {
        e.preventDefault();
        const pass = $("#ppIn").value;
        if (pass.length < 8) return err("At least 8 characters");
        if (create && pass !== $("#ppRep").value) return err("The two passphrases are different");
        $("#ppOk").disabled = true; $("#ppOk").textContent = "Checking…";
        try {
          if (create){
            const salt = crypto.getRandomValues(new Uint8Array(16)), k = await derive(pass, salt);
            const r = await app.run("savePMeds", {pmeds: {salt: b64(salt), check: await seal(k, {check: CHECK}), items: []}});
            app.setPmeds(r.pmeds); await keepKey(k, r.pmeds.salt);
          } else {
            const blob = app.pmeds, k = await derive(pass, unb64(blob.salt));
            let ok = false; try { ok = (await unseal(k, blob.check)).check === CHECK; } catch(x) {}
            if (!ok){ err("Wrong passphrase"); return; }
            await keepKey(k, blob.salt);
          }
          openedFor = ""; await openShared();
          $("#ppDlg").onclose = null; $("#ppDlg").close(); finish(true);
          app.render(); app.renderSettings();
        } catch(x) {
          err(x instanceof app.NetError ? "Shared reminders need a connection" : "Not saved");
        } finally { $("#ppOk").disabled = false; $("#ppOk").textContent = create ? "Set passphrase" : "Unlock"; }
      };
      $("#ppDlg").showModal();
    });
  }

  refresh();
  return {
    dayHtml, bindDay, settingsHtml, bindSettings,
    due: () => all().filter(m => late(m)).length,
    // frequency chosen in each reminder: -1 none, 0 once, N every N min until taken
    notices: () => all().filter(m => late(m) && Number(m.notify) >= 0).map(m => ({key: "pmed:" + m.id + ":" + (Number(m.every) > 0 ? nextDose(m) : today() + ":" + givenOn(m, today()).length),
      repeat: Number(m.notify) || 0, night: !!m.night, text: app.tr(`${m.name} (for you): due now`)})),
    synced: refresh
  };
}
