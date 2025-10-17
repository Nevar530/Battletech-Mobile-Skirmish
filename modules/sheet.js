
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
//   api.refresh()  // re-pull compiler statics and re-hydrate
//
// Requirements:
//   - window.MSS84_COMPILER with: resolveForToken(mapId, tokenId) -> vm
//     Normalized vm shape expected:
//       {
//         name, variant, techBase, tonnage, bv,
//         movement: { walk, run, jump },
//         armorMax: { HD:{f}, CT:{f,r}, ... }, internals: { HD:Number, ... },
//         heatSinks: Number|String,
//         melee: [{name,type,damage,heat}],  // Punch/Kick/Charge/DFA (ammoMax: '∞')
//         weapons: [{
//           name,type,damage,heat,
//           range:{min,short,medium,long},
//           ammoMax:Number|null,
//           enabledDefault:Boolean
//         }],
//         equipmentByLocation: { LA:[...], LL:[...], LT:[...], CT:[...], HD:[...], RT:[...], RL:[...], RA:[...] }
//       }
//
// Fallback: If compiler resolution fails, you can still click "Load from JSON"
//           to resolve statics from /data/manifest.json + mech JSON (legacy path).
//
window.Sheet = (() => {
  const CSS_ID = 'mss84-sheet-styles';
  const CSS = `
:root{
  --sheet-bg:#0f0f0f; --sheet-fg:#e6e6e6; --muted:#a7a7a7;
  --accent:#f0b000; --accent-2:#33c3ff; --danger:#ff4d4d; --ok:#27c93f; --warn:#ffa502;
  --line:#2a2a2a; --panel-w:500px; --radius:14px; --pad:12px;
  --bar-h:10px;
}
.mss84-sheet{ font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--sheet-fg); }
.mss84-sheet *{ box-sizing:border-box; }

.mss84-sheet__btn{
  position:fixed; top:16px; left:500px; z-index:1000;
  background:#141414; color:#fff; border:1px solid var(--line); border-radius:10px;
  padding:8px 10px; cursor:pointer; user-select:none;
  box-shadow:0 2px 10px rgba(0,0,0,.3);
}
.mss84-sheet__btn:active{ transform:translateY(1px); }

.mss84-sheet__wrap{
  position:fixed; top:0; left:0; height:100vh; width:var(--panel-w); z-index:999;
  background:var(--sheet-bg); border-right:1px solid var(--line);
  transform:translateX(calc(-1 * var(--panel-w))); transition:transform .2s ease;
  display:flex; flex-direction:column;
}
.mss84-sheet__wrap.open{ transform:translateX(0); }

.mss84-sheet__hdr{
  display:flex; align-items:center; gap:10px; padding:12px;
  border-bottom:1px solid var(--line);
}
.mss84-sheet__title{ font-weight:700; letter-spacing:.5px; }
.mss84-sheet__spacer{ flex:1; }
.mss84-sheet__x{ border:0; background:#1a1a1a; color:#fff; padding:6px 10px; border-radius:10px; cursor:pointer; }

.mss84-sheet__body{ overflow:auto; padding:0 12px 18px; }

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
.mss84-sheet__fieldt{ display:grid; grid-template-columns:15px 1fr; gap:0px; align-items:center; margin:2px 0; font-size:14px;}
.mss84-sheet__group{ border:1px solid var(--line); border-radius:var(--radius); padding:12px; margin:12px 0; background:#111; }
.mss84-sheet__group h4{ margin:0 0 8px; font-size:14px; color:#ddd; }

.mss84-sheet__tabs{ display:flex; gap:8px; padding:8px 8px 0; }
.mss84-sheet__tab{
  flex:1; text-align:center; padding:8px; cursor:pointer; border-bottom:2px solid transparent;
  color:#ccc; user-select:none;
}
.mss84-sheet__tab.active{ color:#fff; border-color:var(--accent); }
.mss84-sheet__panel{ display:none; }
.mss84-sheet__panel.active{ display:block; }

.mss84-bars{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.mss84-bar{
  display:flex; flex-direction:column; gap:6px; padding:8px; border:1px solid var(--line);
  border-radius:12px; background:#0e0e0e; cursor:pointer;
}
.mss84-bar__hdr{ display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#ddd; }
.mss84-bar__meter{ position:relative; height:var(--bar-h); background:#1b1b1b; border-radius:100px; overflow:hidden; border:1px solid #222; }
.mss84-bar__fill{ position:absolute; top:0; left:0; height:100%; width:0%; background:linear-gradient(90deg, #2bd93f, #a3ff00); }
.mss84-bar.crit .mss84-bar__fill{ background:linear-gradient(90deg, #ff8c00, #ffd000); }
.mss84-bar.low .mss84-bar__fill{ background:linear-gradient(90deg, #ff4d4d, #ff1a1a); }
.mss84-bar.dead{ opacity:.6; }
.mss84-badge{ font-size:10px; padding:2px 6px; border-radius:100px; background:#222; color:#ddd; }
.mss84-badge--dead{ background:#333; color:#ff8b8b; border:1px solid #444; }

.mss84-armor-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
.mss84-armor-card{ border:1px solid var(--line); border-radius:12px; padding:10px; background:#0e0e0e; }
.mss84-armor-card h5{ margin:0 0 8px; font-size:13px; color:#eee; }

/* Equipment boards */
.crit-wrap{ border:1px dashed #2a2a2a; border-radius:10px; padding:10px; background:#101010; }
.crit-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0 8px; }
.crit-grid{ display:grid; grid-template-columns: repeat(6, 1fr); gap:6px; }
.crit-slot{
  position:relative; padding:8px 6px; text-align:center; font-size:12px; border:1px solid #2a2a2a;
  background:#151515; border-radius:8px; user-select:none; min-height:36px; color:#cfcfcf;
  display:flex; align-items:center; justify-content:center;
  overflow:hidden;           /* NEW: allow inner text to clip */
  min-width:0;               /* NEW: enable flex shrink for ellipsis */
}
.crit-slot .snum{ position:absolute; top:2px; left:6px; font-size:10px; color:#888; }
.crit-slot .stag{
  flex:1;                    /* NEW: take available space */
  min-width:0;               /* NEW: allow shrink */
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  opacity:.95;
}
.crit-slot.unocc{ opacity:.35; filter:saturate(.7); }
.crit-slot.occ{ cursor:pointer; }
.crit-slot.hit{ border-color:#5a1a1a; background:#2a1111; box-shadow: inset 0 0 0 1px #5a1a1a; }
.crit-legend{ font-size:11px; color:#aaa; margin-top:6px; }
.crit-slot{ padding-right:18px; }
.crit-slot .stag{ display:block; width:100%; }
.crit-del{
  display:none; /* disabled: we don't support removing compiler-driven items */
}
.crit-grid{ grid-auto-rows:36px; }
.crit-grid > *{ min-width:0; }  /* NEW */

/* Heat */
.mss84-heat{ width:100%; }
.mss84-heat__hdr{ display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#ddd; margin-bottom:6px; }
.mss84-heat__meter{ position:relative; height:12px; background:#1b1b1b; border-radius:100px; overflow:hidden; border:1px solid #222; }
.mss84-heat__fill{ position:absolute; top:0; left:0; height:100%; width:0%; }
.mss84-heat.ok   .mss84-heat__fill{ background:linear-gradient(90deg,#2bd93f,#a3ff00); }
.mss84-heat.crit .mss84-heat__fill{ background:linear-gradient(90deg,#ff8c00,#ffd000); }
.mss84-heat.low  .mss84-heat__fill{ background:linear-gradient(90deg,#ff4d4d,#ff1a1a); }
.mss84-heat__ticks{ position:absolute; inset:0; pointer-events:none; }
.mss84-heat__tick{ position:absolute; top:0; bottom:0; width:1px; background:#333; opacity:.8; }
.mss84-heat__legend{ margin-top:6px; display:flex; justify-content:flex-end; }
.mss84-two{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.mss84-three{ display:grid; grid-template-columns: 2fr 1fr 1fr; gap:8px; }
.mss84-four{ display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px; }
.mss84-seven{ display:grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1fr; gap:0px; }
.mss84-heatf{ display:grid; grid-template-columns: 2.7fr .9fr .9fr; gap:2px; }

/* ===== WEAPONS TAB (5×2 + Disabled at bottom-right) ===== */
.weap-list{
  border:1px dashed #2a2a2a; border-radius:10px; padding:10px; background:#101010;
}

/* 6 columns so bottom row can have AMMO MAX (col5) + DISABLED (col6) */
.weap-head, .weap-row{
  display:grid;
  grid-template-columns: 1.2fr .9fr .6fr .6fr .8fr .6fr; /* Name | Type | DMG | HEAT | Ammo Cur | Disabled col */
  grid-auto-rows:auto;
  gap:6px 8px; align-items:center; width:100%;
}

/* row assignment: first 5 → row 1; 6..11 → row 2 */
.weap-head > *:nth-child(-n+5),
.weap-row  > *:nth-child(-n+5){ grid-row:1; }
.weap-head > *:nth-child(n+6),
.weap-row  > *:nth-child(n+6){ grid-row:2; }

/* put AMMO MAX (10th) in col 5; DISABLED (11th) in col 6 */
.weap-head > *:nth-child(10),
.weap-row  > *:nth-child(10){ grid-column:5; }
.weap-head > *:nth-child(11),
.weap-row  > *:nth-child(11){ grid-column:6; justify-self:end; }

/* visuals */
.weap-head{ color:#aaa; font-size:12px; margin-bottom:6px; }
.weap-row{
  background:#141414; border:1px solid #1f1f1f; border-radius:8px; padding:8px 10px; margin-bottom:6px;
}
.weap-head > *, .weap-row > *{ min-width:0; }
.weap-row > :nth-child(1), .weap-head > :nth-child(1){ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* center numeric inputs */
.weap-row input[type="number"], .weap-row input[type="text"][data-num]{ width:100%; text-align:center; }

/* read-only (everything except Ammo Cur + Disabled + allow name hover) */
.weap-row.readonly input[type="text"][data-k="type"],
.weap-row.readonly input[type="text"][data-k="dmg"],
.weap-row.readonly input[type="number"][data-k="heat"],
.weap-row.readonly input[type="number"][data-k="min"],
.weap-row.readonly input[type="number"][data-k="s"],
.weap-row.readonly input[type="number"][data-k="m"],
.weap-row.readonly input[type="number"][data-k="l"]{
  pointer-events:none; opacity:.85;
}

/* keep name hoverable + show help cursor */
.weap-row input[data-k="name"]{ pointer-events:auto; cursor:help; }

.weap-del{ display:none; }



`;

  const PANEL_HTML = `
<div class="mss84-sheet">
  <aside class="mss84-sheet__wrap" id="sheetWrap" aria-hidden="true">
    <header class="mss84-sheet__hdr">
      <div class="mss84-sheet__title">Mech Sheet <span id="savePulse" class="mss84-savepulse">Saved</span></div>
      <div class="mss84-sheet__spacer"></div>
      <button class="mss84-sheet__x" id="loadFromJsonBtn" title="Legacy: resolve from /data JSON">Load from JSON</button>
      <button class="mss84-sheet__x" id="sheetCloseBtn">Close</button>
    </header>

    <nav class="mss84-sheet__tabs" id="sheetTabs">
      <div class="mss84-sheet__tab active" data-tab="status">Status</div>
      <div class="mss84-sheet__tab" data-tab="weapons">Weapons</div>
      <div class="mss84-sheet__tab" data-tab="armor">Armor</div>
      <div class="mss84-sheet__tab" data-tab="equip">Equipment</div>
      <div class="mss84-sheet__tab" data-tab="notes">Notes</div>
    </nav>

    <div class="mss84-sheet__body">

      <section class="mss84-sheet__panel active" data-panel="status">
        <div class="mss84-sheet__group">
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label for="pilotName">Pilot</label><input id="pilotName" type="text" placeholder="Name"></div>
            <div class="mss84-sheet__field"><label for="pilotCall">Callsign</label><input id="pilotCall" type="text" placeholder="Callsign"></div>
          </div>
          <div class="mss84-three">
            <div class="mss84-sheet__field"><label for="pilotFaction">Team</label><input id="pilotFaction" type="text" placeholder="House / Clan"></div>
            <div class="mss84-sheet__field"><label for="pilotG">Gunnery</label><input id="pilotG" type="number" min="0" max="12" value="4"></div>
            <div class="mss84-sheet__field"><label for="pilotP">Piloting</label><input id="pilotP" type="number" min="0" max="12" value="5"></div>
          </div>

          <div class="mss84-three" style="margin-top:6px;">
            <div class="mss84-sheet__field"><label for="mechChassis">Chassis</label><input id="mechChassis" type="text" placeholder="Marauder" readonly></div>
            <div class="mss84-sheet__field"><label for="mechVariant">Variant</label><input id="mechVariant" type="text" placeholder="MAD-3R" readonly></div>
            <div class="mss84-sheet__field"><label for="mechTons">Tonnage</label><input id="mechTons" type="number" min="10" max="200" step="5" placeholder="—" readonly></div>
          </div>

          <div class="mss84-four" style="margin-top:6px;">
            <div class="mss84-sheet__field"><label>Stand</label><input id="mvStand" type="number" min="0" max="12" value="0" readonly></div>
            <div class="mss84-sheet__field"><label>Walk +1</label><input id="mvWalk" type="number" min="0" max="24" value="4" readonly></div>
            <div class="mss84-sheet__field"><label>Run +2</label><input id="mvRun" type="number" min="0" max="24" value="6" readonly></div>
            <div class="mss84-sheet__field"><label>Jump +3</label><input id="mvJump" type="number" min="0" max="24" value="0" readonly></div>
          </div>
        </div>

        <div class="mss84-sheet__group">
          <div class="mss84-heatf">
            <div class="mss84-sheet__field"><label>Effect</label><input id="heatEffect" type="text" placeholder="Heat Systems Stable" readonly></div>
            <div class="mss84-sheet__field"><label>Current</label><input id="heatCur" type="number" min="-10" max="99" value="0"></div>
            <div class="mss84-sheet__field"><label>Sinks</label><input id="heatSinks" type="number" min="0" max="99" value="10" readonly></div>
          </div>
          <div class="mss84-sheet__field"><label>Heat Meter</label>
            <div id="heatBar" class="mss84-heat">
              <div class="mss84-heat__meter">
                <div id="heatFill" class="mss84-heat__fill" style="width:0%"></div>
                <div id="heatTicks" class="mss84-heat__ticks"></div>
              </div>
              <div class="mss84-heat__legend hint"><span id="heatLegend">0 / 30</span></div>
            </div>
          </div>
        </div>

        <div class="mss84-sheet__group">
          <div class="mss84-bars" id="barsGrid"></div>
          <div class="hint" style="margin-top:6px;">Click a bar to jump to that location in the Armor tab.</div>
        </div>
      </section>

      <section class="mss84-sheet__panel" data-panel="armor">
        <div class="hint" style="margin:8px 0;">Enter <b>Current</b>. Max values are locked from compiler. Rear applies to LT/CT/RT only.</div>
        <div class="mss84-armor-grid" id="armorGrid"></div>
      </section>

      <section class="mss84-sheet__panel" data-panel="equip">
        <div class="crit-wrap">
          <div class="crit-head"></div>
          <div id="critBoards"></div>
          <div class="crit-legend">Tap a filled slot to toggle a <b>crit hit mark</b>. Loadout comes from compiler; no adds/removes here.</div>
        </div>
      </section>

      <section class="mss84-sheet__panel" data-panel="weapons">
        <div class="weap-list">
          <div class="weap-head">
  <div class="hint">NAME</div>
  <div class="hint">TYPE</div>
  <div class="hint">DMG</div>
  <div class="hint">HEAT</div>
  <div class="hint">AMMO CUR</div>
  <div class="hint">MIN</div>
  <div class="hint">SHORT</div>
  <div class="hint">MED</div>
  <div class="hint">LONG</div>
  <div class="hint">AMMO MAX</div>
  <div class="hint">X</div>
</div>

          <div id="weapRows"></div>
          <div class="hint">Weapons & ranges are compiler-driven. Change only current ammo and toggle On/Off.</div>
        </div>
      </section>

      <section class="mss84-sheet__panel" data-panel="notes">
        <div class="mss84-sheet__group">
          <h4>Notes</h4>
          <textarea id="notes" rows="8" placeholder="Freeform notes…"></textarea>
        </div>
        <div class="mss84-two">
          <button class="mss84-sheet__x" id="clearThisToken" style="background:#2a1414;border:1px solid #3a1c1c;">Clear This Token</button>
          <div class="hint">Removes saved sheet for the current Map/Token only (user-state data).</div>
        </div>
      </section>

    </div>
  </aside>
</div>
`;

  // ---------- Constants & Helpers ----------
  const LOCS = ['HD','LA','RA','LT','CT','RT','LL','RL'];
  const HAS_REAR = new Set(['LT','CT','RT']);
  const SLOTS_PER_LOC = 18;
  const STORAGE_NS = 'mss84:sheet';
  const HEAT_MAX_DEFAULT = 30;
  const HEAT_TICKS = [5,10,15,20,25,30];

  const clampInt = (v, lo, hi) => {
    let n = parseInt(v,10);
    if (!Number.isFinite(n)) n = 0;
    if (n<lo) n=lo; if (n>hi) n=hi;
    return n;
  };
  const clampNum = (v, lo, hi) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    if (n<lo) n=lo; if (n>hi) n=hi;
    return n;
  };
  const escapeHtml = s => (''+s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const key = (map, tok) => `${STORAGE_NS}:${map}:${tok}`;

  const LAST_IDS_KEY = 'mss84:sheet:lastIds';   // NEW


  
  // ---------- Core state ----------
  function blankSheet(){
    const armor = {};
    for(const L of LOCS){
      armor[L] = { ext:{cur:0,max:0}, rear: HAS_REAR.has(L) ? {cur:0,max:0} : null, str:{cur:0,max:0} };
    }
    const crits = {};
    for(const L of LOCS){
      crits[L] = Array.from({length:SLOTS_PER_LOC}, ()=>({occ:false, hit:false, label:'', itemId:null}));
    }
    return {
      version:8,
      pilot:{name:'',callsign:'',faction:'',gunnery:4,piloting:5},
      move:{stand:0,walk:0,run:0,jump:0},
      heat:{current:0,sinks:10,effect:''},
      armor,
      crits,
      notes:'',
      weapons:[],     // compiler seeded
      nextWid:1,
      mech:{ chassis:'', variant:'', tonnage:0, bv:0 },
      _seededFromCompiler:false
    };
  }

  function migrate(d){
    // simple forward-safe migration
    if (!d.version) d.version = 1;
    if (!d.mech) d.mech = { chassis:'', variant:'', tonnage:0, bv:0 };
    if (!Array.isArray(d.weapons)) d.weapons = [];
    if (!Number.isFinite(d.nextWid)) d.nextWid = 1;
    for(const L of LOCS){
      if(!d.armor[L]) d.armor[L] = { ext:{cur:0,max:0}, rear: HAS_REAR.has(L) ? {cur:0,max:0} : null, str:{cur:0,max:0} };
      if(!Array.isArray(d.crits?.[L])){
        if(!d.crits) d.crits={};
        d.crits[L] = Array.from({length:SLOTS_PER_LOC}, ()=>({occ:false, hit:false, label:'', itemId:null}));
      }
    }
    if (d.version < 8) d.version = 8;
    return d;
  }

  function save(map, tok, data){
    try{ localStorage.setItem(key(map,tok), JSON.stringify(data)); pulseSaved(); }
    catch(e){ console.warn('save fail', e); }
  }
  function load(map, tok){
    try{
      const raw = localStorage.getItem(key(map,tok));
      if(!raw) return blankSheet();
      return migrate(JSON.parse(raw));
    }catch(e){ console.warn('load fail', e); return blankSheet(); }
  }
  function remove(map, tok){ try{ localStorage.removeItem(key(map,tok)); }catch{} }

function markDirty(map, tok){
  const dirtyKey = `mss84:sheets:dirty:${map}`;
  let m = {};
  try { m = JSON.parse(localStorage.getItem(dirtyKey) || '{}'); } catch {}
  m[tok] = 1;
  try { localStorage.setItem(dirtyKey, JSON.stringify(m)); } catch {}
}
  
  function rememberIds(map, tok){
    try{ localStorage.setItem(LAST_IDS_KEY, JSON.stringify({ mapId:map, tokenId:tok })); }catch{}
  }

  
  // ---------- Mount ----------
  function ensureStyles(){
    if (!document.getElementById(CSS_ID)) {
      const style = document.createElement('style');
      style.id = CSS_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }

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
    const btnClose  = QS('#sheetCloseBtn');
    const btnLoad   = QS('#loadFromJsonBtn');
    const tabs      = QS('#sheetTabs');
    const savePulse = QS('#savePulse');

    const fPilot = {
      name:QS('#pilotName'), call:QS('#pilotCall'), faction:QS('#pilotFaction'),
      g:QS('#pilotG'), p:QS('#pilotP')
    };
    const fMech = { chassis:QS('#mechChassis'), variant:QS('#mechVariant'), tons:QS('#mechTons') };
    const fMove = { stand:QS('#mvStand'), walk:QS('#mvWalk'), run:QS('#mvRun'), jump:QS('#mvJump') };
    const fHeat = { cur:QS('#heatCur'), sinks:QS('#heatSinks'), eff:QS('#heatEffect') };
    const heatBarEl   = QS('#heatBar'), heatFillEl  = QS('#heatFill'),
          heatTicksEl = QS('#heatTicks'), heatLegend  = QS('#heatLegend');

    const barsGrid  = QS('#barsGrid');
    const armorGrid = QS('#armorGrid');
    const critBoards= QS('#critBoards');

    const weapRows  = QS('#weapRows');
    const notes     = QS('#notes');
    const clearThis = QS('#clearThisToken');

// --- Pilot / team / skills → sheet + save
fPilot.name.addEventListener('input',   () => { sheet.pilot.name     = fPilot.name.value.trim(); scheduleSave(); });
fPilot.call.addEventListener('input',   () => { sheet.pilot.callsign = fPilot.call.value.trim(); scheduleSave(); });
fPilot.faction.addEventListener('input',() => { sheet.pilot.faction  = fPilot.faction.value.trim(); scheduleSave(); });
fPilot.g.addEventListener('input',      () => { sheet.pilot.gunnery  = clampInt(fPilot.g.value, 1, 6); scheduleSave(); });
fPilot.p.addEventListener('input',      () => { sheet.pilot.piloting = clampInt(fPilot.p.value, 1, 6); scheduleSave(); });
notes.addEventListener('input', () => { sheet.notes = notes.value; scheduleSave(); });
    
    // open/close
    const open = (ids)=>{                      // NEW: optional ids
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
      wrap.classList.add('open'); wrap.setAttribute('aria-hidden','false');
    };
    const close  = ()=>{ wrap.classList.remove('open'); wrap.setAttribute('aria-hidden','true'); };
    const toggle = ()=> (wrap.classList.contains('open')? close() : open());

    btnClose.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    // tabs
    tabs.addEventListener('click', (e)=>{
      const tab = e.target.closest('.mss84-sheet__tab'); if(!tab) return;
      QSA('.mss84-sheet__tab', tabs).forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute('data-tab');
      QSA('.mss84-sheet__panel').forEach(p=>{
        p.classList.toggle('active', p.getAttribute('data-panel')===name);
      });
    });

    // save debounce
let tSave = null;
const scheduleSave = () => {
  clearTimeout(tSave);
  tSave = setTimeout(() => {
    save(mapId, tokenId, sheet);
    rememberIds(mapId, tokenId);
    markDirty(mapId, tokenId);           // <— NEW
  }, 200);
};
    window.pulseSaved = ()=>{ if(!savePulse) return; savePulse.classList.add('show'); setTimeout(()=>savePulse.classList.remove('show'), 600); };

    // ---- Heat ----
    const HEAT_TBL = [
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
    const heatEffectText = (cur)=>{
      const row = HEAT_TBL.find(([th])=> cur >= th);
      return row ? row[1] : "";
    };
    const renderHeatTicks = (max)=>{
      if (!heatTicksEl) return;
      heatTicksEl.innerHTML = '';
      HEAT_TICKS.forEach(v=>{
        if (v > max) return;
        const tick = document.createElement('div');
        tick.className = 'mss84-heat__tick';
        tick.style.left = ((v / max) * 100) + '%';
        heatTicksEl.appendChild(tick);
      });
    };
    const renderHeatBar = ()=>{
      const cur   = clampInt(fHeat.cur.value,   -10, 999);
      const sinks = clampInt(fHeat.sinks.value, 0, 999);
      const max   = Math.max(HEAT_MAX_DEFAULT, sinks, cur);
      const pct   = max > 0 ? Math.min(1, Math.max(0, cur / max)) : 0;
      const sev   = (cur <= sinks) ? 'ok' : (cur <= sinks + 10 ? 'crit' : 'low');
      if (heatLegend)  heatLegend.textContent  = `${cur} / ${max} (sinks ${sinks})`;
      if (heatFillEl)  heatFillEl.style.width = (pct * 100).toFixed(1) + '%';
      if (heatBarEl){
        heatBarEl.classList.remove('ok','crit','low');
        heatBarEl.classList.add(sev);
      }
      fHeat.eff.value = heatEffectText(cur);
      sheet.heat.effect = fHeat.eff.value;
      scheduleSave();
      renderHeatTicks(max);
    };
    fHeat.cur.addEventListener('input', ()=>{ sheet.heat.current = clampInt(fHeat.cur.value, -10, 999); renderHeatBar(); });

    // ---- Bars / Armor ----
    const computeTotals = (L)=>{
      const a = sheet.armor[L];
      const ext = a.ext||{cur:0,max:0};
      const rear = a.rear||{cur:0,max:0};
      const str = a.str||{cur:0,max:0};
      const cur = (ext.cur||0)+(rear.cur||0)+(str.cur||0);
      const max = (ext.max||0)+(rear.max||0)+(str.max||0);
      const pct = max>0 ? Math.max(0, Math.min(1, cur/max)) : 0;
      const destroyed = (str.cur||0) <= 0 && (str.max||0) > 0;
      return {cur,max,pct,destroyed};
    };
    const barSeverity = (pct)=> (pct>=.66?'ok':(pct>=.33?'crit':'low'));
    const renderBars = ()=>{
      barsGrid.innerHTML = '';
      for(const L of LOCS){
        const t = computeTotals(L);
        const sev = barSeverity(t.pct);
        const div = document.createElement('div');
        div.className = 'mss84-bar'+(t.destroyed?' dead':'')+(sev==='crit'?' crit':'')+(sev==='low'?' low':'');
        div.setAttribute('data-loc', L);
        div.innerHTML = `
          <div class="mss84-bar__hdr">
            <span>${L}</span>
            <span class="mss84-badge ${t.destroyed?'mss84-badge--dead':''}">
              ${t.max?`${t.cur}/${t.max}`:'— / —'} ${t.destroyed?' • DESTROYED':''}
            </span>
          </div>
          <div class="mss84-bar__meter"><div class="mss84-bar__fill" style="width:${(t.pct*100).toFixed(1)}%"></div></div>
        `;
        div.addEventListener('click', ()=>{
          QSA('.mss84-sheet__tab', tabs).forEach(t=>t.classList.toggle('active', t.getAttribute('data-tab')==='armor'));
          QSA('.mss84-sheet__panel').forEach(p=>p.classList.toggle('active', p.getAttribute('data-panel')==='armor'));
          const card = root.querySelector(`.mss84-armor-card[data-loc="${L}"]`);
          if(card){ card.scrollIntoView({behavior:'smooth',block:'center'}); card.classList.add('pulse'); setTimeout(()=>card.classList.remove('pulse'), 600); }
        });
        barsGrid.appendChild(div);
      }
    };

    const renderArmor = ()=>{
      armorGrid.innerHTML = '';
      for(const L of LOCS){
        const hasRear = HAS_REAR.has(L);
        const a = sheet.armor[L];
        const card = document.createElement('div');
        card.className = 'mss84-armor-card'; card.setAttribute('data-loc', L);
        card.innerHTML = `
          <h5>${L}</h5>
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label>Ext Cur</label><input type="number" data-k="ext.cur" value="${a.ext.cur||0}"></div>
            <div class="mss84-sheet__field"><label>Ext Max</label><input type="number" value="${a.ext.max||0}" readonly></div>
          </div>
          ${hasRear?`
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label>Rear Cur</label><input type="number" data-k="rear.cur" value="${a.rear.cur||0}"></div>
            <div class="mss84-sheet__field"><label>Rear Max</label><input type="number" value="${a.rear.max||0}" readonly></div>
          </div>`:''}
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label>Struct Cur</label><input type="number" data-k="str.cur" value="${a.str.cur||0}"></div>
            <div class="mss84-sheet__field"><label>Struct Max</label><input type="number" value="${a.str.max||0}" readonly></div>
          </div>
        `;
        Array.from(card.querySelectorAll('input[data-k]')).forEach(inp=>{
          inp.addEventListener('input', ()=>{
            const [p1,p2] = inp.getAttribute('data-k').split('.');
            const v = clampInt(inp.value, -99, 999);
            sheet.armor[L][p1][p2] = v;
            scheduleSave();
            renderBars();
          });
        });
        armorGrid.appendChild(card);
      }
    };

    // ---- Equipment (read-only occupancy, toggle hit marks) ----
    function clearAllOccupancy(state=sheet){
      for(const L of LOCS){
        state.crits[L].forEach(s=>{ s.occ=false; s.label=''; s.itemId=null; /* keep s.hit */ });
      }
    }
    function packEquipmentFromCompiler(vm, state=sheet){
      // Fill by location order, assign labels into crit grid. No deletes; no adds.
      const byLoc = vm?.equipmentByLocation || {};
      for(const L of LOCS){
        const list = Array.isArray(byLoc[L]) ? byLoc[L] : [];
        const slots = state.crits[L];
        let ptr = 0;
        for(const label of list){
          // each item consumes 1 slot visually (we don't know exact slot counts from compiler here)
          // If you later provide slot counts, adjust here.
          while(ptr<slots.length && slots[ptr].occ) ptr++;
          if(ptr>=slots.length) break;
          const id = state.mech.variant ? (state.mech.variant + ':' + label) : label;
          slots[ptr].occ = true; slots[ptr].label = String(label||''); slots[ptr].itemId = id;
          ptr++;
        }
      }
    }

    function renderCritBoards(){
      critBoards.innerHTML = '';
      for(const L of LOCS){
        const wrapDiv = document.createElement('div');
        wrapDiv.style.marginBottom = '12px';

        const head = document.createElement('div');
        head.className = 'crit-head';
        const occ = sheet.crits[L].filter(s=>s.occ).length;
        const hits = sheet.crits[L].filter(s=>s.hit).length;
        head.innerHTML = `
          <div><strong>${L}</strong> <span class="mss84-badge">${occ}/${SLOTS_PER_LOC} occupied • ${hits} hit</span></div>
          <div style="display:flex; gap:6px;">
            <span class="hint">Compiler loadout (read-only)</span>
          </div>
        `;
        wrapDiv.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'crit-grid';

        sheet.crits[L].forEach((slot, i)=>{
          const div = document.createElement('div');
          div.className = 'crit-slot ' + (slot.occ?'occ':'unocc') + (slot.hit?' hit':'');
          const label = (slot.label||'').trim();
          div.title = label || `Empty (${L} ${i+1})`;
          div.innerHTML = `
            <span class="snum">${i+1}</span>
            <span class="stag">${escapeHtml(label)}</span>
          `;
          if (slot.occ){
            div.addEventListener('click', ()=>{
              slot.hit = !slot.hit;
              scheduleSave(); renderCritBoards();
            });
          }
          grid.appendChild(div);
        });
        wrapDiv.appendChild(grid);
        critBoards.appendChild(wrapDiv);
      }
    }

    // ---- Weapons (read-only except ammo cur + on/off) ----
    function renderWeapons(){
      if (!weapRows) return;
      weapRows.innerHTML='';
      (sheet.weapons||[]).forEach((w, idx)=>{
        const row = document.createElement('div');
        row.className = 'weap-row readonly';
        const on = (w._on !== false); // default ON
        if ((w.type === 'Melee') &&
    (w.meta?.fromEquipment || w._scaleMelee || /(hatchet|sword|mace|axe|claw|club|punch|kick|dfa|charge)/i.test(w.name||''))) {
  const ton = Number(sheet?.mech?.tonnage ?? sheet?.tonnage ?? 0);
  const dmg = calcMeleeDamage(w.name, ton);
  w.dmg = String(dmg);
}
row.innerHTML = `
  <!-- row 1 -->
<input type="text" data-k="name" readonly
  value="${escapeHtml(w.name||'')}"
  title="${escapeHtml([
    `Name: ${w.name||'—'}`,
    w.type ? `Type: ${w.type}` : null,
    (w.dmg ?? w.dmg === 0) ? `DMG: ${w.dmg}` : null,
    (w.heat ?? w.heat === 0) ? `Heat: ${w.heat}` : null,
    (w.min ?? w.min === 0) ? `Min: ${w.min}` : null,
    (w.s   ?? w.s   === 0) ? `Short: ${w.s}` : null,
    (w.m   ?? w.m   === 0) ? `Med: ${w.m}` : null,
    (w.l   ?? w.l   === 0) ? `Long: ${w.l}` : null,
    (w.ammo?.max ? `Ammo: ${w.ammo.cur||0}/${w.ammo.max}` : null)
  ].filter(Boolean).join('\n'))}">

  <input type="text"   data-k="type"  value="${escapeHtml(w.type||'')}"  title="Type"  readonly>
  <input type="text"   data-k="dmg"   value="${escapeHtml(w.dmg ?? '')}" title="DMG"   readonly>
  <input type="number" data-k="heat"  value="${Number(w.heat||0)}" min="0" title="Heat" readonly>
  <input type="number" data-k="ammo.cur" value="${Number(w?.ammo?.cur ?? 0)}" min="0" title="Ammo Current">

  <!-- row 2 -->
  <input type="number" data-k="min"  value="${Number(w.min||0)}" min="0" title="Min" readonly>
  <input type="number" data-k="s"    value="${Number(w.s||0)}"   min="0" title="Short" readonly>
  <input type="number" data-k="m"    value="${Number(w.m||0)}"   min="0" title="Med" readonly>
  <input type="number" data-k="l"    value="${Number(w.l||0)}"   min="0" title="Long" readonly>
  <input type="number" data-k="ammo.max" value="${Number(w?.ammo?.max ?? 0)}" min="0" title="Ammo Max">
  <input type="checkbox" class="weap-disabled" data-idx="${idx}" ${w._on===false?'checked':''} title="Disabled">
`;

// current ammo editable
const ammoCur = row.querySelector('input[data-k="ammo.cur"]');
ammoCur?.addEventListener('input', ()=>{
  if (!w.ammo) w.ammo = {cur:0, max: Number(w?.ammo?.max ?? 0)};
  w.ammo.cur = clampNum(ammoCur.value, 0, 999);
  scheduleSave();
});

// AMMO MAX editable + clamp CUR if it exceeds MAX
const ammoMaxEl = row.querySelector('input[data-k="ammo.max"]');
ammoMaxEl?.addEventListener('input', ()=>{
  if (!w.ammo) w.ammo = { cur: 0, max: 0 };
  w.ammo.max = clampNum(ammoMaxEl.value, 0, 999);
  // clamp current to new max
  if (w.ammo.cur > w.ammo.max) {
    w.ammo.cur = w.ammo.max;
    const curEl = row.querySelector('input[data-k="ammo.cur"]');
    if (curEl) curEl.value = w.ammo.cur;
  }
  scheduleSave();
});

function calcMeleeDamage(name, tonnage){
  const t = Math.max(10, Math.min(100, Math.round(Number(tonnage)||0)));
  const n = (name||'').toLowerCase();

  // Core BT melee
  if (n.includes('punch')) return Math.ceil(t/10);
  if (n.includes('kick'))  return Math.ceil(t/5);
  if (n.includes('dfa'))   return Math.ceil(t/5);
  if (n.includes('charge'))return Math.ceil(t/10);

  // Equipment melee (treat like hatchet/sword class)
  if (/(hatchet|sword|mace|axe|claw|club)/i.test(n)) return Math.ceil(t/5);

  // Default: treat unknown melee like punch
  return Math.ceil(t/10);
}
        
        
// disabled toggle (invert to _on flag)
const dis = row.querySelector('.weap-disabled');
dis?.addEventListener('input', ()=>{
  w._on = !dis.checked;   // unchecked = ON, checked = DISABLED
  scheduleSave();
});

        weapRows.appendChild(row);
      });
    }

    // ---- Hydration ----
    function hydrateAll(){
      fPilot.name.value = sheet.pilot.name||'';
      fPilot.call.value = sheet.pilot.callsign||'';
      fPilot.faction.value = sheet.pilot.faction||'';
fPilot.g.value       = clampInt(sheet.pilot.gunnery,  1, 6);
fPilot.p.value       = clampInt(sheet.pilot.piloting, 1, 6);

      fMove.stand.value = sheet.move.stand??0;
      fMove.walk.value  = sheet.move.walk??0;
      fMove.run.value   = sheet.move.run ??0;
      fMove.jump.value  = sheet.move.jump??0;

      fHeat.cur.value   = sheet.heat.current??0;
      fHeat.sinks.value = sheet.heat.sinks??10;
      fHeat.eff.value   = sheet.heat.effect||'';
      renderHeatBar();

      if (fMech.chassis) fMech.chassis.value = sheet.mech?.chassis || '';
      if (fMech.variant) fMech.variant.value = sheet.mech?.variant || '';
      if (fMech.tons)    fMech.tons.value    = sheet.mech?.tonnage ?? '';

      renderBars(); renderArmor(); renderCritBoards(); renderWeapons();
    }

    // ---- Bind user fields (non-stable) ----
    function bindField(inp, obj, key){
      const handler = ()=>{ 
        obj[key] = (inp.type==='number') ? clampInt(inp.value, -99, 999) : inp.value;
        scheduleSave(); 
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);    // NEW (mobile/autofill safety)
    }

    bindField(fPilot.name, sheet.pilot, 'name');
    bindField(fPilot.call, sheet.pilot, 'callsign');
    bindField(fPilot.faction, sheet.pilot, 'faction');
    bindField(fPilot.g, sheet.pilot, 'gunnery');
    bindField(fPilot.p, sheet.pilot, 'piloting');
    notes?.addEventListener('input', ()=>{ sheet.notes = notes.value; scheduleSave(); });

    clearThis?.addEventListener('click', ()=>{
      if(confirm('Clear saved sheet (user data) for this Map/Token?')){
        remove(mapId, tokenId);
        sheet = blankSheet();
        hydrateAll(); scheduleSave();
      }
    });

    // ---- Compiler integration ----
    async function hydrateFromCompiler(){
      if (!window.MSS84_COMPILER?.resolveForToken) return false;
      try{
        const vm = await window.MSS84_COMPILER.resolveForToken(mapId, tokenId);
        if (!vm) return false;

        // Identity
        sheet.mech.chassis = vm.name || sheet.mech.chassis;
        sheet.mech.variant = vm.variant || sheet.mech.variant;
        sheet.mech.tonnage = Number(vm.tonnage||0) || sheet.mech.tonnage;
        sheet.mech.bv      = Number(vm.bv||0)      || sheet.mech.bv;

        // Movement
        sheet.move.walk = Number(vm?.movement?.walk || 0);
        sheet.move.run  = Number(vm?.movement?.run  || 0);
        sheet.move.jump = Number(vm?.movement?.jump || 0);

        // Heat sinks
        const sinksRaw = (vm.heatSinks ?? 0);
        const sinks = (typeof sinksRaw === 'string') ? (parseInt(sinksRaw,10) || 0) : (Number(sinksRaw)||0);
        sheet.heat.sinks = sinks || sheet.heat.sinks;

        // Armor max + internals (structure)
        for(const L of LOCS){
          const max = vm.armorMax?.[L] || { f:0, r:0 };
          const str = Number(vm.internals?.[L] ?? 0) || 0;
          sheet.armor[L].ext.max = Number(max.f||0);
          if (sheet.armor[L].rear) sheet.armor[L].rear.max = Number(max.r||0);
          sheet.armor[L].str.max = str;
          // Initialize currents if zero
          if (!(sheet.armor[L].ext.cur > 0))  sheet.armor[L].ext.cur  = sheet.armor[L].ext.max;
          if (sheet.armor[L].rear && !(sheet.armor[L].rear.cur > 0)) sheet.armor[L].rear.cur = sheet.armor[L].rear.max;
          if (!(sheet.armor[L].str.cur > 0))  sheet.armor[L].str.cur  = sheet.armor[L].str.max;
        }

        // Weapons (overwrite list; keep ammo.cur from existing where names match)
        const oldByName = new Map((sheet.weapons||[]).map(w=>[String(w.name||'').toLowerCase(), w]));
        sheet.weapons = [];
        sheet.nextWid = 1;
        const pushW = (src, isMelee=false)=>{
          const name = String(src.name||'').trim();
          const key  = name.toLowerCase();
          const prev = oldByName.get(key);
          const ammoMax = (isMelee ? 0 : (Number(src.ammoMax??0)||0));
          const w = {
            wid: sheet.nextWid++,
            name,
            type: src.type || (isMelee?'Melee':''),
            dmg:  (src.damage===0 || src.damage) ? src.damage : '',
            heat: Number(src.heat||0) || 0,
            min:  Number(src?.range?.min    || 0) || 0,
            s:    Number(src?.range?.short  || 0) || 0,
            m:    Number(src?.range?.medium || 0) || 0,
            l:    Number(src?.range?.long   || 0) || 0,
            ammo: { cur: prev?.ammo?.cur ?? (isMelee?0:ammoMax), max: ammoMax },
            _on:  prev?._on ?? (src.enabledDefault!==false)
          };
          sheet.weapons.push(w);
        };
        (Array.isArray(vm.melee)?vm.melee:[]).forEach(m=> pushW(m, true));
        (Array.isArray(vm.weapons)?vm.weapons:[]).forEach(w=> pushW(w, false));

        // Equipment (read-only; pack labels to crit boards)
        clearAllOccupancy(sheet);
        packEquipmentFromCompiler(vm, sheet);

sheet._seededFromCompiler = true;
        save(mapId, tokenId, sheet);
        try{ localStorage.setItem(LAST_IDS_KEY, JSON.stringify({ mapId, tokenId })); }catch{}  // NEW
        hydrateAll();
        return true;
      }catch(e){
        console.warn('[SHEET] Compiler resolve failed:', e);
        return false;
      }
    }

    // Legacy loader button (optional fallback)
    btnLoad?.addEventListener('click', async ()=>{
      try{
        if (window.__SHEET_LEGACY_LOAD) {
          await window.__SHEET_LEGACY_LOAD(mapId, tokenId, sheet, (d)=>{ sheet=d; });
          hydrateAll();
        } else {
          alert('Legacy loader not wired in this build.');
        }
      }catch(e){
        console.warn('Legacy load failed', e);
      }
    });

    // initial hydrate
    hydrateAll();

    // API
    const api = {
      open, close, toggle,
            setIds: (map, tok)=>{ 
        mapId = map; tokenId = tok; 
        try{ localStorage.setItem(LAST_IDS_KEY, JSON.stringify({ mapId, tokenId })); }catch{}
        sheet = load(mapId, tokenId); 
        hydrateAll(); 
      },
      getIds: ()=>({ mapId, tokenId }),
      refresh: async ()=>{ await hydrateFromCompiler(); },
      _debug_getSheet: ()=>sheet
    };

// --- NEW: ensureTokenMechRef ------------------------------
async function ensureTokenMechRef(mapId, tokenId, tokenMeta = {}) {
  // Your internal caches – adjust names if different:
  // mechsByToken: Map<string /*mapId*/ , Map<string /*tokenId*/, MechObject>>
  // tokensByMap:  Map<string /*mapId*/, Map<string /*tokenId*/, TokenObject>>
  const byMap = mechsByToken.get(mapId) || new Map();
  if (byMap.has(tokenId)) return byMap.get(tokenId);

  // Try to infer a mech source
  const t = (tokensByMap.get(mapId) || new Map()).get(tokenId) || {};
  const meta = { ...(t.meta || {}), ...(tokenMeta || {}) };

  // Priority 1: explicit mech JSON path saved earlier for this token
  let mechPath = meta.mechPath || localStorage.getItem(`mss84:mechPath:${tokenId}`);

  // Priority 2: a mech id we can resolve via your manifest/lookup
  const mechId = meta.mechId || meta.id || meta.variant || meta.chassis;

  // If we still don't have a path, try recover via "last loaded" path
  if (!mechPath) mechPath = localStorage.getItem('trs80:lastMechPath');

  if (!mechPath && !mechId) return null; // nothing to bind yet

  let mech = null;

  // Resolve by path
  if (mechPath) {
    const res = await fetch(mechPath, { cache: 'no-store' });
    if (res.ok) mech = await res.json();
  }

  // (Optional) Resolve by id if you have a manifest/lookup function:
  if (!mech && mechId && typeof lookupMechById === 'function') {
    mech = await lookupMechById(mechId); // must return mech JSON or null
  }

  if (!mech) return null;

  byMap.set(tokenId, mech);
  mechsByToken.set(mapId, byMap);

  // Remember the path for next time if present
  if (mechPath) localStorage.setItem(`mss84:mechPath:${tokenId}`, mechPath);

  return mech;
}

    
    // expose global convenience
    window.MSS84_SHEET = api;

    // Try immediate compiler hydrate on first mount
    (async ()=>{ await hydrateFromCompiler(); })();

    return api;
  }

  return { mount };
})();

// Optional legacy loader bridge (wired by apps that keep the old JSON path).
// Set window.__SHEET_LEGACY_LOAD = async (mapId, tokenId, sheet, replaceSheetCb) => { ... }
