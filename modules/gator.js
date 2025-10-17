(() => {
  // ===== GATOR: To-Hit + Damage (Location / Crit / Missile) — Self-Contained =====
  const el = {
    panel:null, navHit:null, navDmg:null,
    // To-Hit outputs
    outTN:null, outProb:null, outRoll:null
  };

  // ==== Prob for 2d6 ====
  const P2D6 = { 2:2.78,3:5.56,4:8.33,5:11.11,6:13.89,7:16.67,8:13.89,9:11.11,10:8.33,11:5.56,12:2.78 };
  const chanceAtOrAbove = (tn) => {
    if (tn <= 2) return 100;
    if (tn > 12) return 0;
    let s = 0; for (let k=tn; k<=12; k++) s += P2D6[k] || 0;
    return +s.toFixed(2);
  };

  // ==== RNG ====
  const RNG = { d6(){return (Math.random()*6|0)+1;}, roll2d6(){return this.d6()+this.d6();} };

  function roll2d6() { return RNG.roll2d6(); }

  // ==== Canon Tables ====
  // ’Mech hit location (FRONT) — 2d6 => location
  const HIT_FRONT = Object.freeze({
    2:'CT',3:'RT',4:'RA',5:'RL',6:'RT',7:'CT',8:'LT',9:'LL',10:'LA',11:'LA',12:'HEAD'
  });
  // ’Mech hit location (REAR)
  const HIT_REAR = Object.freeze({
    2:'CT (Rear)',3:'RT (Rear)',4:'RA (Rear)',5:'RL (Rear)',6:'RT (Rear)',7:'CT (Rear)',
    8:'LT (Rear)',9:'LL (Rear)',10:'LA (Rear)',11:'LA (Rear)',12:'HEAD'
  });
  // Critical check 2–7:0 • 8–9:1 • 10–11:2 • 12:3
  const CRIT_BY_ROLL = Object.freeze({2:0,3:0,4:0,5:0,6:0,7:0,8:1,9:1,10:2,11:2,12:3});

  // Missile Cluster Hits Tables (2..12 → hits) per launcher size
  // (Index 0 unused; entry[i] maps to roll i)
  const CLUSTER = Object.freeze({
    2:  [ ,1,1,1,1,1,1,1,2,2,2,2,2 ],
    4:  [ ,1,2,2,2,2,2,3,3,3,3,4,4 ],
    5:  [ ,1,2,2,3,3,3,3,3,4,4,5,5 ],
    6:  [ ,2,2,3,3,4,4,4,4,5,5,6,6 ],
    10: [ ,3,3,4,6,6,6,6,6,8,8,10,10 ],
    15: [ ,5,5,6,9,9,9,9,9,12,12,15,15 ],
    20: [ ,6,6,9,12,12,12,12,12,16,16,20,20 ],
  });

  // ==== Core Rolls (self-contained) ====
  function rollLocation(facing='front'){
    const r = RNG.roll2d6();
    const table = (facing==='rear') ? HIT_REAR : HIT_FRONT;
    return { roll:r, location: table[r] ?? '—' };
  }
  function rollCrit(){
    const r = RNG.roll2d6();
    return { roll:r, crits: CRIT_BY_ROLL[r] ?? 0 };
  }
  function clamp(n,lo,hi){ return n<lo?lo:(n>hi?hi:n); }
  /**
   * Missile cluster: size=launcher size, mods=(Artemis etc), streak=true to short-circuit.
   * Returns {roll, adj, hits, size, note?}
   */
  function rollCluster({ size=10, mods=0, streak=false }={}){
    if (streak) return { roll:null, adj:null, hits:size, size, note:'STREAK: full hits on success' };
    const base = RNG.roll2d6();
    const adj  = clamp(base+(mods|0), 2, 12);
    const row  = CLUSTER[size];
    const hits = row ? (row[adj]||0) : 0;
    return { roll:base, adj, hits, size };
  }

  // ==== Build UI ====
  function buildPanel(){
    if (el.panel) return;

    const panel = document.createElement('div');
    panel.id = 'gatorPanel';
    panel.className = 'panel right collapsed';
    panel.style.cssText = 'right:auto; left:50%; transform:translateX(-50%); width:560px; top:60px; z-index:44;';
    panel.hidden = true;
    panel.setAttribute('aria-label','GATOR Console');

    panel.innerHTML = `
      <style>
        /* Scoped to panel */
        #gatorPanel .tabs{display:flex; gap:8px; margin:8px 0 12px;}
        #gatorPanel .tabs .tab{padding:6px 10px; border-radius:8px; background:rgba(255,255,255,.05); cursor:pointer; user-select:none;}
        #gatorPanel .tabs .tab.active{background:rgba(255,255,255,.12); font-weight:700;}
        #gatorPanel .pane{display:none;}
        #gatorPanel .pane.active{display:block;}
        #gatorPanel .row{display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;}
        #gatorPanel .stack{display:flex; flex-direction:column; gap:4px;}
        #gatorPanel .muted{color:var(--muted);}
        #gatorPanel .badge{border-radius:999px; padding:.25em .6em; background:rgba(255,255,255,.06); font-weight:700;}
        #gatorPanel .dice-out{display:inline-block; min-width:64px; text-align:center; padding:.2em .4em; border-radius:6px; background:rgba(255,255,255,.06);}
        #gatorPanel .dice-out.success{outline:2px solid var(--ok);}
        #gatorPanel .dice-out.fail{outline:2px solid var(--danger);}
        #gatorPanel .field{min-width:110px;}
        #gatorPanel .tiny{width:64px; text-align:center;}
        #gatorPanel .line{display:flex; gap:10px; align-items:center; flex-wrap:wrap;}
        #gatorPanel .sep{height:1px; background:var(--line); margin:8px 0;}
        #gatorPanel h3{margin:.25rem 0 .5rem;}
        #gatorPanel .sub{font-weight:700; font-size:12.5px; letter-spacing:.3px; opacity:.9;}
        #gatorPanel .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;}
      </style>

      <div class="panel-head">
        <h2>GATOR Console</h2>
        <button id="gtrClose" class="icon-btn" title="Hide">
          <svg viewBox="0 0 24 24" class="ico" aria-hidden="true">
            <path d="M19 6L6 19M6 6l13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="panel-body">
        <div class="tabs">
          <button id="gtrTabHit" class="tab active">To-Hit</button>
          <button id="gtrTabDmg" class="tab">Damage</button>
        </div>

        <!-- ===== Pane: To-Hit ===== -->
        <div id="paneHit" class="pane active">
          <!-- A) Attacker -->
          <section class="group">
            <h3>Attacker</h3>
            <div class="row">
              <label class="stack field">
                <span>Gunnery</span>
                <input id="gtrGunnery" type="number" step="1" min="0" max="10" value="4">
              </label>
              <label class="stack field">
                <span>Attacker Move</span>
                <select id="gtrAtkMove">
                  <option value="0">Stationary (+0)</option>
                  <option value="1">Walked (+1)</option>
                  <option value="2">Ran (+2)</option>
                  <option value="3">Jumped (+3)</option>
                </select>
              </label>
              <label class="stack field">
                <span>Heat Mod</span>
                <input id="gtrHeat" type="number" step="1" min="0" max="6" value="0">
              </label>
            </div>
          </section>

          <!-- B) Target -->
          <section class="group">
            <h3>Target</h3>
            <div class="row">
              <label class="stack field">
                <span>Target Movement (TMM quick)</span>
                <select id="gtrTmmPreset"></select>
              </label>
              <label class="stack field">
                <span>TMM (override)</span>
                <input id="gtrTMM" type="number" step="1" min="-2" max="8" value="0">
              </label>
              <label class="stack field">
                <span>Target State</span>
                <select id="gtrTargetState">
                  <option value="0">Normal (+0)</option>
                  <option value="1">Prone (+1)</option>
                  <option value="1">Hull Down/Partial Cover (+1)</option>
                </select>
              </label>
            </div>
          </section>

          <!-- C) Range & Terrain -->
          <section class="group">
            <h3>Range & Terrain</h3>
            <div class="row">
              <label class="stack field">
                <span>Range Bracket</span>
                <select id="gtrRange">
                  <option value="0">Short (+0)</option>
                  <option value="2">Medium (+2)</option>
                  <option value="4">Long (+4)</option>
                  <option value="6">Extreme (+6)</option>
                </select>
              </label>
              <label class="stack field">
                <span>Intervening Woods</span>
                <select id="gtrWoodsBetween">
                  <option value="0">None (+0)</option>
                  <option value="1">Light (+1)</option>
                  <option value="2">Heavy (+2)</option>
                  <option value="3">2+ Woods Hexes (+3)</option>
                </select>
              </label>
              <label class="stack field">
                <span>Woods in Target Hex</span>
                <select id="gtrWoodsInHex">
                  <option value="0">None (+0)</option>
                  <option value="1">Light (+1)</option>
                  <option value="2">Heavy (+2)</option>
                </select>
              </label>
            </div>
          </section>

          <!-- D) Other -->
          <section class="group">
            <h3>Other Modifiers</h3>
            <div class="row">
              <label class="stack field">
                <span>Indirect Fire</span>
                <select id="gtrIndirect">
                  <option value="0">No (+0)</option>
                  <option value="1">Yes (+1)</option>
                </select>
              </label>
              <label class="stack field">
                <span>Oblique / Night / Etc.</span>
                <input id="gtrOther" type="number" step="1" min="-4" max="8" value="0">
              </label>
              <label class="stack field">
                <span>Attacker PSR?</span>
                <select id="gtrPSR">
                  <option value="0">No (+0)</option>
                  <option value="0">Yes (n/a)</option>
                </select>
              </label>
            </div>
            <div class="muted small">Tip: Heat here is only the direct to-hit heat mod.</div>
          </section>

          <!-- Results -->
          <section class="group">
            <h3>Result</h3>
            <div class="row" style="align-items:center;">
              <output id="gtrTN" class="badge" style="font-size:1.4em;">TN —</output>
              <span class="muted">Chance on 2d6:</span>
              <output id="gtrProb" class="badge">—%</output>
              <button id="gtrRoll" class="btn">Roll 2d6</button>
              <output id="gtrRollOut" class="dice-out">—</output>
            </div>
          </section>
        </div>

        <!-- ===== Pane: Damage ===== -->
        <div id="paneDmg" class="pane">
          <!-- Quick buttons -->
          <section class="group">
            <h3>Hit Location & Critical</h3>
            <div class="line" style="margin-bottom:6px;">
              <button id="btnLocFront" class="btn sm">Location (Front)</button>
              <button id="btnLocRear"  class="btn sm">Location (Rear)</button>
              <button id="btnCrit"     class="btn sm">Critical Check</button>
            </div>
            <div class="line mono" id="outLocCrit">—</div>
          </section>

          <div class="sep"></div>

          <!-- Missile cluster -->
          <section class="group">
            <h3>Missile Cluster</h3>
            <div class="line">
              <span class="sub">Missiles</span>
              <input id="mcSize" class="tiny" type="number" min="2" max="20" value="10" />
              <select id="mcType">
                <option value="LRM" selected>LRM (1 dmg/shot)</option>
                <option value="SRM">SRM (2 dmg/shot)</option>
              </select>

              <span class="sub">Auto-mods</span>
              <label><input type="checkbox" id="mcArtemis"> Artemis IV (+2)</label>
              <label><input type="checkbox" id="mcPlus1"> +1</label>
              <label><input type="checkbox" id="mcPlus2"> +2</label>
              <label><input type="checkbox" id="mcStreak"> STREAK</label>

              <button id="btnCluster" class="btn sm">Cluster Roll</button>
            </div>
            <div class="line mono" id="outCluster">—</div>
          </section>
        </div>
      </div>
    `;

    // wire references
    el.panel   = panel;
    el.navHit  = panel.querySelector('#gtrTabHit');
    el.navDmg  = panel.querySelector('#gtrTabDmg');
    el.outTN   = panel.querySelector('#gtrTN');
    el.outProb = panel.querySelector('#gtrProb');
    el.outRoll = panel.querySelector('#gtrRollOut');

    // close
    panel.querySelector('#gtrClose').addEventListener('click', close);

    // tabs
    const paneHit = panel.querySelector('#paneHit');
    const paneDmg = panel.querySelector('#paneDmg');
    el.navHit.addEventListener('click', () => {
      el.navHit.classList.add('active'); el.navDmg.classList.remove('active');
      paneHit.classList.add('active');   paneDmg.classList.remove('active');
    });
    el.navDmg.addEventListener('click', () => {
      el.navDmg.classList.add('active'); el.navHit.classList.remove('active');
      paneDmg.classList.add('active');   paneHit.classList.remove('active');
    });

    // populate TMM presets
    const TMM_PRESETS = [
      {label:'0 (stood still)', tmm:0},{label:'1–2 hexes',tmm:1},{label:'3–4 hexes',tmm:2},
      {label:'5–6 hexes',tmm:3},{label:'7–9 hexes',tmm:4},{label:'10–17 hexes',tmm:5},{label:'18+ hexes',tmm:6},
    ];
    const sel = panel.querySelector('#gtrTmmPreset');
    TMM_PRESETS.forEach(p => {
      const o = document.createElement('option'); o.value = p.tmm; o.textContent = `${p.label} (+${p.tmm})`;
      sel.appendChild(o);
    });
    sel.addEventListener('change', e => {
      panel.querySelector('#gtrTMM').value = String(e.target.value);
      compute();
    });

    // live compute (to-hit)
    panel.addEventListener('input', (ev) => {
      // only recompute when inputs under paneHit change
      if (paneHit.contains(ev.target)) compute();
    });

    // roll to-hit
    panel.querySelector('#gtrRoll').addEventListener('click', () => {
      const tn = currentTN();
      const r = roll2d6();
      el.outRoll.textContent = r;
      el.outRoll.classList.toggle('success', r >= tn);
      el.outRoll.classList.toggle('fail', r < tn);
    });

    // Damage tab actions
    const outLC = panel.querySelector('#outLocCrit');
    function setLC(html){ outLC.innerHTML = html; }

    panel.querySelector('#btnLocFront').addEventListener('click', () => {
      const r = rollLocation('front');
      setLC(`<span class="badge">Location</span> roll <b>${r.roll}</b> → <b>${r.location}</b>`);
    });
    panel.querySelector('#btnLocRear').addEventListener('click', () => {
      const r = rollLocation('rear');
      setLC(`<span class="badge">Location</span> roll <b>${r.roll}</b> → <b>${r.location}</b>`);
    });
    panel.querySelector('#btnCrit').addEventListener('click', () => {
      const r = rollCrit();
      setLC(`<span class="badge">Critical</span> roll <b>${r.roll}</b> → <b>${r.crits}</b> potential crit${r.crits===1?'':'s'}`);
    });

    // Cluster
    const outCl = panel.querySelector('#outCluster');
    const getNum = (id, def=0) => Number(panel.querySelector(id)?.value || def) || def;
    const getChk = (id) => !!panel.querySelector(id)?.checked;

    panel.querySelector('#btnCluster').addEventListener('click', () => {
      const size = getNum('#mcSize', 10);
      const type = panel.querySelector('#mcType').value; // LRM or SRM
      const dpm  = (type==='SRM') ? 2 : 1;

      const artemis = getChk('#mcArtemis') ? 2 : 0;
      const plus1   = getChk('#mcPlus1') ? 1 : 0;
      const plus2   = getChk('#mcPlus2') ? 2 : 0;
      const streak  = getChk('#mcStreak');

      const autoMods = artemis + plus1 + plus2;
      const res = rollCluster({ size, mods:autoMods, streak });

      if (streak) {
        const hits = size, dmg = hits*dpm;
        outCl.innerHTML = [
          `<span class="badge">Missiles</span> <b>STREAK</b> → <b>${hits}/${size}</b> hit`,
          `<span class="badge">${dmg} dmg</span>`,
          `<span class="muted">(cluster table skipped)</span>`
        ].join(' • ');
        return;
      }

      const hits = res.hits, dmg = hits*dpm;
      const modsList = [];
      if (artemis) modsList.push('Artemis +2');
      if (plus1)   modsList.push('+1');
      if (plus2)   modsList.push('+2');

      outCl.innerHTML = [
        `<span class="badge">Missiles</span> ${type} size <b>${size}</b> → <b>${hits}/${size}</b> hit`,
        `<span class="muted">(roll ${res.roll}, adj ${res.adj})</span>`,
        `<span class="badge">${dmg} dmg</span>`,
        `<span class="muted">mods: ${modsList.length?modsList.join(', '):'none'}</span>`
      ].join(' • ');
    });

    document.body.appendChild(panel);
    compute(); // initial
  }

  // ==== To-Hit math ====
  function vNum(root, sel){ const n = Number(root.querySelector(sel)?.value||0); return Number.isFinite(n)?n:0; }
  function currentTN(){
    if (!el.panel) return NaN;
    const p = el.panel;
    const g  = vNum(p,'#gtrGunnery');
    const am = vNum(p,'#gtrAtkMove');
    const ht = vNum(p,'#gtrHeat');
    const tmm= vNum(p,'#gtrTMM');
    const ts = vNum(p,'#gtrTargetState');
    const rg = vNum(p,'#gtrRange');
    const wb = vNum(p,'#gtrWoodsBetween');
    const wh = vNum(p,'#gtrWoodsInHex');
    const ifr= vNum(p,'#gtrIndirect');
    const oth= vNum(p,'#gtrOther');
    return Math.max(2, g+am+ht+tmm+ts+rg+wb+wh+ifr+oth);
  }
  function compute(){
    const tn = currentTN();
    const pct = chanceAtOrAbove(tn);
    el.outTN.textContent = `TN ${tn}`;
    el.outProb.textContent = `${pct}%`;
  }

  // ==== Open/Close & button wiring ====
  function open(){
    buildPanel();
    el.panel.hidden = false;
    el.panel.classList.remove('collapsed');
  }
  function close(){
    if (!el.panel) return;
    el.panel.classList.add('collapsed');
    el.panel.hidden = true;
  }
  function wireButton(){
    const btn = document.getElementById('btnOpenGator');
    if (btn) btn.addEventListener('click', open);
  }

  // Public API
  window.GATOR = { open, close, compute, currentTN };

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildPanel(); wireButton(); });
  } else { buildPanel(); wireButton(); }
})();
