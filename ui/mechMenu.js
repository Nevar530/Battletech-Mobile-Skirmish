/* ui.mechMenu.js
   Right-panel module:
   - Mech adding (form + typeahead via datalist if present)
   - Roster list + per-item controls (select, center, rotate, size, delete)
   - Initiative panel (roll all / clear / next turn)
   - Mech import/export (roster only)
   - Lightweight mech index loader (manifest.json preferred, mechs.json fallback)

   Public API:
     MechMenu.mount(core)
     MechMenu.onStateApplied()   // call after core.applyState(...) so UI rebuilds

   Expects 'core' with:
     tokens:Array, mechMeta:Map, addTokenAtViewCenter(), requestRender(), saveLocal()
     selectToken(id), centerOnToken(token)
     (optional) INDEX_BASE string for mech index path
*/
(function (global) {
  const MechMenu = {
    core: null,

    mount(core) {
      this.core = core || {};
      initDomRefs();
      wireUi();
      loadMechIndex();     // async fire-and-forget
      rebuildRoster();
      rebuildInit();
    },

    onStateApplied() {
      // the core called applyState(); rebuild our UI to match
      rebuildRoster();
      rebuildInit();
      refreshInitBadges(); // keep badges visually consistent if DOM exists
    },
  };

  // ---------- DOM cache ----------
  const el = {};
  function $(id){ return document.getElementById(id); }
  function initDomRefs(){
    el.mechName   = $('mechName');
    el.pilotName  = $('pilotName');
    el.teamSelect = $('teamSelect');
    el.btnAddMech = $('btnAddMech');
    el.mechList   = $('mechList');

    el.initList      = $('initList');
    el.btnRollInitAll= $('btnRollInitAll');
    el.btnClearInit  = $('btnClearInit');
    el.btnNextTurn   = $('btnNextTurn');

    el.btnExportMechs= $('btnExportMechs');
    el.btnImportMechs= $('btnImportMechs');
    el.importFile    = $('importFile');

    // optional Flechs dock shortcuts (no-ops if they don’t exist)
    el.btnFlechsP1 = $('btnFlechsP1');
    el.btnFlechsP2 = $('btnFlechsP2');

    // optional datalist for typeahead population
    el.mechListData = $('mechListData');
  }

  // ---------- local module state ----------
  // mech index
  let MECH_INDEX = [];               // [{id,name,mv?,path?,meta?}]
  const mechById = new Map();        // "ARC-2K" -> full row
  const mechByName = new Map();      // "archer arc-2k" -> "ARC-2K"

  // initiative (stored separately from UI)
  let initOrder = []; // [{id, roll}]
  let initIndex = -1;
  let initRolls = new Map(); // id -> roll

  // ---------- helpers ----------
  const clamp = (v,min,max)=> Math.max(min, Math.min(max,v));
  function teamNameToColorIndex(teamName){
    const map = { 'Alpha': 1, 'Bravo': 0, 'Clan': 4, 'Merc': 3 };
    return map[teamName] ?? 0;
  }
  function shortLabel(name){ return (name||'MECH').slice(0, 18); }

  // normalize a typed ID like "ARC2K" -> "ARC-2K"
  function normalizeId(str){
    return (str||'').toUpperCase().replace(/\s+/g,'').replace(/^([A-Z]{2,4})(\d)/, '$1-$2');
  }

  function resolveMech(input){
    const raw = (input||'').trim();
    if (!raw) return { tokenLabel:'MECH', displayName:'MECH', mv:null, path:'' };

    const asId = normalizeId(raw);
    if (mechById.has(asId)) {
      const row = mechById.get(asId);
      return { tokenLabel: row.id, displayName: row.name, mv: row.mv || null, path: row.path || '' };
    }
    if (mechByName.has(raw.toLowerCase())) {
      const id  = mechByName.get(raw.toLowerCase());
      const row = mechById.get(id);
      return { tokenLabel: row.id, displayName: row.name, mv: row.mv || null, path: row.path || '' };
    }
    // Free text fallback
    return { tokenLabel: shortLabel(raw.toUpperCase()), displayName: raw, mv:null, path:'' };
  }

  // badge helpers (used by refreshInitBadges(); your main render also draws them)
  function mvLabel(mv){
    if (!mv) return null;
    const walk = +(mv.walk ?? 0);
    const run  = +(mv.run  ?? Math.ceil(walk * 1.5));
    const jump = +(mv.jump ?? 0);
    return `${walk}/${run}/${jump}`;
  }

  function renderInitBadge(parentG, roll){
    const old = parentG.querySelector('.init-badge');
    if (old) old.remove();
    if (roll == null || roll === '' || Number.isNaN(+roll)) return;

    const svgNS = 'http://www.w3.org/2000/svg';
    const badge = document.createElementNS(svgNS, 'g');
    badge.setAttribute('class', 'init-badge');

    const r = Number(parentG.dataset.rtok) || 24;
    badge.setAttribute('transform', `translate(0,${r * 1.1})`);

    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('r', 12);
    badge.appendChild(c);

    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.textContent = String(roll);
    badge.appendChild(t);

    parentG.appendChild(badge);
  }

  function renderMvBadge(parentG, mv, rTok){
    const old = parentG.querySelector('.mv-badge');
    if (old) old.remove();
    const label = mvLabel(mv);
    if (!label) return;

    const svgNS = 'http://www.w3.org/2000/svg';
    const badge = document.createElementNS(svgNS, 'g');
    badge.setAttribute('class', 'mv-badge');
    const r = Number(parentG.dataset.rtok) || (rTok || 24);
    badge.setAttribute('transform', `translate(${r * 0.95},${-r * 0.95})`);

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', -18); rect.setAttribute('y', -10);
    rect.setAttribute('rx', 4);  rect.setAttribute('ry', 4);
    rect.setAttribute('width', 36); rect.setAttribute('height', 20);
    rect.setAttribute('class', 'mv-bg');
    badge.appendChild(rect);

    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', 10);
    t.textContent = label;
    badge.appendChild(t);

    parentG.appendChild(badge);
  }

  function refreshInitBadges(){
    const gTokens = document.getElementById('world-tokens');
    if (!gTokens) return;

    const currentId = (initOrder && initOrder.length && initIndex >= 0) ? initOrder[initIndex].id : null;

    gTokens.querySelectorAll('g.token').forEach(g => {
      const id = g.dataset.id;
      const rTok = Number(g.dataset.rtok) || 24;
      const roll = initRolls.get(id);
      renderInitBadge(g, roll, rTok);

      // ✅ FIX: use 'id', not undefined 'tok'
      const meta = MechMenu.core?.mechMeta?.get(id);
      renderMvBadge(g, meta?.mv || null, rTok);

      const badge = g.querySelector(':scope > g.init-badge');
      if (badge){
        if (id === currentId) badge.classList.add('is-current');
        else badge.classList.remove('is-current');
      }
    });
  }

  // ---------- Mech index loader ----------
  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }

  async function loadUnifiedMechIndex(INDEX_BASE){
    try {
      // Prefer new manifest.json
      const manifest = await fetchJson(`${INDEX_BASE}manifest.json`);
      const rows = Array.isArray(manifest) ? manifest : (manifest.mechs || manifest || []);
      const out = [];
      rows.forEach(m => {
        const model = (m.model || '').toUpperCase();
        const display = m.displayName || [m.name, m.model].filter(Boolean).join(' ').trim();
        if (!model || !display) return;
        const walk = +(m.movement?.walk ?? 0);
        const jump = +(m.movement?.jump ?? 0);
        const run  = Math.ceil(walk * 1.5);
        out.push({
          id: model,
          name: display,
          mv: { walk, run, jump },
          path: m.path || m.file || '',
          meta: {
            chassis: m.name || '',
            mass: m.mass,
            techBase: m.techBase,
            era: m.era,
            role: m.role,
            source: m.source
          }
        });
      });
      return { kind: 'manifest', list: out };
    } catch (e) {
      // Fallback to legacy mechs.json (thin index only)
      const legacy = await fetchJson(`${INDEX_BASE}mechs.json`);
      const rows = Array.isArray(legacy) ? legacy : (legacy.mechs || []);
      const out = rows
        .filter(x => x.id && x.name)
        .map(x => ({ id: x.id.toUpperCase(), name: x.name, mv: null, path: '', meta: {} }));
      return { kind: 'legacy', list: out };
    }
  }

  async function loadMechIndex(){
    try{
      const INDEX_BASE = MechMenu.core?.INDEX_BASE || 'assets/';
      const { kind, list } = await loadUnifiedMechIndex(INDEX_BASE);
      MECH_INDEX = list;

      mechById.clear();
      mechByName.clear();
      if (el.mechListData) el.mechListData.replaceChildren();

      list.forEach(row => {
        const up = row.id.toUpperCase();
        mechById.set(up, row);
        mechByName.set(row.name.toLowerCase(), up);
        if (el.mechListData){
          const opt = document.createElement('option');
          opt.value = row.name;   // user-friendly label
          opt.label = up;         // code hint
          el.mechListData.appendChild(opt);
        }
      });

      if (kind === 'legacy') console.warn('[Index] Using legacy mechs.json (no MV/path).');
    } catch (err){
      console.warn('Mech index load failed', err);
    }
  }

  // ---------- UI wiring ----------
  function wireUi(){
    // Add mech
    el.btnAddMech && el.btnAddMech.addEventListener('click', addMechFromForm);
    el.mechName && el.mechName.addEventListener('keydown', e => { if (e.key === 'Enter') addMechFromForm(); });

    // Roster actions (event delegation)
    el.mechList && el.mechList.addEventListener('click', onRosterClick);

    // Initiative
    el.btnRollInitAll && el.btnRollInitAll.addEventListener('click', rollInitAll);
    el.btnClearInit   && el.btnClearInit.addEventListener('click', clearInit);
    el.btnNextTurn    && el.btnNextTurn.addEventListener('click', nextTurn);

    // Export/Import roster
    el.btnExportMechs && el.btnExportMechs.addEventListener('click', exportRoster);
    if (el.btnImportMechs && el.importFile){
      el.btnImportMechs.addEventListener('click', ()=> el.importFile.click());
      el.importFile.addEventListener('change', onImportFile);
    }

    // Optional Flechs shortcuts: just ensure stage focus if you use docks externally
    el.btnFlechsP1 && el.btnFlechsP1.addEventListener('click', ()=> { /* no-op here */ });
    el.btnFlechsP2 && el.btnFlechsP2.addEventListener('click', ()=> { /* no-op here */ });
  }

  // ---------- Mech add / roster ----------
  function addMechFromForm(){
    const core = MechMenu.core;
    if (!core) return;

    const rawInput = (el.mechName?.value || '').trim();
    const { tokenLabel, displayName, mv, path } = resolveMech(rawInput);

    const pilot = (el.pilotName?.value || '').trim();
    const team  = (el.teamSelect?.value || 'Alpha');
    const colorIndex = teamNameToColorIndex(team);

    const id = core.addTokenAtViewCenter(tokenLabel, colorIndex);
    core.mechMeta.set(id, {
      name: displayName,
      pilot, team,
      mv: mv || null,
      dataPath: path || ''
    });

    rebuildRoster();
    // init list stays unless you want to auto-enlist new mechs into init
    core.saveLocal?.();

    if (el.mechName) el.mechName.value = '';
    if (el.pilotName) el.pilotName.value = '';
    core.requestRender?.();
  }

  function rebuildRoster(){
    const core = MechMenu.core;
    if (!core || !el.mechList) return;
    el.mechList.replaceChildren();
    (core.tokens || []).forEach(t => {
      const meta = core.mechMeta.get(t.id) || { name: t.label, pilot:'', team:'Alpha' };
      const li = document.createElement('li');
      li.dataset.id = t.id;
      li.innerHTML = `
        <div class="row between">
          <div>
            <strong>${meta.name || t.label || 'MECH'}</strong>
            ${meta.pilot ? `<div class="small muted">Pilot: ${meta.pilot}</div>` : ''}
            <div class="small muted">Team: ${meta.team || '—'}</div>
          </div>
          <div class="mini-actions">
            <button class="btn sm" data-act="select">Select</button>
            <button class="btn sm" data-act="center">Center</button>
            <button class="btn sm" data-act="turnL">⟲</button>
            <button class="btn sm" data-act="turnR">⟳</button>
            <button class="btn sm" data-act="bigger">＋</button>
            <button class="btn sm" data-act="smaller">－</button>
            <button class="btn sm" data-act="delete">🗑</button>
          </div>
        </div>
      `;
      el.mechList.appendChild(li);
    });
  }

  function onRosterClick(e){
    const core = MechMenu.core;
    if (!core) return;

    const btn = e.target.closest('button'); if (!btn) return;
    const li = e.target.closest('li'); if (!li) return;
    const id = li.dataset.id;
    const tok = (core.tokens || []).find(t => t.id === id); if (!tok) return;

    switch (btn.dataset.act) {
      case 'select':
        core.selectToken?.(id);
        core.requestRender?.();
        break;
      case 'center':
        if (typeof core.centerOnToken === 'function') {
          core.centerOnToken(tok);
        } else {
          // fallback: center via viewBox math if core didn't provide helper
          try {
            const c = tileCenter(tok.q, tok.r);
            const vb = svg.viewBox.baseVal;
            camera.x = c.x - (vb.width/2);
            camera.y = c.y - (vb.height/2);
            camera.setViewBox();
          } catch {}
        }
        break;
      case 'turnL':
        tok.angle = ((tok.angle||0) - 60 + 360) % 360; core.requestRender?.(); core.saveLocal?.(); break;
      case 'turnR':
        tok.angle = ((tok.angle||0) + 60) % 360; core.requestRender?.(); core.saveLocal?.(); break;
      case 'bigger':
        tok.scale = clamp((tok.scale||1) * 1.10, 0.4, 2.0); core.requestRender?.(); core.saveLocal?.(); break;
      case 'smaller':
        tok.scale = clamp((tok.scale||1) / 1.10, 0.4, 2.0); core.requestRender?.(); core.saveLocal?.(); break;
      case 'delete':
        core.tokens = (core.tokens || []).filter(x => x.id !== id);
        core.mechMeta.delete(id);
        // also remove from init order if present
        initOrder = initOrder.filter(x => x.id !== id);
        if (initIndex >= initOrder.length) initIndex = initOrder.length ? initOrder.length - 1 : -1;
        rebuildRoster(); rebuildInit(); core.requestRender?.(); core.saveLocal?.();
        break;
    }
  }

  // ---------- Initiative ----------
  function roll2d6(){ return (Math.floor(Math.random()*6)+1) + (Math.floor(Math.random()*6)+1); }

  function rollInitAll(){
    const core = MechMenu.core;
    if (!core) return;
    initOrder = (core.tokens || [])
      .map(t => ({ id: t.id, roll: roll2d6() }))
      .sort((a,b)=> b.roll - a.roll);
    initIndex = initOrder.length ? 0 : -1;
    rebuildInit();
    core.requestRender?.(); // optional—your render draws badges per token
  }

  function clearInit(){
    initOrder = []; initIndex = -1;
    rebuildInit();
    MechMenu.core?.requestRender?.();
  }

  function nextTurn(){
    if (!initOrder.length) return;
    initIndex = (initIndex + 1) % initOrder.length;
    rebuildInit();
    MechMenu.core?.requestRender?.();
  }

  function rebuildInit(){
    if (!el.initList) return;
    el.initList.replaceChildren();

    // rebuild the id -> roll map from initOrder
    initRolls = new Map(initOrder.map(e => [e.id, e.roll]));

    initOrder.forEach((entry, idx) => {
      const tok = (MechMenu.core?.tokens || []).find(t => t.id === entry.id);
      if (!tok) return;
      const meta = MechMenu.core?.mechMeta?.get(entry.id) || { name: tok.label };
      const li = document.createElement('li');
      if (idx === initIndex) li.classList.add('current');
      li.innerHTML = `<strong>${meta.name || tok.label}</strong> — roll: <em>${entry.roll}</em>`;
      el.initList.appendChild(li);
    });

    // repaint badges if tokens are already on DOM
    refreshInitBadges();
  }

  // ---------- Export/Import (mech roster only) ----------
  function exportRoster(){
    const core = MechMenu.core;
    if (!core) return;
    const out = (core.tokens || []).map(t => ({
      id: t.id, q:t.q, r:t.r, scale:t.scale, angle:t.angle, colorIndex:t.colorIndex,
      label: t.label, meta: core.mechMeta.get(t.id) || null
    }));
    const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mechs.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function onImportFile(e){
    const core = MechMenu.core;
    if (!core) return;
    const f = e.target.files?.[0]; if (!f) return;

    const r = new FileReader();
    r.onload = ()=>{
      try{
        const arr = JSON.parse(r.result);
        if (!Array.isArray(arr)) throw new Error('Invalid file');
        arr.forEach(m=>{
          const id = ((core.tokens || []).find(t=>t.id===m.id))
            ? (String(Date.now())+Math.random().toString(16).slice(2,6))
            : (m.id || (String(Date.now())+Math.random().toString(16).slice(2,6)));

          const tok = {
            id,
            q: clamp(m.q||0,0,Infinity), // clamped later by your render path
            r: clamp(m.r||0,0,Infinity),
            scale: clamp(m.scale||1,0.4,2),
            angle: (m.angle||0)%360,
            colorIndex: m.colorIndex || 0,
            label: (m.label || m.meta?.name || 'MECH').slice(0,24)
          };
          (core.tokens || []).push(tok);
          if (m.meta) core.mechMeta.set(id, m.meta);
        });
        rebuildRoster(); core.requestRender?.(); core.saveLocal?.();
      } catch(err){ alert('Import failed: '+err.message); }
      el.importFile.value = '';
    };
    r.readAsText(f);
  }

  // ---------- expose ----------
  global.MechMenu = MechMenu;

})(window);
