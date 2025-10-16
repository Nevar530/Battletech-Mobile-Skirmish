/* ===== MSS:84 SHEET MODULE (self-contained UI) =====
   This module owns the entire Sheet UI (HTML + CSS + JS behaviors).
   It hydrates static mech data via MSS84_COMPILER, and persists ONLY user inputs.

   Public API:
     MSS84_SHEET.mount()
     MSS84_SHEET.open()
     MSS84_SHEET.close()
     MSS84_SHEET.setIds(mapId, tokenId)
     MSS84_SHEET.setMechRef(pathOrKey)
     MSS84_SHEET.refresh()
     MSS84_SHEET.getUserState()
     MSS84_SHEET.setUserState(obj)
     MSS84_SHEET.resetUserState()

   Expectations:
     - window.MSS84_COMPILER provides resolveForToken(mapId, tokenId) & resolveFromRef(ref)
     - The rest of the app opens/closes this panel or dbl-clicks tokens and calls setIds()+open()

   Design notes:
     - Tabs: Overview, Armor, Heat, Weapons, Equipment, Notes
     - Heat shows ONLY current effect; armor shows Max vs Current + Apply Max Armor
     - Weapons: 4 melee rows (Punch/Kick/Charge/DFA) injected from tonnage; ranged weapons from compiler
       (no add UI; per-weapon Enabled checkbox, optional Ammo input)
     - Equipment: display-only by location; optional disabled/destroyed state stored in user eqDisabled map
*/

