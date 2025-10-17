(() => {
  // ===== GATOR: compact to-hit calculator for BattleTech (MSS:84) =====
  const el = {
    panel: null, openBtn: null, outTN: null, outProb: null, outRoll: null
  };

  // Simple 2d6 probability lookup
  const P2D6 = { 2:2.78,3:5.56,4:8.33,5:11.11,6:13.89,7:16.67,8:13.89,9:11.11,10:8.33,11:5.56,12:2.78 };
  const chanceAtOrAbove = (tn) => {
    if (tn <= 2) return 100;
    if (tn > 12) return 0;
    let s = 0;
    for (let k = tn; k <= 12; k++) s += P2D6[k] || 0;
    return +s.toFixed(2);
  };

  // Built-in roller fallback; if rolls.js exposes window.ROLLS.roll2d6(), we’ll use it.
  function roll2d6() {
    try {
      if (window.ROLLS && typeof window.ROLLS.roll2d6 === 'function') {
        const r = window.ROLLS.roll2d6();
        // Support {sum, d1, d2} or number
        return typeof r === 'object' ? (r.sum ?? (r.d1 + r.d2)) : r;
      }
    } catch {}
    return (1 + Math.floor(Math.random()*6)) + (1 + Math.floor(Math.random()*6));
  }

  // Target Movement Mod table (TMM) quick picks (ground units)
  const TMM_PRESETS = [
    {label:'0 (stood still)', tmm:0},
    {label:'1–2 hexes',       tmm:1},
    {label:'3–4 hexes',       tmm:2},
    {label:'5–6 hexes',       tmm:3},
    {label:'7–9 hexes',       tmm:4},
    {label:'10–17 hexes',     tmm:5},
    {label:'18+ hexes',       tmm:6},
  ];

  // Build panel DOM once
  function buildPanel() {
    if (el.panel) return;

    const panel = document.createElement('div');
    panel.id = 'gatorPanel';
    panel.className = 'panel right collapsed';
    panel.style.cssText = 'right:auto; left:50%; transform:translateX(-50%); width:520px; top:60px; z-index:44;';
    panel.setAttribute('aria-label', 'GATOR Console');
    panel.hidden = true;

    panel.innerHTML = `
      <div class="panel-head">
        <h2>GATOR Console</h2>
        <button id="gtrClose" class="icon-btn" title="Hide">
          <svg viewBox="0 0 24 24" class="ico" aria-hidden="true">
            <path d="M19 6L6 19M6 6l13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="panel-body">
        <!-- A) Attacker -->
        <section class="group">
          <h3>Attacker</h3>
          <div class="row gap">
            <label class="stack" style="min-width:120px;">
              <span>Gunnery</span>
              <input id="gtrGunnery" type="number" step="1" min="1" max="6" value="4">
            </label>
            <label class="stack" style="min-width:160px;">
              <span>Attacker Move</span>
              <select id="gtrAtkMove">
                <option value="0">Stationary (+0)</option>
                <option value="1">Walked (+1)</option>
                <option value="2">Ran (+2)</option>
                <option value="3">Jumped (+3)</option>
              </select>
            </label>
            <label class="stack" style="min-width:120px;">
              <span>Heat Mod</span>
              <input id="gtrHeat" type="number" step="1" min="0" max="6" value="0">
            </label>
          </div>
        </section>

        <!-- B) Target -->
        <section class="group">
          <h3>Target</h3>
          <div class="row gap">
            <label class="stack" style="min-width:210px;">
              <span>Target Movement (TMM quick)</span>
              <select id="gtrTmmPreset"></select>
            </label>
            <label class="stack" style="min-width:100px;">
              <span>TMM (override)</span>
              <input id="gtrTMM" type="number" step="1" min="-2" max="8" value="0">
            </label>
            <label class="stack" style="min-width:160px;">
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
          <div class="row gap">
            <label class="stack" style="min-width:180px;">
              <span>Range Bracket</span>
              <select id="gtrRange">
                <option value="0">Short (+0)</option>
                <option value="2">Medium (+2)</option>
                <option value="4">Long (+4)</option>
                <option value="6">Extreme (+6)</option>
              </select>
            </label>
            <label class="stack" style="min-width:160px;">
              <span>Intervening Woods</span>
              <select id="gtrWoodsBetween">
                <option value="0">None (+0)</option>
                <option value="1">Light (+1)</option>
                <option value="2">Heavy (+2)</option>
                <option value="3">2+ Woods Hexes (+3)</option>
              </select>
            </label>
            <label class="stack" style="min-width:160px;">
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
          <div class="row gap">
            <label class="stack" style="min-width:150px;">
              <span>Indirect Fire</span>
              <select id="gtrIndirect">
                <option value="0">No (+0)</option>
                <option value="1">Yes (+1)</option>
              </select>
            </label>
            <label class="stack" style="min-width:150px;">
              <span>Oblique / Night / Etc.</span>
              <input id="gtrOther" type="number" step="1" min="-4" max="8" value="0">
            </label>
            <label class="stack" style="min-width:120px;">
              <span>Attacker PSR?</span>
              <select id="gtrPSR">
                <option value="0">No (+0)</option>
                <option value="0">Yes (n/a here)</option>
              </select>
            </label>
          </div>
          <div class="small muted">Tip: Use “Other” for any scenario/house modifiers you’re applying. Heat here is only the direct to-hit heat mod.</div>
        </section>

        <!-- Results -->
        <section class="group">
          <h3>Result</h3>
          <div class="row gap" style="align-items:center;">
            <output id="gtrTN" class="badge" style="font-size:1.4em; padding:.25em .6em;">TN —</output>
            <span class="muted">Chance on 2d6:</span>
            <output id="gtrProb" class="badge">—%</output>
            <button id="gtrRoll" class="btn">Roll 2d6</button>
            <output id="gtrRollOut" class="dice-out" style="min-width:64px;">—</output>
          </div>
        </section>
      </div>
    `;

    // TMM presets populate
    const sel = panel.querySelector('#gtrTmmPreset');
    TMM_PRESETS.forEach(p => {
      const o = document.createElement('option');
      o.value = p.tmm; o.textContent = `${p.label} (+${p.tmm})`;
      sel.appendChild(o);
    });

    // Keep refs
    el.panel = panel;
    el.outTN   = panel.querySelector('#gtrTN');
    el.outProb = panel.querySelector('#gtrProb');
    el.outRoll = panel.querySelector('#gtrRollOut');

    // Wire close
    panel.querySelector('#gtrClose').addEventListener('click', close);

    // Wire live recompute
    panel.addEventListener('input', compute);
    panel.querySelector('#gtrTmmPreset').addEventListener('change', e => {
      panel.querySelector('#gtrTMM').value = String(e.target.value);
      compute();
    });
    panel.querySelector('#gtrRoll').addEventListener('click', () => {
      const tn = currentTN();
      const r = roll2d6();
      el.outRoll.textContent = r;
      el.outRoll.classList.toggle('success', r >= tn);
      el.outRoll.classList.toggle('fail', r < tn);
    });

    document.body.appendChild(panel);
    compute(); // initial
  }

  function valNum(id) {
    const n = Number(el.panel.querySelector(id)?.value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function currentTN() {
    if (!el.panel) return NaN;
    const g  = valNum('#gtrGunnery');
    const am = valNum('#gtrAtkMove');
    const ht = valNum('#gtrHeat');
    const tmm= valNum('#gtrTMM');
    const ts = valNum('#gtrTargetState');
    const rg = valNum('#gtrRange');
    const wb = valNum('#gtrWoodsBetween');
    const wh = valNum('#gtrWoodsInHex');
    const ifr= valNum('#gtrIndirect');
    const oth= valNum('#gtrOther');

    // Standard “GATOR” stack (core):
    // Gunnery + Attacker Move + Heat + Target Movement + Target State + Range
    // + Woods Between + Woods In Hex + Indirect + Other
    const tn = g + am + ht + tmm + ts + rg + wb + wh + ifr + oth;
    return Math.max(2, tn); // never less than 2
  }

  function compute() {
    const tn = currentTN();
    const pct = chanceAtOrAbove(tn);
    el.outTN.textContent = `TN ${tn}`;
    el.outProb.textContent = `${pct}%`;
  }

  function open() {
    buildPanel();
    el.panel.hidden = false;
    el.panel.classList.remove('collapsed');
  }

  function close() {
    if (!el.panel) return;
    el.panel.classList.add('collapsed');
    el.panel.hidden = true;
  }

  // Auto-wire an “Open GATOR” button if present
  function wireButton() {
    const btn = document.getElementById('btnOpenGator');
    if (!btn) return;
    btn.addEventListener('click', open);
  }

  // Public API
  window.GATOR = { open, close, compute, currentTN };

  // Initialize after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildPanel(); wireButton(); });
  } else {
    buildPanel(); wireButton();
  }
})();
