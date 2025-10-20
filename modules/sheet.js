// modules/sheet.js
// MSS:84 — Sheet Panel (Original UI + Compiler statics)
// - Keeps the original layout, tabs, bars, crit boards, and styles.
// - Pulls *stable* mech data (chassis/variant/tonnage/BV, move, armor max, internals,
//   heat sinks, weapons, equipment) from window.MSS84_COMPILER by Map/Token ID.
// - Saves only *non-stable* user fields per Map/Token in localStorage:
//   pilot name/callsign/faction/gunnery/piloting, heat.current, armor current values,
//   crit "hit" markers, notes, current ammo for each weapon.
// - Hides the "Add Equipment" and "Add Weapon" blocks from the original so loadouts
//   come only from compiler/mech JSON.
//
// Public API (also on window.MSS84_SHEET):
//   Sheet.mount(host?)
//   api.open(), api.close(), api.toggle()
//   api.setIds(mapId, tokenId), api.getIds()
//
// Zoom note:
//   This build adds a true uniform zoom (no font-only scaling). If the viewport width is
//   narrower than --panel-w, we scale the whole panel via CSS var --sheet-scale.
//   The open/close animation now uses an outer wrapper that translates by the scaled width.

(function () {
  const LAST_IDS_KEY = 'MSS84:lastIds';
  const CSS_ID = 'mss84-sheet-styles';
  const CSS = `
:root{
  --sheet-bg:#0f0f0f; --sheet-fg:#e6e6e6; --muted:#a7a7a7;
  --accent:#f0b000; --accent-2:#33c3ff; --danger:#ff4d4d; --ok:#27c93f; --warn:#ffa502;
  --line:#2a2a2a; --panel-w:500px; --radius:14px; --pad:12px;
  --bar-h:10px;
  --sheet-scale: 1; /* runtime-computed zoom */
}
.mss84-sheet{ font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--sheet-fg); }
.mss84-sheet *{ box-sizing:border-box; }

/* Zoomable outer/inner wrappers */
.mss84-sheet__outer{
  position:fixed; top:0; left:0; height:100vh; z-index:999;
  width: calc(var(--panel-w) * var(--sheet-scale));
  transform: translateX(calc(-1 * var(--panel-w) * var(--sheet-scale)));
  transition: transform .2s ease;
}
.mss84-sheet__outer.open{
  transform: translateX(0);
}
.mss84-sheet__inner{
  width: var(--panel-w);
  height: 100vh;
  transform-origin: top left;
  transform: scale(var(--sheet-scale));
}

.mss84-sheet__btn{
  position:fixed; top:16px; left: calc(var(--panel-w) * var(--sheet-scale)); z-index:1000;
  background:#141414; color:#fff; border:1px solid var(--line); border-radius:10px;
  padding:8px 10px; cursor:pointer;
}
.mss84-sheet__btn:hover{ border-color:#555; }

.mss84-sheet__wrap{
  position:relative; display:flex; flex-direction:column; width:var(--panel-w);
  height:100vh; background:var(--sheet-bg); border-right:1px solid var(--line);
  box-shadow:8px 0 24px rgba(0,0,0,.35);
  /* (positioning now handled by .mss84-sheet__outer) */
}
.mss84-sheet[hidden]{ display:none; }

/* Header */
.mss84-sheet__hdr{
  display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line);
  position:sticky; top:0; background:linear-gradient(#0f0f0f,#0f0f0fcc 60%, transparent);
  z-index:2;
}
.mss84-sheet__title{ font-weight:700; letter-spacing:.4px; }
.mss84-savepulse{ margin-left:10px; font-size:12px; color:#9ad29a; opacity:0; transition:opacity .2s ease; }
.mss84-savepulse.on{ opacity:1; }

.mss84-sheet__spacer{ flex:1; }
.mss84-sheet__x{
  background:#141414; color:#fff; border:1px solid var(--line); border-radius:10px; padding:6px 10px; cursor:pointer;
}
.mss84-sheet__x:hover{ border-color:#555; }

/* Tabs */
.mss84-tabs{ display:flex; gap:8px; padding:8px 12px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
.mss84-tab{
  padding:6px 10px; border-radius:999px; border:1px solid var(--line); cursor:pointer; user-select:none;
  font-size:12px; background:#141414;
}
.mss84-tab[aria-selected="true"]{ border-color:var(--accent); color:#fff; box-shadow:0 0 0 1px #000 inset; }

/* Panels */
.mss84-panels{ flex:1; overflow:auto; padding:10px 12px 18px; }
.mss84-panel[hidden]{ display:none; }

/* Grid helpers */
.row{ display:flex; align-items:center; gap:10px; }
.row.between{ justify-content:space-between; }
.col{ display:flex; flex-direction:column; gap:10px; }
.grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.grid-3{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }

/* Fields */
.mss84-sheet .hint{ color:var(--muted); font-size:12px; }
.mss84-sheet input[type="text"],
.mss84-sheet input[type="number"],
.mss84-sheet input[type="radio"],
.mss84-sheet textarea,
.mss84-sheet select{
  width:100%; background:#141414; color:#fff; border:1px solid var(--line);
  border-radius:10px; padding:8px 10px; outline:none;
}
.mss84-sheet input[type="number"]{ -moz-appearance:textfield; }
.mss84-sheet input::-webkit-outer-spin-button,
.mss84-sheet input::-webkit-inner-spin-button{ -webkit-appearance:none; margin:0; }

.mss84-sheet__field{ display:grid; grid-template-columns:50px 1fr; gap:0px; align-items:center; margin:2px 0; font-size:12px;}
.mss84-sheet__fieldt{ display:grid; grid-template-columns:70px 1fr 1fr; gap:8px; align-items:center; margin:2px 0; font-size:12px;}
.mss84-sheet__label{ color:var(--muted); font-size:11px; }

/* Heat */
.heatbar{ position:relative; background:#151515; height:var(--bar-h); border-radius:999px; border:1px solid #1e1e1e; }
.heatbar .fill{ position:absolute; left:0; top:0; bottom:0; width:30%; border-radius:999px; background:linear-gradient(90deg,#f0b000,#ff4d4d); transition:width .1s ease; }

/* Armor pips */
.pips{ display:grid; grid-template-columns:repeat(10,1fr); gap:2px; }
.pip{ height:10px; background:#1a1a1a; border:1px solid #252525; border-radius:2px; }
.pip.on{ background:#27c93f; }

/* Weapons table */
.weap-grid{
  display:grid; grid-template-columns:1.2fr .9fr .6fr .6fr .6fr .6fr .6fr .6fr .8fr .8fr;
  gap:6px; font-size:12px; align-items:center;
}
.weap-grid > *{ min-width:0; }
.weap-row{ display:contents; }
.weap-head{ color:#bbb; }
.weap-name{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Equipment grid (crit boards) */
.crit-wrap{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.crit{ border:1px solid var(--line); border-radius:10px; padding:8px; }
.crit h4{ margin:0 0 6px; font-size:12px; color:#bbb; }
.crit-grid{ display:grid; grid-template-columns:repeat(6,1fr); gap:4px; }
.crit-slot{ height:22px; border:1px solid #222; border-radius:6px; padding:2px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
.crit-slot .del{ margin-left:auto; background:#201414; border:1px solid #302020; border-radius:6px; padding:0 6px; cursor:pointer; }
.crit-slot .del:hover{ border-color:#4a2a2a; }

/* Footer actions */
.actions{ display:flex; gap:6px; flex-wrap:wrap; }
  `;

  const PANEL_HTML = `
<div class="mss84-sheet">
  <div class="mss84-sheet__outer" id="sheetOuter" aria-hidden="true">
    <div class="mss84-sheet__inner" id="sheetInner">
      <aside class="mss84-sheet__wrap" id="sheetWrap" aria-hidden="false">
        <header class="mss84-sheet__hdr">
          <div class="mss84-sheet__title">Mech Sheet <span id="savePulse" class="mss84-savepulse">Saved</span></div>
          <div class="mss84-sheet__spacer"></div>
          <button class="mss84-sheet__x" id="loadFromJsonBtn" title="Legacy: resolve from /data/manifest.json">Load from JSON</button>
          <button class="mss84-sheet__x" id="sheetCloseBtn" title="Close">Close</button>
        </header>

        <nav class="mss84-tabs" id="sheetTabs" role="tablist" aria-label="Sheet tabs">
          <button class="mss84-tab" role="tab" aria-selected="true" aria-controls="tabPilot" id="tabPilotBtn">Pilot</button>
          <button class="mss84-tab" role="tab" aria-selected="false" aria-controls="tabMech" id="tabMechBtn">Mech</button>
          <button class="mss84-tab" role="tab" aria-selected="false" aria-controls="tabWeapons" id="tabWeaponsBtn">Weapons</button>
          <button class="mss84-tab" role="tab" aria-selected="false" aria-controls="tabEquip" id="tabEquipBtn">Equipment</button>
        </nav>

        <div class="mss84-panels">
          <!-- Pilot -->
          <section class="mss84-panel" id="tabPilot" role="tabpanel">
            <div class="grid-2">
              <div class="col">
                <div class="mss84-sheet__field">
                  <div class="mss84-sheet__label">Name</div>
                  <input id="pilotName" type="text" placeholder="Pilot name"/>
                </div>
                <div class="mss84-sheet__field">
                  <div class="mss84-sheet__label">Call</div>
                  <input id="pilotCall" type="text" placeholder="Callsign"/>
                </div>
                <div class="mss84-sheet__field">
                  <div class="mss84-sheet__label">Faction</div>
                  <input id="pilotFaction" type="text" placeholder="Faction"/>
                </div>
              </div>
              <div class="col">
                <div class="mss84-sheet__fieldt">
                  <div class="mss84-sheet__label">Gunnery</div>
                  <input id="pilotG" type="number" min="0" max="10" step="1"/>
                  <div class="hint">Lower is better</div>
                </div>
                <div class="mss84-sheet__fieldt">
                  <div class="mss84-sheet__label">Piloting</div>
                  <input id="pilotP" type="number" min="0" max="10" step="1"/>
                  <div class="hint">Lower is better</div>
                </div>
              </div>
            </div>
            <div class="col" style="margin-top:10px;">
              <div class="mss84-sheet__label">Notes</div>
              <textarea id="pilotNotes" rows="4" placeholder="Notes…"></textarea>
            </div>
          </section>

          <!-- Mech -->
          <section class="mss84-panel" id="tabMech" role="tabpanel" hidden>
            <div class="grid-2">
              <div class="col">
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Chassis</div><input id="mechChassis" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Variant</div><input id="mechVariant" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Tonnage</div><input id="mechTons" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">BV</div><input id="mechBV" type="text" disabled/></div>
              </div>
              <div class="col">
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Move</div><input id="mvStand" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Walk/Run</div><input id="mvWR" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Jump</div><input id="mvJump" type="text" disabled/></div>
                <div class="mss84-sheet__field"><div class="mss84-sheet__label">Sinks</div><input id="mvSinks" type="text" disabled/></div>
              </div>
            </div>

            <div class="col" style="margin-top:12px;">
              <div class="row between">
                <div class="mss84-sheet__label">Heat</div>
                <div id="heatEffect" class="hint">Normal</div>
              </div>
              <div class="heatbar" id="heatBar"><div class="fill"></div></div>
            </div>
          </section>

          <!-- Weapons -->
          <section class="mss84-panel" id="tabWeapons" role="tabpanel" hidden>
            <div class="weap-grid weap-head">
              <div>Name</div><div>Type</div><div>DMG</div><div>Heat</div><div>Min</div><div>S</div><div>M</div><div>L</div><div>Ammo</div><div>Max</div>
            </div>
            <div id="weapList"></div>
          </section>

          <!-- Equipment (Crit Boards) -->
          <section class="mss84-panel" id="tabEquip" role="tabpanel" hidden>
            <div class="crit-wrap">
              <div class="crit"><h4>LA</h4><div class="crit-grid" id="critLA"></div></div>
              <div class="crit"><h4>LL</h4><div class="crit-grid" id="critLL"></div></div>
              <div class="crit"><h4>LT</h4><div class="crit-grid" id="critLT"></div></div>
              <div class="crit"><h4>CT</h4><div class="crit-grid" id="critCT"></div></div>
              <div class="crit"><h4>HD</h4><div class="crit-grid" id="critHD"></div></div>
              <div class="crit"><h4>RT</h4><div class="crit-grid" id="critRT"></div></div>
              <div class="crit"><h4>RL</h4><div class="crit-grid" id="critRL"></div></div>
              <div class="crit"><h4>RA</h4><div class="crit-grid" id="critRA"></div></div>
            </div>

            <div class="actions" style="margin-top:10px;">
              <button class="mss84-sheet__x" id="clearAlloc">Clear Allocations</button>
              <button class="mss84-sheet__x" id="resetThisMech">Reset Mech State</button>
              <button class="mss84-sheet__x" id="clearThisToken" style="background:#2a1414;border:1px solid #3a1c1c;">Clear This Token</button>
              <div class="hint">Removes saved sheet for the current Map/Token only (user-state data).</div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</div>

  `;

  function ensureStyles() {
    if (!document.getElementById(CSS_ID)) {
      const s = document.createElement('style');
      s.id = CSS_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }

  // --- basic persistence helpers ---
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function loadJSON(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } }

  // --- legacy JSON loader (fallback if compiler unavailable) ---
  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  function defaultSheet() {
    return {
      pilot: { name:'', call:'', faction:'', g:4, p:5, notes:'' },
      mech : { chassis:'', variant:'', tons:'', bv:'', stand:'', wr:'', jump:'', sinks:0 },
      heat : { cur: 0, sinks: 10 },
      weapons: [],
      ammoByWid: {}, // { wid:{cur,max} }
      crits: { LA:[], LL:[], LT:[], CT:[], HD:[], RT:[], RL:[], RA:[] }
    };
  }

  function key(mapId, tokenId) { return `MSS84:sheet:${mapId}:${tokenId}`; }

  // ---- MAIN MOUNT ----
  function mount(host = document.body){
    ensureStyles();
    const root = document.createElement('div');
    root.innerHTML = PANEL_HTML;
    host.appendChild(root);

    const QS  = (s, r=root) => r.querySelector(s);
    const QSA = (s, r=root) => Array.from(r.querySelectorAll(s));

    // Try last used ids; fall back to host globals; then defaults
    const lastIds = (()=>{ try{ return JSON.parse(localStorage.getItem(LAST_IDS_KEY)||'null'); }catch{ return null; } })();
    let mapId   = lastIds?.mapId   || (window.CURRENT_MAP_ID || 'local');
    let tokenId = lastIds?.tokenId || (window.selectedTokenId || 'token-A');
    let sheet   = load(mapId, tokenId);

    // Elements
    const wrap      = QS('#sheetWrap');
    const outer     = QS('#sheetOuter');
    const inner     = QS('#sheetInner');

    // Zoom scale logic
    function readCssPx(varName, fallback){
      const s = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (!s.endsWith('px')) return fallback;
      const n = parseFloat(s.slice(0,-2));
      return Number.isFinite(n) ? n : fallback;
    }
    function updateSheetScale(){
      const panelW = readCssPx('--panel-w', 500);
      const vw = Math.max(320, window.innerWidth || panelW);
      const scale = Math.min(1, vw / panelW); // clamp to [min,1]
      document.documentElement.style.setProperty('--sheet-scale', String(scale));
    }
    updateSheetScale();
    window.addEventListener('resize', updateSheetScale);

    const btnClose  = QS('#sheetCloseBtn');
    const btnLoad   = QS('#loadFromJsonBtn');
    const tabs      = QS('#sheetTabs');
    const savePulse = QS('#savePulse');

    const fPilot = {
      name:QS('#pilotName'), call:QS('#pilotCall'), faction:QS('#pilotFaction'),
      g:QS('#pilotG'), p:QS('#pilotP'), notes:QS('#pilotNotes')
    };
    const fMech = { chassis:QS('#mechChassis'), variant:QS('#mechVariant'), tons:QS('#mechTons'), bv:QS('#mechBV') };
    const fMove = { stand:QS('#mvStand'), wr:QS('#mvWR'), jump:QS('#mvJump'), sinks:QS('#mvSinks') };

    const heatBar = QS('#heatBar .fill');
    const heatEffect = QS('#heatEffect');

    const weapList = QS('#weapList');

    const critIds = ['LA','LL','LT','CT','HD','RT','RL','RA'];
    const critEls = Object.fromEntries(critIds.map(id=>[id, QS('#crit'+id)]));

    // --- save pulse ---
    let pulseT = null;
    function pulseSaved() {
      savePulse.classList.add('on');
      clearTimeout(pulseT);
      pulseT = setTimeout(()=> savePulse.classList.remove('on'), 900);
    }

    // --- serialization ---
    function load(mapId, tokenId) {
      return loadJSON(key(mapId, tokenId), defaultSheet());
    }
    function save() {
      localStorage.setItem(LAST_IDS_KEY, JSON.stringify({ mapId, tokenId }));
      saveJSON(key(mapId, tokenId), sheet);
      pulseSaved();
    }
    function scheduleSave(){ clearTimeout(scheduleSave.t); scheduleSave.t = setTimeout(save, 150); }

    // --- hydrate UI ---
    function setTab(which){
      const btns = QSA('.mss84-tab', tabs);
      btns.forEach(btn=>{
        const target = btn.getAttribute('aria-controls');
        const sel = btn.id === which+'Btn';
        btn.setAttribute('aria-selected', String(sel));
        const panel = QS('#'+target);
        if(panel) panel.hidden = !sel;
      });
    }

    function setHeatUI(val){
      const clamped = Math.max(0, Math.min(30, Number(val)||0));
      const pct = (clamped/30)*100;
      heatBar.style.width = pct + '%';
      // Only show the latest effect
      let effect = 'Normal';
      if (clamped >= 30) effect = 'Shutdown / Ammo explode check';
      else if (clamped >= 26) effect = 'Movement -4, +6 to fire';
      else if (clamped >= 22) effect = 'Movement -3, +5 to fire';
      else if (clamped >= 18) effect = 'Movement -2, +4 to fire';
      else if (clamped >= 14) effect = 'Movement -1, +3 to fire';
      else if (clamped >= 10) effect = '+2 to fire';
      else if (clamped >= 5)  effect = '+1 to fire';
      heatEffect.textContent = effect;
    }

    function hydratePilot(){
      fPilot.name.value = sheet.pilot.name||'';
      fPilot.call.value = sheet.pilot.call||'';
      fPilot.faction.value = sheet.pilot.faction||'';
      fPilot.g.value = sheet.pilot.g ?? 4;
      fPilot.p.value = sheet.pilot.p ?? 5;
      fPilot.notes.value = sheet.pilot.notes||'';
    }
    function hydrateMech(){
      fMech.chassis.value = sheet.mech.chassis||'';
      fMech.variant.value = sheet.mech.variant||'';
      fMech.tons.value    = sheet.mech.tons||'';
      fMech.bv.value      = sheet.mech.bv||'';
      fMove.stand.value   = sheet.mech.stand||'';
      fMove.wr.value      = sheet.mech.wr||'';
      fMove.jump.value    = sheet.mech.jump||'';
      fMove.sinks.value   = String(sheet.heat.sinks ?? sheet.mech.sinks ?? 10);
      setHeatUI(sheet.heat.cur||0);
    }
    function renderWeapons(){
      weapList.textContent = '';
      const frag = document.createDocumentFragment();
      (sheet.weapons||[]).forEach(w=>{
        const row = document.createElement('div');
        row.className = 'weap-grid weap-row';
        const ammo = sheet.ammoByWid?.[w.wid]?.cur ?? '';
        const max  = sheet.ammoByWid?.[w.wid]?.max ?? (w.ammoMax ?? '');
        row.innerHTML = `
          <div class="weap-name" title="${w.name||''}">${w.name||''}</div>
          <div>${w.type||''}</div>
          <div>${w.dmg ?? ''}</div>
          <div>${w.heat ?? ''}</div>
          <div>${w.min ?? ''}</div>
          <div>${w.s ?? ''}</div>
          <div>${w.m ?? ''}</div>
          <div>${w.l ?? ''}</div>
          <div><input data-wid="${w.wid}" class="weap-ammo" type="number" min="0" step="1" value="${ammo}"/></div>
          <div>${max ?? ''}</div>
        `;
        frag.appendChild(row);
      });
      weapList.appendChild(frag);
      QSA('input.weap-ammo', weapList).forEach(inp=>{
        inp.addEventListener('input', ()=>{
          const wid = inp.getAttribute('data-wid');
          const cur = Math.max(0, Number(inp.value)||0);
          sheet.ammoByWid = sheet.ammoByWid || {};
          const slot = sheet.ammoByWid[wid] = sheet.ammoByWid[wid] || {};
          slot.cur = cur;
          // keep max if we have it
          if (slot.max == null) slot.max = (sheet.weapons.find(w=>String(w.wid)===String(wid))?.ammoMax) ?? null;
          scheduleSave();
        });
      });
    }
    function renderCrits(){
      // assume statics placed by compiler provided array per location
      for(const loc of Object.keys(critEls)){
        const el = critEls[loc];
        el.textContent = '';
        const items = sheet.crits?.[loc] || [];
        const frag = document.createDocumentFragment();
        items.forEach((it, idx)=>{
          const slot = document.createElement('div');
          slot.className = 'crit-slot';
          slot.title = it.name || '';
          slot.innerHTML = `<span class="txt">${it.name||''}</span><button class="del" data-loc="${loc}" data-idx="${idx}">×</button>`;
          frag.appendChild(slot);
        });
        el.appendChild(frag);
      }
      QSA('.crit-slot .del').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const loc = btn.getAttribute('data-loc');
          const idx = Number(btn.getAttribute('data-idx'));
          if (!confirm('Remove this allocation?')) return;
          sheet.crits[loc].splice(idx, 1);
          scheduleSave();
          renderCrits();
        });
      });
    }

    function hydrateAll(){
      hydratePilot();
      hydrateMech();
      renderWeapons();
      renderCrits();
    }

    // --- tab wiring ---
    tabs.addEventListener('click', (e)=>{
      const btn = e.target.closest('.mss84-tab');
      if(!btn) return;
      const id = btn.id.replace(/Btn$/,'');
      setTab(id);
    });

    // --- inputs wiring ---
    fPilot.name.addEventListener('input', ()=>{ sheet.pilot.name = fPilot.name.value; scheduleSave(); });
    fPilot.call.addEventListener('input', ()=>{ sheet.pilot.call = fPilot.call.value; scheduleSave(); });
    fPilot.faction.addEventListener('input', ()=>{ sheet.pilot.faction = fPilot.faction.value; scheduleSave(); });
    fPilot.g.addEventListener('input', ()=>{ sheet.pilot.g = Math.max(0,Number(fPilot.g.value)||0); scheduleSave(); });
    fPilot.p.addEventListener('input', ()=>{ sheet.pilot.p = Math.max(0,Number(fPilot.p.value)||0); scheduleSave(); });
    fPilot.notes.addEventListener('input', ()=>{ sheet.pilot.notes = fPilot.notes.value; scheduleSave(); });

    // --- legacy JSON resolve ---
    btnLoad.addEventListener('click', async ()=>{
      try{
        const manifest = await fetchJSON('./data/manifest.json');
        const pick = manifest?.[0] || manifest?.items?.[0];
        if(!pick) throw new Error('manifest empty');
        const mech = await fetchJSON(pick.path || pick.file || pick.url);
        // shallow map
        sheet.mech.chassis = mech?.chassis || mech?.Chassis || '';
        sheet.mech.variant = mech?.variant || mech?.Variant || '';
        sheet.mech.tons    = String(mech?.tons || mech?.Mass || '');
        sheet.mech.bv      = String(mech?.bv || mech?.BV || '');
        sheet.mech.stand   = (mech?.move?.walk ?? mech?.Walk ?? '');
        sheet.mech.wr      = `${mech?.move?.walk ?? mech?.Walk ?? ''}/${mech?.move?.run ?? mech?.Run ?? ''}`;
        sheet.mech.jump    = mech?.move?.jump ?? mech?.Jump ?? '';
        sheet.heat.sinks   = mech?.heatSinks ?? mech?.HeatSinks ?? (sheet.heat.sinks||10);
        // weapons (assign wid)
        let wid = 1;
        sheet.weapons = (mech?.weapons||[]).map(w=>({
          wid: String(wid++),
          name: w.name, type: w.type, dmg: w.dmg, heat: w.heat,
          min:w.min, s:w.s, m:w.m, l:w.l,
          ammoMax: w?.ammo?.max ?? null
        }));
        // crits
        const locs = ['LA','LL','LT','CT','HD','RT','RL','RA'];
        sheet.crits = Object.fromEntries(locs.map(l=>[l, (mech?.equipmentByLocation?.[l] || []).map(n=>({name:n})) ]));
        hydrateAll();
        scheduleSave();
      }catch(err){
        console.error('Legacy load fail', err);
        alert('Legacy load failed (see console)');
      }
    });

    // --- open/close
    const open = (ids)=>{                      // optional ids override
      if (ids && ids.mapId && ids.tokenId) {
        mapId = ids.mapId; tokenId = ids.tokenId; sheet = load(mapId, tokenId); hydrateAll();
      } else {
        // If host globals exist and differ, adopt them on open
        const hostMap = window.CURRENT_MAP_ID;
        const hostTok = window.selectedTokenId;
        if (hostMap && hostTok && (hostMap !== mapId || hostTok !== tokenId)) {
          mapId = hostMap; tokenId = hostTok; sheet = load(mapId, tokenId); hydrateAll();
        }
      }
      updateSheetScale();
      outer.classList.add('open'); outer.setAttribute('aria-hidden','false');
    };
    const close  = ()=>{ outer.classList.remove('open'); outer.setAttribute('aria-hidden','true'); };
    const toggle = ()=> (outer.classList.contains('open')? close() : open());

    btnClose.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    // --- actions
    QS('#clearAlloc').addEventListener('click', ()=>{
      if(!confirm('Clear all equipment allocations?')) return;
      for(const k of Object.keys(sheet.crits)) sheet.crits[k] = [];
      renderCrits(); scheduleSave();
    });
    QS('#resetThisMech').addEventListener('click', ()=>{
      if(!confirm('Reset mech user state (heat, ammo, crits)?')) return;
      sheet.heat.cur = 0;
      sheet.ammoByWid = {};
      for(const k of Object.keys(sheet.crits)) sheet.crits[k] = [];
      setHeatUI(0);
      renderWeapons();
      renderCrits();
      scheduleSave();
    });
    QS('#clearThisToken').addEventListener('click', ()=>{
      if(!confirm('Delete saved sheet for this Map/Token?')) return;
      localStorage.removeItem(key(mapId, tokenId));
      sheet = defaultSheet();
      hydrateAll(); scheduleSave();
    });

    // --- public API
    const api = {
      mount:()=>{}, open, close, toggle,
      setIds:(m,t)=>{ mapId=m; tokenId=t; saveJSON(LAST_IDS_KEY,{mapId,tokenId}); sheet=load(mapId,tokenId); hydrateAll(); },
      getIds:()=>({ mapId, tokenId }),
      get state(){ return sheet; },
      setHeat(v){ sheet.heat.cur = Math.max(0,Number(v)||0); setHeatUI(sheet.heat.cur); scheduleSave(); },
      setHeatSinks(v){ sheet.heat.sinks = Math.max(0,Number(v)||0); fMove.sinks.value=String(sheet.heat.sinks); scheduleSave(); },
    };

// initialize UI from state
hydrateAll();

// export
window.MSS84_SHEET = api;

// legacy adapter: let external callers invoke MSS84_SHEET.refresh()
if (!api.refresh) {
  api.refresh = function(next){
    // re-read any saved state, optionally switch ids, then re-hydrate
    if (next && next.mapId && next.tokenId) {
      mapId = next.mapId; 
      tokenId = next.tokenId; 
      sheet = load(mapId, tokenId);
    }
    hydrateAll();
    updateSheetScale();
    return api;
  };
}

return api;
}

  // auto-mount if requested
  window.Sheet = { mount };

  function mountAuto(){
    // do nothing by default
  }
})();