(() => {
  const API = {};
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = (x) => (x == null ? "—" : String(x));
  const asNum = (v, d=0) => (Number.isFinite(+v) ? +v : d);

  let MAP_ID = null;
  let TOKEN_ID = null;
  let HOST = null;
  let STATIC = null;  // normalized mech from compiler
  let USER  = null;   // per-token user inputs
  let SAVE_TIMER = null;
  const SAVE_DEBOUNCE = 500;

  const CSS = `
/* ===== SHEET UI (scoped) ===== */
#mss84-sheet-root{ position:fixed; right:14px; top:14px; width:860px; max-height:92vh;
  background:#0d0d10; color:#e8e8ea; border:1px solid #22242a; border-radius:14px;
  box-shadow:0 10px 24px rgba(0,0,0,.5); display:none; z-index:9999; overflow:hidden; }
#mss84-sheet-root .hdr{ display:flex; align-items:center; justify-content:space-between;
  padding:10px 12px; border-bottom:1px solid #1d1f25; background:#101118; }
#mss84-sheet-root .hdr .title{ font:700 16px/1.2 system-ui,Segoe UI,Roboto; letter-spacing:.25px; }
#mss84-sheet-root .hdr .actions button{ margin-left:8px; padding:6px 10px; border-radius:8px;
  background:#1b1e27; color:#e8e8ea; border:1px solid #2a2f3a; cursor:pointer; }
#mss84-sheet-root .hdr .actions button:hover{ background:#212532; }
#mss84-sheet-root .tabs{ display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid #1d1f25; background:#0f1016; }
#mss84-sheet-root .tabs button{ flex:0 0 auto; padding:6px 10px; border-radius:22px; border:1px solid #2a2f3a;
  background:#12131a; color:#cfd2d9; cursor:pointer; font:600 12px/1 system-ui; letter-spacing:.2px; }
#mss84-sheet-root .tabs button.active{ background:#2a3244; color:#fff; border-color:#39445c; }
#mss84-sheet-root .body{ padding:12px; overflow:auto; max-height: calc(92vh - 96px); }

/* Overview grid */
.mss84-overview{ display:grid; grid-template-columns: 1.2fr 1fr; gap:12px; }
.mss84-card{ border:1px solid #232630; border-radius:12px; padding:10px; background:#10121a; }
.mss84-card h4{ margin:0 0 8px; font:700 13px/1.2 system-ui; color:#eaeef9; }
.mss84-fields{ display:grid; grid-template-columns: 140px 1fr; gap:6px 8px; font-size:13px; }
.mss84-fields label{ color:#9aa3b2; }
.mss84-fields .v{ color:#e8e8ea; }

/* Armor grid */
.mss84-armor{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; }
.mss84-loc{ border:1px solid #232630; border-radius:10px; background:#0f1118; padding:8px; }
.mss84-loc .name{ font:700 12px/1.1 system-ui; color:#dfe5f6; margin-bottom:6px; }
.mss84-loc .row{ display:flex; align-items:center; gap:8px; margin:4px 0; font-size:12px; }
.mss84-loc input[type=number]{ width:5em; background:#0f1116; color:#e8e8ea; border:1px solid #2a2f3a; border-radius:6px; padding:2px 6px; }

/* Heat */
.mss84-heat-bar{ height:14px; background:#181a22; border:1px solid #232630; border-radius:8px; overflow:hidden; position:relative; }
.mss84-heat-fill{ height:100%; width:0%; background:linear-gradient(90deg,#2aaef5,#f5a623,#ff4861); transition:width .25s ease; }
.mss84-heat-row{ display:flex; align-items:center; gap:10px; }

/* Weapons */
.mss84-table{ width:100%; border-collapse:collapse; font-size:13px; }
.mss84-table th,.mss84-table td{ border:1px solid #232630; padding:6px 8px; }
.mss84-table th{ background:#141723; color:#dfe5f6; text-align:left; }
.mss84-table td input[type=number]{ width:4.5em; background:#0f1116; color:#e8e8ea; border:1px solid #2a2f3a; border-radius:6px; padding:2px 6px; }
.tr-dim{ opacity:.55; }

/* Equipment */
.mss84-eq{ display:grid; grid-template-columns: repeat(8, 46px 1fr); gap:6px; font-size:12px; }
.mss84-eq .h{ color:#9aa3b2; }
.mss84-eq .num{ color:#7d8596; }
.mss84-eq .val span{ display:inline-block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
`;

  const HTML = `
<div id="mss84-sheet-root" role="dialog" aria-label="Mech Sheet">
  <div class="hdr">
    <div class="title">Mech Sheet</div>
    <div class="actions">
      <button id="mss84-armor-max" title="Apply Max Armor">Apply Max Armor</button>
      <button id="mss84-close" title="Close">Close</button>
    </div>
  </div>

  <div class="tabs">
    <button data-tab="overview" class="active">Overview</button>
    <button data-tab="armor">Armor</button>
    <button data-tab="heat">Heat</button>
    <button data-tab="weapons">Weapons</button>
    <button data-tab="equipment">Equipment</button>
    <button data-tab="notes">Notes</button>
  </div>

  <div class="body">
    <!-- Overview -->
    <section data-page="overview">
      <div class="mss84-overview">
        <div class="mss84-card">
          <h4>Mech</h4>
          <div class="mss84-fields">
            <label>Chassis</label><div class="v" id="mechChassis">—</div>
            <label>Variant</label><div class="v" id="mechVariant">—</div>
            <label>Tech Base</label><div class="v" id="mechTech">—</div>
            <label>Tonnage</label><div class="v" id="mechTonnage">—</div>
            <label>BV</label><div class="v" id="mechBV">—</div>
            <label>Move W/R/J</label><div class="v" id="mechMove">—</div>
          </div>
        </div>
        <div class="mss84-card">
          <h4>Pilot</h4>
          <div class="mss84-fields">
            <label>Name</label><div><input id="pilotName" placeholder="Name"/></div>
            <label>Callsign</label><div><input id="pilotCallsign" placeholder="Callsign"/></div>
            <label>Gunnery</label><div><input id="pilotGunnery" type="number" min="0" max="12" /></div>
            <label>Piloting</label><div><input id="pilotPiloting" type="number" min="0" max="12" /></div>
            <label>Hits</label><div><input id="pilotHits" type="number" min="0" max="6"/></div>
            <label>KO &num;</label><div><input id="pilotKO" type="number" min="0" max="12"/></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Armor -->
    <section data-page="armor" hidden>
      <div class="mss84-armor">
        ${["LA","HD","CT","RA","LL","LT","RT","RL"].map(code => `
        <div class="mss84-loc loc" data-code="${code}">
          <div class="name">${code}</div>
          <div class="row">Max Front: <span class="armorMaxF">0</span>${["LT","CT","RT"].includes(code)?` &nbsp;/&nbsp; Max Rear: <span class="armorMaxR">0</span>`:""}</div>
          <div class="row">Current: <input class="armorCurF" type="number" min="0" step="1"/>${["LT","CT","RT"].includes(code)?` &nbsp;/&nbsp; Rear: <input class="armorCurR" type="number" min="0" step="1"/>`:""}</div>
          <div class="row">Internals: <span class="internals">0</span></div>
        </div>
        `).join("")}
      </div>
    </section>

    <!-- Heat -->
    <section data-page="heat" hidden>
      <div class="mss84-card">
        <h4>Heat</h4>
        <div class="mss84-heat-row" style="margin-bottom:8px">
          <label>Current Heat</label>
          <input id="heatCurrent" type="number" min="-10" max="100" style="width:5em"/>
          <div><b>Effect:</b> <span id="heatEffectNow">—</span></div>
        </div>
        <div class="mss84-heat-bar"><div class="mss84-heat-fill" id="heatFill"></div></div>
        <div style="font-size:12px;opacity:.8;margin-top:6px">Only the current effect is shown; history/log is not kept.</div>
      </div>
    </section>

    <!-- Weapons -->
    <section data-page="weapons" hidden>
      <div class="mss84-card">
        <h4>Weapons</h4>
        <table class="mss84-table">
          <thead><tr>
            <th>Name</th><th>Type</th><th>Dmg</th><th>Heat</th>
            <th>Min</th><th>Short</th><th>Med</th><th>Long</th>
            <th>Ammo</th><th>On</th>
          </tr></thead>
          <tbody id="weapRows"></tbody>
        </table>
        <div style="font-size:12px;opacity:.8;margin-top:6px">
          Melee (Punch/Kick/Charge/DFA) auto-added from tonnage. Movement/tiles modifiers are applied manually by players.
        </div>
      </div>
    </section>

    <!-- Equipment -->
    <section data-page="equipment" hidden>
      <div class="mss84-card">
        <h4>Equipment by Location</h4>
        <div class="mss84-eq" id="equipRows">
          <div class="h">LA</div><div class="h">Name</div>
          <div class="h">LL</div><div class="h">Name</div>
          <div class="h">LT</div><div class="h">Name</div>
          <div class="h">CT</div><div class="h">Name</div>
          <div class="h">HD</div><div class="h">Name</div>
          <div class="h">RT</div><div class="h">Name</div>
          <div class="h">RL</div><div class="h">Name</div>
          <div class="h">RA</div><div class="h">Name</div>
        </div>
      </div>
    </section>

    <!-- Notes -->
    <section data-page="notes" hidden>
      <div class="mss84-card">
        <h4>Notes</h4>
        <textarea id="sheetNotes" rows="8" style="width:100%; background:#0f1116; color:#e8e8ea; border:1px solid #2a2f3a; border-radius:8px; padding:8px;"></textarea>
      </div>
    </section>
  </div>
</div>
`;

  function injectUI() {
    if ($("#mss84-sheet-root")) return;
    const style = document.createElement("style");
    style.id = "mss84-sheet-css";
    style.textContent = CSS;
    document.head.appendChild(style);
    const wrap = document.createElement("div");
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap.firstElementChild);

    // Tabs
    $$(".tabs button", $("#mss84-sheet-root")).forEach(b => {
      b.addEventListener("click", () => {
        $$(".tabs button").forEach(x => x.classList.toggle("active", x === b));
        const target = b.dataset.tab;
        $$(".body [data-page]").forEach(sec => sec.hidden = (sec.dataset.page !== target));
      });
    });

    // Close
    $("#mss84-close").addEventListener("click", () => API.close());
    $("#mss84-armor-max").addEventListener("click", onApplyMaxArmor);

    // Input delegation
    $("#mss84-sheet-root").addEventListener("input", onAnyInput, { capture:true });
  }

  function showUI(show=true) { $("#mss84-sheet-root").style.display = show ? "block" : "none"; }

  // ---------- Persistence ----------
  function lsUserKey() { return `mss84:sheet:user:${MAP_ID}:${TOKEN_ID}`; }
  function haveIds() { return MAP_ID != null && TOKEN_ID != null; }
  function defaultUserState() {
    return {
      pilotName:"", pilotCallsign:"",
      pilotGunnery:null, pilotPiloting:null, pilotHits:0, pilotKO:null,
      heatCurrent:0,
      armorCur: { HD:{f:0}, CT:{f:0,r:0}, RT:{f:0,r:0}, LT:{f:0,r:0}, RA:{f:0}, LA:{f:0}, RL:{f:0}, LL:{f:0} },
      notes:"",
      weap: {},       // per-row index: { enabled, ammo }
      eqDisabled: {}, // optional: "LT:05": true
    };
  }
  function loadUserState() {
    if (!haveIds()) return (USER = defaultUserState());
    try {
      const raw = localStorage.getItem(lsUserKey());
      USER = raw ? JSON.parse(raw) : defaultUserState();
    } catch { USER = defaultUserState(); }
    return USER;
  }
  function saveUserStateSoon() {
    if (!haveIds()) return;
    if (SAVE_TIMER) clearTimeout(SAVE_TIMER);
    SAVE_TIMER = setTimeout(() => {
      try { localStorage.setItem(lsUserKey(), JSON.stringify(USER || {})); }
      catch (e) { console.warn("[MSS84_SHEET] save failed", e); }
    }, SAVE_DEBOUNCE);
  }

  // ---------- Input handling ----------
  function onAnyInput(e) {
    const t = e.target;
    if (!t) return;
    if (!USER) USER = defaultUserState();

    if (t.id === "pilotName")     USER.pilotName = t.value;
    if (t.id === "pilotCallsign") USER.pilotCallsign = t.value;
    if (t.id === "pilotGunnery")  USER.pilotGunnery = asNum(t.value, null);
    if (t.id === "pilotPiloting") USER.pilotPiloting = asNum(t.value, null);
    if (t.id === "pilotHits")     USER.pilotHits = asNum(t.value, 0);
    if (t.id === "pilotKO")       USER.pilotKO = asNum(t.value, null);
    if (t.id === "sheetNotes")    USER.notes = t.value;
    if (t.id === "heatCurrent")   { USER.heatCurrent = asNum(t.value, 0); renderHeatEffect(); }

    const loc = t.closest?.(".loc");
    if (loc && loc.dataset.code) {
      const code = loc.dataset.code;
      const f = loc.querySelector(".armorCurF");
      const r = loc.querySelector(".armorCurR");
      if (!USER.armorCur[code]) USER.armorCur[code] = { f:0, r:0 };
      if (f && t === f) USER.armorCur[code].f = asNum(f.value, 0);
      if (r && t === r) USER.armorCur[code].r = asNum(r.value, 0);
    }

    if (t.matches?.(".weapEnabled")) {
      const idx = +t.dataset.idx;
      USER.weap[idx] = USER.weap[idx] || {};
      USER.weap[idx].enabled = !!t.checked;
      // dim row
      const tr = t.closest("tr"); if (tr) tr.classList.toggle("tr-dim", !t.checked);
    }
    if (t.matches?.(".weapAmmo")) {
      const idx = +t.dataset.idx;
      USER.weap[idx] = USER.weap[idx] || {};
      USER.weap[idx].ammo = (t.value === "" ? null : asNum(t.value, null));
    }

    saveUserStateSoon();
  }

  // ---------- Heat ----------
  function renderHeatEffect() {
    const el = $("#heatEffectNow");
    const fill = $("#heatFill");
    const h  = USER?.heatCurrent ?? 0;
    const HEAT = [
      [30, "Shutdown"],
      [28, "Ammo explosion: avoid on 8+"],
      [26, "Shutdown: avoid on 10+"],
      [25, "-5 MP"],
      [24, "+4 to fire"],
      [23, "Ammo explosion: avoid on 6+"],
      [22, "Shutdown: avoid on 8+"],
      [20, "-4 MP"],
      [19, "Ammo explosion: avoid on 4+"],
      [18, "Shutdown: avoid on 6+"],
      [15, "+3 to fire"],
      [14, "-3 MP"],
      [12, "+2 to fire"],
      [10, "-2 MP"],
      [8,  "+1 to fire"],
    ];
    let effect = "—";
    for (const [th, txt] of HEAT) if (h >= th) { effect = txt; break; }
    if (el) el.textContent = effect;
    if (fill) {
      const pct = Math.max(0, Math.min(100, (h/30)*100));
      fill.style.width = pct + "%";
    }
  }

  // ---------- Render statics ----------
  function renderStatics(vm) {
    STATIC = vm;

    $("#mechChassis").textContent = esc(vm.name);
    $("#mechVariant").textContent = esc(vm.variant);
    $("#mechTech").textContent    = esc(vm.techBase);
    $("#mechTonnage").textContent = esc(vm.tonnage);
    $("#mechBV").textContent      = esc(vm.bv);
    $("#mechMove").textContent    = `${esc(vm.movement?.walk)} / ${esc(vm.movement?.run)} / ${esc(vm.movement?.jump)}`;

    // Armor max + internals
    for (const box of $$(".loc[data-code]")) {
      const code = box.dataset.code;
      const max = vm.armorMax?.[code] || { f:0, r:0 };
      const intl = vm.internals?.[code] ?? 0;
      const mF = box.querySelector(".armorMaxF");
      const mR = box.querySelector(".armorMaxR");
      const inl= box.querySelector(".internals");
      if (mF) mF.textContent = esc(max.f ?? 0);
      if (mR) mR.textContent = esc(max.r ?? 0);
      if (inl) inl.textContent = esc(intl);
    }

    drawWeapons(vm);
    drawEquipment(vm);
  }

  function drawWeapons(vm) {
    const tbody = $("#weapRows");
    tbody.innerHTML = "";
    const addRow = (w, idx, isMelee=false) => {
      const tr = document.createElement("tr");
      const ammoEditable = !isMelee && w.ammoMax != null && w.ammoMax !== "∞";
      const on = USER.weap[idx]?.enabled ?? w.enabledDefault ?? true;
      const ammoVal = USER.weap[idx]?.ammo ?? (ammoEditable ? w.ammoMax : null);
      tr.className = on ? "" : "tr-dim";
      tr.innerHTML = `
        <td>${esc(w.name)}</td>
        <td>${esc(w.type||"")}</td>
        <td>${esc(w.damage)}</td>
        <td>${esc(w.heat)}</td>
        <td>${esc(w.range?.min ?? "")}</td>
        <td>${esc(w.range?.short ?? "")}</td>
        <td>${esc(w.range?.medium ?? "")}</td>
        <td>${esc(w.range?.long ?? "")}</td>
        <td>${ammoEditable ? `<input class="weapAmmo" data-idx="${idx}" type="number" min="0" value="${ammoVal ?? ""}" />` : (isMelee ? "∞" : "—")}</td>
        <td><input class="weapEnabled" data-idx="${idx}" type="checkbox" ${on ? "checked" : ""}></td>
      `;
      tbody.appendChild(tr);
    };
    // Melee first
    (vm.melee || []).forEach((m, i) => addRow({ ...m, range:{}, ammoMax:"∞" }, i, true));
    // Then ranged
    const base = (vm.melee || []).length;
    (vm.weapons || []).forEach((w, i) => addRow(w, base + i, false));
  }

  function drawEquipment(vm) {
    const grid = $("#equipRows");
    // Remove dynamic rows (keep headers)
    grid.querySelectorAll(".dyn").forEach(n => n.remove());
    const cols = ["LA","LL","LT","CT","HD","RT","RL","RA"];
    const rows = Math.max(...cols.map(c => (vm.equipmentByLocation?.[c] || []).length), 10);
    for (let r=0; r<rows; r++) {
      for (const c of cols) {
        const v = (vm.equipmentByLocation?.[c] || [])[r] || "";
        const idx = String(r+1).padStart(2,"0");
        const slotKey = `${c}:${idx}`;
        const disabled = !!USER.eqDisabled?.[slotKey];

        const dn = document.createElement("div");
        dn.className = "dyn num";
        dn.textContent = `[${idx}]`;
        grid.appendChild(dn);

        const dv = document.createElement("div");
        dv.className = "dyn val";
        dv.innerHTML = v ? `<span title="${String(v)}" style="${disabled?'opacity:.45;text-decoration:line-through;':''}">${String(v)}</span>` : "&nbsp;";
        grid.appendChild(dv);
      }
    }
  }

  // ---------- Overlay user state ----------
  function applyUserState() {
    const u = USER || {};
    $("#pilotName").value     = u.pilotName || "";
    $("#pilotCallsign").value = u.pilotCallsign || "";
    $("#pilotGunnery").value  = u.pilotGunnery ?? "";
    $("#pilotPiloting").value = u.pilotPiloting ?? "";
    $("#pilotHits").value     = u.pilotHits ?? 0;
    $("#pilotKO").value       = u.pilotKO ?? "";
    $("#sheetNotes").value    = u.notes || "";
    $("#heatCurrent").value   = u.heatCurrent ?? 0;
    renderHeatEffect();

    // Armor currents
    for (const box of $$(".loc[data-code]")) {
      const code = box.dataset.code;
      const cur = u.armorCur?.[code] || { f:0, r:0 };
      const f = box.querySelector(".armorCurF");
      const r = box.querySelector(".armorCurR");
      if (f) f.value = cur.f ?? 0;
      if (r) r.value = cur.r ?? 0;
    }

    // Refresh weapons rows to reflect on/off & ammo
    if (STATIC) drawWeapons(STATIC);
  }

  // ---------- Actions ----------
  function onApplyMaxArmor() {
    if (!STATIC) return;
    USER.armorCur = JSON.parse(JSON.stringify(STATIC.armorMax || {}));
    for (const code of ["HD","CT","RT","LT","RA","LA","RL","LL"]) {
      USER.armorCur[code] = USER.armorCur[code] || { f:0, r:0 };
      if (USER.armorCur[code].f == null && typeof USER.armorCur[code] === "number") {
        USER.armorCur[code] = { f: +USER.armorCur[code] || 0, r: 0 };
      }
      USER.armorCur[code].f = +USER.armorCur[code].f || 0;
      USER.armorCur[code].r = +USER.armorCur[code].r || 0;
    }
    applyUserState();
    saveUserStateSoon();
  }

  // ---------- Public API ----------
  API.mount = () => { injectUI(); return API; };
  API.open  = async () => {
    injectUI();
    USER = loadUserState();
    try {
      const vm = await (window.MSS84_COMPILER?.resolveForToken?.(MAP_ID, TOKEN_ID));
      renderStatics(vm);
    } catch (e) {
      console.warn("[MSS84_SHEET] resolveForToken failed:", e);
      const mechRef = localStorage.getItem("mss84:sheet:mechPath");
      if (mechRef && window.MSS84_COMPILER?.resolveFromRef) {
        try {
          const vm = await window.MSS84_COMPILER.resolveFromRef(mechRef);
          renderStatics(vm);
        } catch (e2) {
          // leave UI; top labels will show placeholders
        }
      }
    }
    applyUserState();
    showUI(true);
  };
  API.close = () => { if ($("#mss84-sheet-root")) showUI(false); };
  API.setIds = (mapId, tokenId) => { MAP_ID = mapId; TOKEN_ID = tokenId; return API; };
  API.setMechRef = (mechRef) => { localStorage.setItem("mss84:sheet:mechPath", mechRef || ""); return API; };
  API.refresh = async () => {
    if (!$("#mss84-sheet-root") || $("#mss84-sheet-root").style.display === "none") return;
    try {
      const vm = await (window.MSS84_COMPILER?.resolveForToken?.(MAP_ID, TOKEN_ID));
      renderStatics(vm); applyUserState();
    } catch (e) {}
  };
  API.getUserState = () => (USER ? JSON.parse(JSON.stringify(USER)) : defaultUserState());
  API.setUserState = (obj) => { USER = Object.assign(defaultUserState(), obj || {}); applyUserState(); saveUserStateSoon(); };
  API.resetUserState = () => { USER = defaultUserState(); applyUserState(); saveUserStateSoon(); };

  window.MSS84_SHEET = API;
})();
