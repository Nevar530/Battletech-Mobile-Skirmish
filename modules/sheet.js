// modules/sheet.js
// MSS:84 — Sheet Panel (Standalone ES Module)
// Usage (somewhere in your app boot):
//   import { Sheet } from './modules/sheet.js';
//   const api = Sheet.mount(document.body);  // returns control API
//   // api.open(), api.close(), api.setIds(mapId, tokenId), etc.

export const Sheet = (() => {
  /* -------------------------- One-time CSS injection -------------------------- */
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

.mss84-equip{ border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:10px; }
.mss84-equip__hdr{ display:flex; align-items:center; justify-content:space-between; padding:10px; background:#121212; cursor:pointer; }
.mss84-equip__body{ display:block; padding:10px; background:#0e0e0e; border-top:1px solid var(--line); }
.mss84-equip.closed .mss84-equip__body{ display:none; }
.mss84-row{ display:grid; grid-template-columns:1fr 90px 70px 1fr; gap:8px; margin:2px 0; }
.mss84-row__actions{ display:flex; gap:6px; align-items:center; }
.mss84-chip{ font-size:11px; padding:2px 6px; border-radius:10px; background:#191919; border:1px solid #2a2a2a; color:#ccc; }

/* Crit boards */
.crit-wrap{ border:1px dashed #2a2a2a; border-radius:10px; padding:10px; background:#101010; }
.crit-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0 8px; }
.crit-grid{ display:grid; grid-template-columns: repeat(6, 1fr); gap:6px; }
.crit-slot{
  position:relative; padding:8px 6px; text-align:center; font-size:12px; border:1px solid #2a2a2a;
  background:#151515; border-radius:8px; user-select:none; min-height:36px; color:#cfcfcf;
  display:flex; align-items:center; justify-content:center;
}
.crit-slot .snum{ position:absolute; top:2px; left:6px; font-size:10px; color:#888; }
.crit-slot .stag{
  max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  opacity:.95;
}
.crit-slot.unocc{ opacity:.35; filter:saturate(.7); }
.crit-slot.occ{ cursor:pointer; }
.crit-slot.hit{ border-color:#5a1a1a; background:#2a1111; box-shadow: inset 0 0 0 1px #5a1a1a; }
.crit-legend{ font-size:11px; color:#aaa; margin-top:6px; }

/* keep room for ✕ & ellipsis */
.crit-slot{ padding-right:18px; }
.crit-slot .stag{ display:block; width:100%; }

/* tiny per-slot delete */
.crit-del{
  position:absolute; top:2px; right:4px;
  width:16px; height:16px; line-height:16px;
  border:0; border-radius:3px; background:transparent;
  color:#aaa; font-size:12px; cursor:pointer; opacity:.7;
}
.crit-del:hover{ background:#222; color:#fff; opacity:1; }

/* lock slot size */
.crit-grid{ grid-auto-rows:36px; }
.crit-slot{ overflow:hidden; padding-right:18px; }
.crit-slot .stag{ display:block; flex:1; min-width:0; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:center; }

/* Demo harness */
.demo-harness{ padding:8px 12px; border-bottom:1px solid var(--line); background:#101010; display:grid; gap:6px; }
.demo-harness .mss84-two{ align-items:center; }
.demo-harness label{ font-size:12px; color:#ccc; }
.demo-harness .tiny{ font-size:11px; color:#888; }
.mss84-savepulse{ font-size:11px; color:#9fe29f; opacity:0; transition:opacity .2s ease; margin-left:6px; }
.mss84-savepulse.show{ opacity:1; }

/* Scrollbars */
.mss84-sheet__body::-webkit-scrollbar{ width:10px; }
.mss84-sheet__body::-webkit-scrollbar-thumb{ background:#292929; border-radius:10px; }
  
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

/* ===== WEAPONS TAB ===== */
.mss84-weap{ border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:10px; }
.mss84-weap__hdr{ display:flex; align-items:center; justify-content:space-between; padding:10px; background:#121212; cursor:pointer; }
.mss84-weap__body{ display:block; padding:10px; background:#0e0e0e; border-top:1px solid var(--line); }
.mss84-weap.closed .mss84-weap__body{ display:none; }

/* Two-row grid */
.weap-add-grid,
.weap-head,
.weap-row {
  display:grid;
  grid-template-columns: 1.2fr .9fr .6fr .6fr .6fr .6fr .6fr .6fr .8fr .8fr 70px;
  gap:6px;
  align-items:center;
}

.weap-list{ border:1px dashed #2a2a2a; border-radius:10px; padding:10px; background:#101010; }
.weap-head{ color:#aaa; font-size:12px; margin-bottom:6px; }
.weap-row{ background:#141414; border:1px solid #1f1f1f; border-radius:8px; padding:8px; margin-bottom:6px; }
.weap-row input{ padding:6px 8px; }
.weap-del{
  width:28px; height:28px; border:0; border-radius:6px; background:#1f1f1f; color:#bbb; cursor:pointer;
  justify-self:end;
}
.weap-del:hover{ background:#2a2a2a; color:#fff; }
`;

  function ensureStyles() {
    if (!document.getElementById(CSS_ID)) {
      const style = document.createElement('style');
      style.id = CSS_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
  }

  /* ----------------------------- Panel HTML ----------------------------- */
  const PANEL_HTML = `
<div class="mss84-sheet">

  <button class="mss84-sheet__btn" id="sheetToggleBtn">Sheet</button>

  <aside class="mss84-sheet__wrap open" id="sheetWrap" aria-hidden="false">
    <header class="mss84-sheet__hdr">
      <div class="mss84-sheet__title">Mech Sheet <span id="savePulse" class="mss84-savepulse">Saved</span></div>
      <div class="mss84-sheet__spacer"></div>
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
            <div class="mss84-sheet__field"><label for="pilotG">Gunnery</label><input id="pilotG" type="number" min="1" max="6" value="4"></div>
            <div class="mss84-sheet__field"><label for="pilotP">Piloting</label><input id="pilotP" type="number" min="1" max="6" value="5"></div>
          </div>

          <div class="mss84-three" style="margin-top:6px;">
            <div class="mss84-sheet__field"><label for="mechChassis">Chassis</label><input id="mechChassis" type="text" placeholder="Marauder"></div>
            <div class="mss84-sheet__field"><label for="mechVariant">Variant</label><input id="mechVariant" type="text" placeholder="MAD-3R"></div>
            <div class="mss84-sheet__field"><label for="mechTons">Tonnage</label><input id="mechTons" type="number" min="10" max="200" step="5" placeholder="—"></div>
          </div>

          <div class="mss84-seven" style="margin-top:6px;">
            <div class="mss84-sheet__field"><label>Hits Taken</label><div></div></div>
            ${[1,2,3,4,5,6].map(n=>`<div class="mss84-sheet__fieldt"><label for="H${String(n).padStart(2,'0')}">[${String(n).padStart(2,'0')}]</label><input id="H${String(n).padStart(2,'0')}" type="checkbox"></div>`).join('')}
          </div>
          <div class="mss84-seven">
            <div class="mss84-sheet__field"><label>K.O.#</label><div></div></div>
            <div class="mss84-sheet__fieldt"><label for="K03">[03]</label><input id="K03" type="checkbox"></div>
            <div class="mss84-sheet__fieldt"><label for="K05">[05]</label><input id="K05" type="checkbox"></div>
            <div class="mss84-sheet__fieldt"><label for="K07">[07]</label><input id="K07" type="checkbox"></div>
            <div class="mss84-sheet__fieldt"><label for="K10">[10]</label><input id="K10" type="checkbox"></div>
            <div class="mss84-sheet__fieldt"><label for="K11">[11]</label><input id="K11" type="checkbox"></div>
            <div class="mss84-sheet__fieldt"><label for="KKIA">[KIA]</label><input id="KKIA" type="checkbox"></div>
          </div>
        </div>

        <div class="mss84-sheet__group">
          <div class="mss84-four">
            <div class="mss84-sheet__field"><label>Stand</label><input id="mvStand" type="number" min="0" max="6" value="0"></div>
            <div class="mss84-sheet__field"><label>Walk +1</label><input id="mvWalk" type="number" min="0" max="12" value="4"></div>
            <div class="mss84-sheet__field"><label>Run +2</label><input id="mvRun" type="number" min="0" max="12" value="6"></div>
            <div class="mss84-sheet__field"><label>Jump +3</label><input id="mvJump" type="number" min="0" max="12" value="0"></div>
          </div>
        </div>

        <div class="mss84-sheet__group">
          <div class="mss84-heatf">
            <div class="mss84-sheet__field"><label>Effect</label><input id="heatEffect" type="text" placeholder="Heat Systems Stable" readonly></div>
            <div class="mss84-sheet__field"><label>Current</label><input id="heatCur" type="number" min="0" max="99" value="0"></div>
            <div class="mss84-sheet__field"><label>Sinks</label><input id="heatSinks" type="number" min="0" max="99" value="10"></div>
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
        <div class="hint" style="margin:8px 0;">Enter Current and Max values. Rear applies to LT/CT/RT only.</div>
        <div class="mss84-armor-grid" id="armorGrid"></div>
      </section>

      <section class="mss84-sheet__panel" data-panel="equip">
        <div class="mss84-equip closed" id="equipBlock">
          <div class="mss84-equip__hdr">
            <div><strong>Add Equipment</strong> <span class="hint">fills slots by name</span></div>
            <button type="button" id="equipToggle" class="mss84-sheet__x" style="padding:4px 8px;">Toggle</button>
          </div>
          <div class="mss84-equip__body">
            <div class="mss84-row">
              <input type="text" id="eqName" placeholder="Item name (e.g., SRM6)">
              <select id="eqLoc">
                <option value="HD">HD</option><option value="LA">LA</option><option value="RA">RA</option>
                <option value="LT">LT</option><option value="CT">CT</option><option value="RT">RT</option>
                <option value="LL">LL</option><option value="RL">RL</option>
              </select>
              <input type="number" id="eqSlots" min="1" max="18" value="1" title="Slots">
              <div class="mss84-row__actions">
                <button class="mss84-sheet__x" id="eqAdd" style="background:#163016;border:1px solid #234423;">Add</button>
              </div>
            </div>
          </div>
        </div>

        <div class="crit-wrap">
          <div class="crit-head"></div>
          <div class="crit-head" style="justify-content:flex-end; gap:8px;">
            <button class="mss84-chip" id="eqAddDefaults" title="Clears and loads the default core kit">Add Default Equipment</button>
            <button class="mss84-chip" id="eqClearAll" title="Clears all equipment in all locations">Clear All Equipment</button>
          </div>
          <div id="critBoards"></div>
        </div>
      </section>

      <section class="mss84-sheet__panel" data-panel="weapons">
        <div class="mss84-weap closed" id="weapBlock">
          <div class="mss84-weap__hdr">
            <div><strong>Add Weapon</strong> <span class="hint">user-filled; melee is pre-seeded</span></div>
            <button type="button" id="weapToggle" class="mss84-sheet__x" style="padding:4px 8px;">Toggle</button>
          </div>
          <div class="mss84-weap__body">
            <div class="weap-add-grid">
              <input type="text"   id="wnName"  placeholder="NAME (e.g., AC/10)">
              <input type="text"   id="wnType"  placeholder="TYPE (Ballistic/Energy/Missile/Melee)">
              <input type="number" id="wnDmg"   placeholder="DMG"  min="0">
              <input type="number" id="wnHeat"  placeholder="HEAT" min="0">
              <input type="number" id="wnMin"   placeholder="MIN"  min="0">
              <input type="number" id="wnS"     placeholder="SHORT" min="0">
              <input type="number" id="wnM"     placeholder="MED"   min="0">
              <input type="number" id="wnL"     placeholder="LONG"  min="0">
              <input type="number" id="wnAmmoC" placeholder="AMMO CUR" min="0">
              <input type="number" id="wnAmmoX" placeholder="AMMO MAX" min="0">
              <button class="mss84-sheet__x" id="wnAdd" style="background:#163016;border:1px solid #234423;">Add</button>
            </div>
          </div>
        </div>

        <div class="weap-list">
          <div class="weap-head">
            <div class="hint">NAME</div>
            <div class="hint">TYPE</div>
            <div class="hint">DAMAGE</div>
            <div class="hint">HEAT</div>
            <div class="hint">MIN</div>
            <div class="hint">SHORT</div>
            <div class="hint">MED</div>
            <div class="hint">LONG</div>
            <div class="hint">AMMO CUR</div>
            <div class="hint">AMMO MAX</div>
            <div></div>
          </div>
          <div id="weapRows"></div>
        </div>
      </section>

      <section class="mss84-sheet__panel" data-panel="notes">
        <div class="mss84-sheet__group">
          <h4>Notes</h4>
          <textarea id="notes" rows="8" placeholder="Freeform notes…"></textarea>
        </div>
        <div class="mss84-two">
          <button class="mss84-sheet__x" id="clearThisToken" style="background:#2a1414;border:1px solid #3a1c1c;">Clear This Token</button>
          <div class="hint">Removes saved sheet for the current Map/Token only.</div>
        </div>

        <!-- Demo harness (optional; leave visible for now) -->
        <div class="demo-harness">
          <div class="mss84-two">
            <div><label>Map ID</label><input type="text" id="demoMapId" value="demo-map-1" /></div>
            <div><label>Token ID</label><input type="text" id="demoTokenId" value="token-A" /></div>
          </div>
          <div class="tiny">These IDs define where your sheet data saves in <code>localStorage</code>. Change them to simulate switching mechs.</div>
        </div>
      </section>

    </div>
  </aside>
</div>
`;

  /* ------------------------------- Module state ------------------------------- */
  const LOCS = ['HD','LA','RA','LT','CT','RT','LL','RL'];
  const HAS_REAR = new Set(['LT','CT','RT']);
  const SLOTS_PER_LOC = 18;
  const STORAGE_NS = 'mss84:sheet';
  const HEAT_MAX_DEFAULT = 30;
  const HEAT_TICKS = [5,10,15,20,25,30];

  const DEFAULT_KIT = [
    { name: 'Cockpit',        loc: 'HD', slots: 1 },
    { name: 'Sensors',        loc: 'HD', slots: 1 },
    { name: 'Life Support',   loc: 'HD', slots: 1 },
    { name: 'Gyro',           loc: 'CT', slots: 4 },
    { name: 'Engine Core',    loc: 'CT', slots: 3 },
    { name: 'Engine (L)',     loc: 'LT', slots: 2 },
    { name: 'Engine (R)',     loc: 'RT', slots: 2 },
    { name: 'Shoulder Actuator',  loc: 'LA', slots: 1 },
    { name: 'Upper Arm Actuator', loc: 'LA', slots: 1 },
    { name: 'Lower Arm Actuator', loc: 'LA', slots: 1 },
    { name: 'Hand Actuator',      loc: 'LA', slots: 1 },
    { name: 'Shoulder Actuator',  loc: 'RA', slots: 1 },
    { name: 'Upper Arm Actuator', loc: 'RA', slots: 1 },
    { name: 'Lower Arm Actuator', loc: 'RA', slots: 1 },
    { name: 'Hand Actuator',      loc: 'RA', slots: 1 },
    { name: 'Hip Actuator',       loc: 'LL', slots: 1 },
    { name: 'Upper Leg Actuator', loc: 'LL', slots: 1 },
    { name: 'Lower Leg Actuator', loc: 'LL', slots: 1 },
    { name: 'Foot Actuator',      loc: 'LL', slots: 1 },
    { name: 'Hip Actuator',       loc: 'RL', slots: 1 },
    { name: 'Upper Leg Actuator', loc: 'RL', slots: 1 },
    { name: 'Lower Leg Actuator', loc: 'RL', slots: 1 },
    { name: 'Foot Actuator',      loc: 'RL', slots: 1 },
  ];

  const DEFAULT_MELEE = [
    { name:'Punch',  type:'Melee',   dmg:3,  heat:0, min:0, s:1, m:1, l:0, ammo:{cur:0,max:0} },
    { name:'Kick',   type:'Melee',   dmg:3,  heat:0, min:0, s:1, m:1, l:0, ammo:{cur:0,max:0} },
    { name:'Charge', type:'Melee',   dmg:'—',heat:0, min:0, s:1, m:1, l:0, ammo:{cur:0,max:0} },
    { name:'DFA',    type:'Melee',   dmg:'—',heat:0, min:0, s:1, m:1, l:0, ammo:{cur:0,max:0} },
  ];

  /* --------------------------- Utilities (scoped) ---------------------------- */
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
  const escapeAttr = v => (''+v).replace(/"/g,'&quot;');

  const ceilDiv = (a,b) => Math.ceil(a/b);

  /* -------------------------- Persistence / Versions ------------------------- */
  function blankSheet(){
    const armor = {};
    for(const L of LOCS){
      armor[L] = {
        ext:{cur:0,max:0},
        rear: HAS_REAR.has(L) ? {cur:0,max:0} : null,
        str:{cur:0,max:0}
      };
    }
    const crits = {};
    for(const L of LOCS){
      crits[L] = Array.from({length:SLOTS_PER_LOC}, ()=>({occ:false, hit:false, label:'', itemId:null}));
    }
    return {
      version:7,
      pilot:{name:'',callsign:'',faction:'',gunnery:4,piloting:5},
      move:{stand:0,walk:4,run:6,jump:0},
      heat:{current:0,sinks:10,effect:''},
      armor,
      equipment:[],
      nextId:1,
      crits,
      notes:'',
      weapons:[],
      nextWid:1,
      mech:{ chassis:'', variant:'', tonnage:0, bv:0 }
    };
  }
  const key = (map, tok) => `${STORAGE_NS}:${map}:${tok}`;

  function migrate(d){
    if (d.version < 7){
      d.mech = d.mech || { chassis:'', variant:'', tonnage:0, bv:0 };
      d.mech.chassis = String(d.mech.chassis || '');
      d.mech.variant = String(d.mech.variant || '');
      d.mech.tonnage = Number.isFinite(d.mech.tonnage) ? d.mech.tonnage : 0;
      d.mech.bv      = Number.isFinite(d.mech.bv)      ? d.mech.bv      : 0;
      d.version = 7;
    }
    if (d.version < 5){
      const crits = {};
      for(const L of LOCS){
        const prev = (d.crits && d.crits[L]) || [];
        const arr = [];
        for(let i=0;i<SLOTS_PER_LOC;i++){
          const p = prev[i];
          if (p && typeof p==='object' && ('occ' in p || 'hit' in p)){
            arr.push({occ:!!p.occ, hit:!!p.hit, label:p.label||'', itemId: Number.isFinite(p.itemId)?p.itemId:null});
          }else{
            const hit = !!p && typeof p==='boolean' ? p : false;
            arr.push({occ:false, hit, label:'', itemId:null});
          }
        }
        crits[L] = arr;
      }
      d.crits = crits;
      d.equipment = (d.equipment||[]).map(x=>({
        id: Number.isFinite(x.id)?x.id:Math.floor(Math.random()*1e9),
        name: String(x.name||''),
        loc: LOCS.includes(x.loc)?x.loc:'CT',
        slots: clampInt(x.slots ?? 1, 1, 18)
      }));
      d.nextId = (d.nextId && Number.isFinite(d.nextId)) ? d.nextId : 1;
      d.version = 5;
    }
    if (d.version < 6){
      d.weapons = Array.isArray(d.weapons) ? d.weapons : [];
      d.nextWid = Number.isFinite(d.nextWid) ? d.nextWid : 1;
      d.version = 6;
    }

    for(const L of LOCS){
      if(!Array.isArray(d.crits[L])) d.crits[L] = [];
      d.crits[L] = d.crits[L].slice(0, SLOTS_PER_LOC);
      while(d.crits[L].length < SLOTS_PER_LOC) d.crits[L].push({occ:false, hit:false, label:'', itemId:null});
      d.crits[L] = d.crits[L].map(s=>({occ:!!s.occ, hit:!!s.hit, label: String(s.label||''), itemId: Number.isFinite(s.itemId)?s.itemId:null}));
    }
    d.equipment = (d.equipment||[]).map(x=>({
      id: Number.isFinite(x.id)?x.id:(d.nextId++),
      name: String(x.name||''),
      loc: LOCS.includes(x.loc)?x.loc:'CT',
      slots: clampInt(x.slots ?? 1, 1, 18)
    }));

    clearAllOccupancy(d);
    packAllEquipment(d);

    d.weapons = (d.weapons||[]).map(w=>({
      wid: Number.isFinite(w.wid)?w.wid:(d.nextWid++),
      name: String(w.name||''),
      type: String(w.type||''),
      dmg:  (w.dmg===0 || w.dmg) ? w.dmg : '',
      heat: clampNum(w.heat ?? 0, 0, 999),
      min:  clampNum(w.min  ?? 0, 0, 999),
      s:    clampNum(w.s    ?? 0, 0, 999),
      m:    clampNum(w.m    ?? 0, 0, 999),
      l:    clampNum(w.l    ?? 0, 0, 999),
      ammo: { cur: clampNum(w?.ammo?.cur ?? 0, 0, 999), max: clampNum(w?.ammo?.max ?? 0, 0, 999) }
    }));

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

  /* ------------------------------ Mount / API ------------------------------ */
  function mount(host = document.body){
    ensureStyles();
    const root = document.createElement('div');
    root.innerHTML = PANEL_HTML;
    host.appendChild(root);

    const QS  = (s, r=root) => r.querySelector(s);
    const QSA = (s, r=root) => Array.from(r.querySelectorAll(s));

    // state
    let mapId = 'demo-map-1';
    let tokenId = 'token-A';
    let sheet = load(mapId, tokenId);

    // elements
    const wrap      = QS('#sheetWrap');
    const btn       = QS('#sheetToggleBtn');
    const btnClose  = QS('#sheetCloseBtn');
    const tabs      = QS('#sheetTabs');
    const savePulse = QS('#savePulse');

    const demoMap   = QS('#demoMapId');
    const demoTok   = QS('#demoTokenId');

    const fPilot = {
      name:QS('#pilotName'),
      call:QS('#pilotCall'),
      faction:QS('#pilotFaction'),
      g:QS('#pilotG'), p:QS('#pilotP')
    };
    const fMech = {
      chassis: QS('#mechChassis'),
      variant: QS('#mechVariant'),
      tons:    QS('#mechTons'),
      bv:      null // no BV input in template; keep for future
    };
    const fMove = {
      stand:QS('#mvStand'), walk:QS('#mvWalk'), run:QS('#mvRun'), jump:QS('#mvJump')
    };
    const fHeat = {
      cur:QS('#heatCur'), sinks:QS('#heatSinks'), eff:QS('#heatEffect')
    };

    const barsGrid  = QS('#barsGrid');
    const armorGrid = QS('#armorGrid');

    const equipBlock  = QS('#equipBlock');
    const equipToggle = QS('#equipToggle');
    const eqName      = QS('#eqName');
    const eqLoc       = QS('#eqLoc');
    const eqSlots     = QS('#eqSlots');
    const eqAdd       = QS('#eqAdd');
    const eqAddDefaults = QS('#eqAddDefaults');
    const eqClearAll    = QS('#eqClearAll');

    const critBoards = QS('#critBoards');

    const weapBlock  = QS('#weapBlock');
    const weapToggle = QS('#weapToggle');
    const wn = {
      name:QS('#wnName'), type:QS('#wnType'), dmg:QS('#wnDmg'), heat:QS('#wnHeat'),
      min:QS('#wnMin'), s:QS('#wnS'), m:QS('#wnM'), l:QS('#wnL'),
      ac:QS('#wnAmmoC'), ax:QS('#wnAmmoX')
    };
    const wnAddBtn = QS('#wnAdd');
    const weapRows = QS('#weapRows');

    const notes = QS('#notes');
    const clearThis = QS('#clearThisToken');

    // open/close
    const open   = ()=>{ wrap.classList.add('open'); wrap.setAttribute('aria-hidden','false'); };
    const close  = ()=>{ wrap.classList.remove('open'); wrap.setAttribute('aria-hidden','true'); };
    const toggle = ()=> (wrap.classList.contains('open')? close() : open());
    btn.addEventListener('click', toggle);
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
    let tSave=null;
    const scheduleSave = ()=>{ clearTimeout(tSave); tSave = setTimeout(()=> save(mapId, tokenId, sheet), 200); };
    const pulseSaved = ()=>{ if(!savePulse) return; savePulse.classList.add('show'); setTimeout(()=>savePulse.classList.remove('show'), 600); };

    /* ------------------------------- Heat Bar ------------------------------- */
    const heatBarEl   = QS('#heatBar');
    const heatFillEl  = QS('#heatFill');
    const heatTicksEl = QS('#heatTicks');
    const heatLegend  = QS('#heatLegend');

    const heatSeverity = (cur, sinks)=>{
      if(cur <= sinks) return 'ok';
      if(cur <= sinks + 10) return 'crit';
      return 'low';
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
      const cur   = clampInt(fHeat.cur.value,   0, 999);
      const sinks = clampInt(fHeat.sinks.value, 0, 999);
      const max   = Math.max(HEAT_MAX_DEFAULT, sinks, cur);
      const pct   = max > 0 ? Math.min(1, cur / max) : 0;
      const sev   = heatSeverity(cur, sinks);
      if (heatLegend)  heatLegend.textContent  = `${cur} / ${max} (sinks ${sinks})`;
      if (heatFillEl)  heatFillEl.style.width = (pct * 100).toFixed(1) + '%';
      if (heatBarEl){
        heatBarEl.classList.remove('ok','crit','low');
        heatBarEl.classList.add(sev);
      }
      renderHeatTicks(max);
    };

    const HEAT_EFFECTS_TABLE = [
      [30, "Shutdown"], [28, "|Ammo Exp. 8+| |-5 MV| |+4 TN|"], [26, "|Shutdown 10+| |-5 MV| |+4 TN|"],
      [25, "|-5 MV| |+4 TN|"], [24, "|+4 TN| |-4 MV|"], [23, "|Ammo Exp. 6+| |-4 MV| |+3 TN|"],
      [22, "|Shutdown 8+| |-4 MV| |+3 TN|"], [20, "|-4 MV| |+3 TN|"], [19, "|Ammo Exp. 4+| |+3 TN| |-3 MV|"],
      [18, "|Shutdown 6+| |+3 TN| |-3 MV|"], [15, "|+3 TN| |-3 MV|"], [14, "|-3 MV| |+2 TN|"],
      [12, "|+2 TN|"], [10, "|-2 MV| |+1 TN|"], [8,  "|+1 TN|"],
    ];
    const computeHeatEffectText = (cur)=>{
      const row = HEAT_EFFECTS_TABLE.find(([th])=> cur >= th);
      return row ? row[1] : "";
    };
    const syncHeatEffectField = ()=>{
      const cur = clampInt(fHeat.cur.value, 0, 999);
      const text = computeHeatEffectText(cur);
      fHeat.eff.value = text;
      sheet.heat.effect = text;
      scheduleSave();
    };
    fHeat.eff.readOnly = true;
    [fHeat.cur, fHeat.sinks].forEach(inp=>{
      inp.addEventListener('input', ()=>{ renderHeatBar(); syncHeatEffectField(); });
    });

    /* ------------------------------- Bars / Armor ------------------------------ */
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
            <div class="mss84-sheet__field"><label>Ext Max</label><input type="number" data-k="ext.max" value="${a.ext.max||0}"></div>
          </div>
          ${hasRear?`
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label>Rear Cur</label><input type="number" data-k="rear.cur" value="${a.rear.cur||0}"></div>
            <div class="mss84-sheet__field"><label>Rear Max</label><input type="number" data-k="rear.max" value="${a.rear.max||0}"></div>
          </div>`:''}
          <div class="mss84-two">
            <div class="mss84-sheet__field"><label>Struct Cur</label><input type="number" data-k="str.cur" value="${a.str.cur||0}"></div>
            <div class="mss84-sheet__field"><label>Struct Max</label><input type="number" data-k="str.max" value="${a.str.max||0}"></div>
          </div>
        `;
        Array.from(card.querySelectorAll('input[type="number"]')).forEach(inp=>{
          inp.addEventListener('input', ()=>{
            const [p1,p2] = inp.getAttribute('data-k').split('.');
            const v = clampInt(inp.value, 0, 999);
            sheet.armor[L][p1][p2] = v;
            scheduleSave();
            renderBars();
          });
        });
        armorGrid.appendChild(card);
      }
    };

    /* ---------------------------- Equipment boards ---------------------------- */
    function addEquipment(name, loc, need){
      const id = sheet.nextId++;
      sheet.equipment.push({id, name, loc, slots:need});
      const slots = sheet.crits[loc];
      let placed = 0;
      for(let i=0;i<slots.length && placed<need;i++){
        if(!slots[i].occ){
          slots[i].occ = true;
          slots[i].label = name;
          slots[i].itemId = id;
          placed++;
        }
      }
      scheduleSave();
      renderCritBoards();
    }
    function clearAllOccupancy(state=sheet){
      for(const L of LOCS){
        state.crits[L].forEach(s=>{ s.occ=false; s.hit=false; s.label=''; s.itemId=null; });
      }
    }
    function packAllEquipment(state=sheet){
      const itemsByLoc = {}; for(const L of LOCS) itemsByLoc[L]=[];
      (state.equipment||[]).forEach(it=> itemsByLoc[it.loc].push(it));
      for(const L of LOCS){
        const slots = state.crits[L];
        let ptr = 0;
        const put = (lbl,id)=>{
          while(ptr<slots.length && slots[ptr].occ) ptr++;
          if(ptr>=slots.length) return false;
          slots[ptr].occ = true; slots[ptr].label = lbl; slots[ptr].itemId = id; slots[ptr].hit = false; ptr++; return true;
        };
        itemsByLoc[L].forEach(it=>{
          for(let k=0;k<it.slots;k++){ if(!put(it.name, it.id)) break; }
        });
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
          <div><strong>${L}</strong> <span class="mss84-chip">${occ}/${SLOTS_PER_LOC} occupied • ${hits} hit</span></div>
          <div style="display:flex; gap:6px;">
            <button class="mss84-chip" data-act="clearhits" data-loc="${L}">Clear Marks</button>
            <button class="mss84-chip" data-act="clearalloc" data-loc="${L}">Clear Alloc</button>
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
            ${slot.occ ? `<button class="crit-del" data-loc="${L}" data-idx="${i}" title="Remove this slot">✕</button>` : ``}
            <span class="stag">${escapeHtml(label)}</span>
          `;
          if (slot.occ){
            div.addEventListener('click', (ev)=>{
              if (ev.target && ev.target.classList.contains('crit-del')) return;
              slot.hit = !slot.hit;
              scheduleSave(); renderCritBoards();
            });
          }
          grid.appendChild(div);
        });
        wrapDiv.appendChild(grid);

        head.querySelector('[data-act="clearhits"]').addEventListener('click', ()=>{
          sheet.crits[L].forEach(s=>{ if(s.occ) s.hit=false; });
          scheduleSave(); renderCritBoards();
        });
        head.querySelector('[data-act="clearalloc"]').addEventListener('click', ()=>{
          if(!confirm(`Clear all allocations in ${L}?`)) return;
          sheet.crits[L].forEach(s=>{ s.occ=false; s.hit=false; s.label=''; s.itemId=null; });
          sheet.equipment = sheet.equipment.filter(it=> it.loc!==L);
          scheduleSave(); renderCritBoards();
        });

        critBoards.appendChild(wrapDiv);
      }

      Array.from(critBoards.querySelectorAll('.crit-del')).forEach(btn=>{
        btn.addEventListener('click', (e)=>{
          e.stopPropagation();
          const loc = btn.getAttribute('data-loc');
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const slot = sheet.crits[loc][idx];
          if (!slot || !slot.occ) return;
          const id = slot.itemId;
          slot.occ=false; slot.hit=false; slot.label=''; slot.itemId=null;
          const it = sheet.equipment.find(x=> x.id===id);
          if (it){
            it.slots = Math.max(0, (it.slots||0)-1);
            if (it.slots===0) sheet.equipment = sheet.equipment.filter(x=> x.id!==id);
          }
          clearAllOccupancy(sheet);
          packAllEquipment(sheet);
          scheduleSave();
          renderCritBoards();
        });
      });
    }

    // Equip add & toggles
    if (eqAdd && eqName && eqLoc && eqSlots){
      eqAdd.addEventListener('click', ()=>{
        const name = (eqName.value||'').trim();
        if(!name) return;
        const loc = eqLoc.value;
        const slots = clampInt(eqSlots.value, 1, 18);
        addEquipment(name, loc, slots);
        eqName.value=''; eqSlots.value='1';
      });
      [eqName, eqSlots].forEach(inp=>{
        inp.addEventListener('keydown', (e)=>{
          if(e.key==='Enter'){ e.preventDefault(); eqAdd.click(); }
        });
      });
    }
    if (equipToggle && equipBlock){
      equipToggle.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); equipBlock.classList.toggle('closed'); });
      equipBlock.querySelector('.mss84-equip__hdr').addEventListener('click', (e)=>{
        if (e.target===equipToggle || e.target.closest('#equipToggle')) return;
        equipBlock.classList.toggle('closed');
      });
    }
    if (eqAddDefaults){
      eqAddDefaults.addEventListener('click', ()=>{
        if(!confirm('Clear existing equipment and add the default core kit?')) return;
        clearAllOccupancy(sheet);
        sheet.equipment = [];
        DEFAULT_KIT.forEach(it => addEquipment(it.name, it.loc, it.slots));
        sheet._defaultSeeded = true;
        scheduleSave();
        renderCritBoards();
      });
    }
    if (eqClearAll){
      eqClearAll.addEventListener('click', ()=>{
        if(!confirm('Clear ALL equipment from ALL locations?')) return;
        clearAllOccupancy(sheet);
        sheet.equipment = [];
        scheduleSave();
        renderCritBoards();
      });
    }

    /* -------------------------------- Weapons -------------------------------- */
    function addWeaponObj(w){
      const wid = sheet.nextWid++;
      sheet.weapons.push({
        wid,
        name: String(w.name||''),
        type: String(w.type||''),
        dmg:  (w.dmg===0||w.dmg)? w.dmg : '',
        heat: clampNum(w.heat ?? 0, 0, 999),
        min:  clampNum(w.min  ?? 0, 0, 999),
        s:    clampNum(w.s    ?? 0, 0, 999),
        m:    clampNum(w.m    ?? 0, 0, 999),
        l:    clampNum(w.l    ?? 0, 0, 999),
        ammo: { cur: clampNum(w?.ammo?.cur ?? 0, 0, 999), max: clampNum(w?.ammo?.max ?? 0, 0, 999) }
      });
      scheduleSave();
      renderWeapons();
    }
    function addWeaponFromFields(){
      const obj = {
        name:(wn.name.value||'').trim(),
        type:(wn.type.value||'').trim(),
        dmg: wn.dmg.value!=='' ? (isNaN(+wn.dmg.value) ? wn.dmg.value : +wn.dmg.value) : '',
        heat: +wn.heat.value||0,
        min: +wn.min.value||0,
        s:   +wn.s.value||0,
        m:   +wn.m.value||0,
        l:   +wn.l.value||0,
        ammo:{ cur:+wn.ac.value||0, max:+wn.ax.value||0 }
      };
      if(!obj.name) return;
      addWeaponObj(obj);
      wn.name.value=''; wn.type.value=''; wn.dmg.value=''; wn.heat.value='';
      wn.min.value=''; wn.s.value=''; wn.m.value=''; wn.l.value='';
      wn.ac.value=''; wn.ax.value='';
    }
    function applyWeaponEdit(w, path, val){
      if(path==='name'||path==='type'){ w[path] = String(val||''); return; }
      if(path==='dmg'){ w.dmg = (val==='' ? '' : (isNaN(+val) ? val : +val)); return; }
      if(path==='heat'||path==='min'||path==='s'||path==='m'||path==='l'){ w[path] = clampNum(+val||0, 0, 999); return; }
      if(path.startsWith('ammo.')){ const p = path.split('.')[1]; w.ammo[p] = clampNum(+val||0, 0, 999); return; }
    }
    function renderWeapons(){
      weapRows.innerHTML='';
      (sheet.weapons||[]).forEach(w=>{
        const row = document.createElement('div');
        row.className = 'weap-row';
        row.innerHTML = `
          <input type="text"   data-k="name" value="${escapeHtml(w.name)}"  title="Name">
          <input type="text"   data-k="type" value="${escapeHtml(w.type)}"  title="Type">
          <input type="text"   data-k="dmg"  value="${escapeAttr(w.dmg)}"   title="Damage">
          <input type="number" data-k="heat" value="${w.heat}" min="0"      title="Heat">
          <input type="number" data-k="min"  value="${w.min}"  min="0"      title="Min">
          <input type="number" data-k="s"    value="${w.s}"    min="0"      title="Short">
          <input type="number" data-k="m"    value="${w.m}"    min="0"      title="Med">
          <input type="number" data-k="l"    value="${w.l}"    min="0"      title="Long">
          <input type="number" data-k="ammo.cur" value="${w.ammo.cur}" min="0" title="Ammo Current">
          <input type="number" data-k="ammo.max" value="${w.ammo.max}" min="0" title="Ammo Max">
          <button class="weap-del" title="Remove">✕</button>
        `;
        Array.from(row.querySelectorAll('input')).forEach(inp=>{
          inp.addEventListener('input', ()=>{
            const k = inp.getAttribute('data-k');
            applyWeaponEdit(w, k, inp.value);
            scheduleSave();
          });
        });
        row.querySelector('.weap-del').addEventListener('click', ()=>{
          sheet.weapons = sheet.weapons.filter(x=> x.wid!==w.wid);
          scheduleSave(); renderWeapons();
        });
        weapRows.appendChild(row);
      });
    }

    /* -------------------------- Melee damage auto-calc ------------------------- */
    const updateMeleeDamage = ()=>{
      const tons  = sheet?.mech?.tonnage || 0;
      const runMP = sheet?.move?.run || 0;
      (sheet.weapons || []).forEach(w=>{
        if ((w.type||'').toLowerCase() !== 'melee') return;
        const n = (w.name||'').toLowerCase();
        if (n === 'punch'){
          w.dmg = ceilDiv(tons, 10);
        } else if (n === 'kick'){
          w.dmg = ceilDiv(tons, 5);
        } else if (n === 'charge'){
          const base = ceilDiv(tons, 10);
          w.dmg = base * runMP;
        } else if (n === 'dfa' || n === 'death from above'){
          w.dmg = ceilDiv(tons, 5);
        }
      });
      scheduleSave();
      renderWeapons();
    };

    /* ------------------------------ Bindings ------------------------------ */
    const bindField = (inp, obj, key)=>{
      inp.addEventListener('input', ()=>{
        obj[key] = inp.type==='number' ? clampInt(inp.value, -99, 999) : inp.value;
        scheduleSave();
      });
    };
    bindField(fPilot.name, sheet.pilot, 'name');
    bindField(fPilot.call, sheet.pilot, 'callsign');
    bindField(fPilot.faction, sheet.pilot, 'faction');
    bindField(fPilot.g, sheet.pilot, 'gunnery');
    bindField(fPilot.p, sheet.pilot, 'piloting');

    bindField(fMove.stand, sheet.move, 'stand');
    bindField(fMove.walk,  sheet.move, 'walk');
    bindField(fMove.run,   sheet.move, 'run');
    fMove.run.addEventListener('input', updateMeleeDamage);
    bindField(fMove.jump,  sheet.move, 'jump');

    bindField(fHeat.cur,   sheet.heat, 'current');
    bindField(fHeat.sinks, sheet.heat, 'sinks');
    bindField(fHeat.eff,   sheet.heat, 'effect');

    if (fMech.chassis) bindField(fMech.chassis, sheet.mech, 'chassis');
    if (fMech.variant) bindField(fMech.variant, sheet.mech, 'variant');
    if (fMech.tons){
      fMech.tons.addEventListener('input', ()=>{
        let n = parseInt(fMech.tons.value,10);
        if (!Number.isFinite(n)) n = 0;
        n = Math.max(0, Math.min(200, n));
        sheet.mech.tonnage = n;
        scheduleSave();
        updateMeleeDamage();
      });
    }

    if (notes) notes.addEventListener('input', ()=>{ sheet.notes = notes.value; scheduleSave(); });
    if (clearThis) clearThis.addEventListener('click', ()=>{
      if(confirm('Clear saved sheet for this Map/Token?')){
        remove(mapId, tokenId); sheet = blankSheet(); hydrateAll(); scheduleSave();
        renderBars(); renderArmor(); renderHeatBar(); syncHeatEffectField(); renderCritBoards(); renderWeapons();
        seedDefaultKitIfNeeded();
        seedMeleeIfNeeded();
        updateMeleeDamage();
      }
    });

    // hydration
    function hydrateAll(){
      fPilot.name.value = sheet.pilot.name||'';
      fPilot.call.value = sheet.pilot.callsign||'';
      fPilot.faction.value = sheet.pilot.faction||'';
      fPilot.g.value = sheet.pilot.gunnery??4;
      fPilot.p.value = sheet.pilot.piloting??5;

      fMove.stand.value = sheet.move.stand??0;
      fMove.walk.value  = sheet.move.walk??4;
      fMove.run.value   = sheet.move.run ??6;
      fMove.jump.value  = sheet.move.jump??0;

      fHeat.cur.value   = sheet.heat.current??0;
      fHeat.sinks.value = sheet.heat.sinks??10;
      fHeat.eff.value   = sheet.heat.effect||'';

      if (notes) notes.value = sheet.notes||'';

      if (fMech.chassis) fMech.chassis.value = sheet.mech?.chassis || '';
      if (fMech.variant) fMech.variant.value = sheet.mech?.variant || '';
      if (fMech.tons)    fMech.tons.value    = sheet.mech?.tonnage ?? '';
    }

    // demo harness
    function changeIds(newMap, newTok){
      mapId = newMap; tokenId = newTok;
      sheet = load(mapId, tokenId);
      hydrateAll(); renderBars(); renderArmor(); renderHeatBar(); syncHeatEffectField(); renderCritBoards(); renderWeapons();
      seedDefaultKitIfNeeded();
      seedMeleeIfNeeded();
      updateMeleeDamage();
    }
    if (demoMap) demoMap.addEventListener('change', ()=> changeIds(demoMap.value || 'demo-map-1', tokenId));
    if (demoTok)  demoTok.addEventListener('change', ()=> changeIds(mapId, demoTok.value || 'token-A'));

    /* -------------------------- Seeding defaults -------------------------- */
    const seedDefaultKitIfNeeded = ()=>{
      if (sheet && !sheet._defaultSeeded) {
        clearAllOccupancy(sheet);
        sheet.equipment = [];
        DEFAULT_KIT.forEach(it => addEquipment(it.name, it.loc, it.slots));
        sheet._defaultSeeded = true;
        scheduleSave();
      }
    };
    const seedMeleeIfNeeded = ()=>{
      if (sheet && !sheet._meleeSeeded) {
        sheet.weapons = sheet.weapons || [];
        if (sheet.weapons.length === 0){
          DEFAULT_MELEE.forEach(addWeaponObj);
        }
        sheet._meleeSeeded = true;
        scheduleSave();
      }
    };

    /* --------------------------------- init --------------------------------- */
    hydrateAll(); renderBars(); renderArmor(); renderHeatBar(); syncHeatEffectField();
    seedDefaultKitIfNeeded();
    seedMeleeIfNeeded();
    updateMeleeDamage();
    renderCritBoards();
    renderWeapons();

    // API
    const api = {
      open, close, toggle,
      setIds: (map, tok)=> changeIds(map, tok),
      getIds: ()=>({ mapId, tokenId }),
      load: ()=> load(mapId, tokenId),
      saveNow: ()=> save(mapId, tokenId, sheet),
      clearToken: ()=> remove(mapId, tokenId)
    };

    // Also expose legacy global for convenience
    window.MSS84_SHEET = api;

    return api;
  }

  return { mount };
})();