/*!
 * MSS:84 — Structures (Buildings / Walls / Gates)
 * Drop-in module: /modules/structures.js
 *
 * Public API (window.MSS_Structures):
 *   init(opts)                -> initialize with helpers { hexToPx, pxToHex, getTileHeight, registerLosProvider, onMapTransform, publish, subscribe }
 *   mountUI(containerSel)     -> build UI controls in given container element
 *   loadCatalog(url)          -> load /modules/catalog.json (or another URL)
 *   serialize()               -> array for save
 *   hydrate(structuresArray)  -> restore from save
 *   clear()                   -> remove all placed structures, re-render
 *   bindLocalStorage(fn)      -> auto-save/restore to localStorage key from fn()
 *   getSurfaceHeight(q,r)     -> surface/roof height at hex (for LOS)
 */
(function(){
  const API = {};
  const STATE = {
    inited:false,
    tool:true,                  // always ON (no enable checkbox)
    catalog:{version:1, types:[], defs:[]},
    defsById:new Map(),
    list:[],                    // {defId, anchor:{q,r}, rot}
    selectedId:null,
    ghost:null,                 // {defId, rot, anchor:{q,r}}
    moveMode:false,
    drag:{ on:false, idx:null },

    // helpers injected by init()
    hexToPx:null,
    pxToHex:null,
    getTileHeight:(q,r)=>0,
    registerLosProvider:null,
    onMapTransform:null,
    publish:null,
    subscribe:null,

    // DOM
    root:null,           // <g id="world-structures">
    defsNode:null,       // <defs> in main #svg
    ui:null,

    _unitScale:null
  };

  /* --------------------- DOM util --------------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const elNS = (n,attrs)=>{ const x=document.createElementNS(NS,n); if(attrs) for(const k in attrs) x.setAttribute(k,attrs[k]); return x; };
  const el   = (n,attrs)=>{ const x=document.createElement(n); if(attrs) for(const k in attrs){ if(k==='textContent') x.textContent=attrs[k]; else x.setAttribute(k,attrs[k]); } return x; };
  function ensureLayer(){
    const mapSvg = document.getElementById('svg');
    if (!mapSvg) return;
    let layer = document.getElementById('world-structures');
    if (!layer){
      const tokens = document.getElementById('world-tokens');
      layer = elNS('g', { id:'world-structures' });
      layer.classList.add('layer-structures');
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(layer, tokens);
      else mapSvg.appendChild(layer);
    }
    STATE.root = layer;
    const defs = mapSvg.querySelector('defs');
    STATE.defsNode = defs || mapSvg.insertBefore(elNS('defs'), mapSvg.firstChild);
  }
  const removeKids = n => { while(n.firstChild) n.removeChild(n.firstChild); };
  function pruneOrphans(){
    if (!STATE.root) return;
    const max = STATE.list.length;
    STATE.root.querySelectorAll('.structure').forEach(n=>{
      const idx = Number(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx >= max) n.remove();
    });
  }

  /* --------------------- Math ------------------------- */
  function unitScale(){
    if (STATE._unitScale) return STATE._unitScale;
    try{
      const a = STATE.hexToPx(0,0) || {x:0,y:0};
      const b = STATE.hexToPx(1,0) || {x:1,y:0};
      STATE._unitScale = Math.hypot(b.x-a.x, b.y-a.y) || 100;
    }catch{ STATE._unitScale = 100; }
    return STATE._unitScale;
  }

  /* --------------------- Render ----------------------- */
  function worldToScreen(q,r){ const p = STATE.hexToPx(q,r); return {x:p.x,y:p.y}; }
  function ensureGroupFor(i){
    const id='struct-'+i;
    let g = STATE.root.querySelector('#'+CSS.escape(id));
    if (!g){ g = elNS('g', { id, class:'structure' }); STATE.root.appendChild(g); }
    return g;
  }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    const sc = unitScale();
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0}) scale(${sc})`);
  }

  // draw a single shape; honor fill, stroke, sw if present
  function drawShape(container, s){
    let n=null;
    if (s.kind==='rect') {
      n = elNS('rect', { x:(s.x!=null?s.x:-(s.w||1)/2), y:(s.y!=null?s.y:-(s.h||1)/2), width:s.w||1, height:s.h||1 });
      if (s.rx!=null) n.setAttribute('rx', s.rx);
    } else if (s.kind==='polygon') {
      const pts=(s.points||[]).map(p=>p.join(',')).join(' ');
      n = elNS('polygon', { points: pts });
    } else if (s.kind==='polyline') {
      const pts=(s.points||[]).map(p=>p.join(',')).join(' ');
      n = elNS('polyline', { points: pts });
    } else { // path
      n = elNS('path', { d: s.d||'' });
    }

    // style: class OR explicit fill/stroke/sw
    if (s.class) n.setAttribute('class', s.class);
    if (s.fill)  n.setAttribute('fill', s.fill);
    if (s.stroke) n.setAttribute('stroke', s.stroke);
    if (s.sw != null) n.setAttribute('stroke-width', s.sw);

    container.appendChild(n);
  }

  function renderOne(i){
    const item = STATE.list[i];
    const def  = STATE.defsById.get(item.defId);
    if (!def) return;
    const g = ensureGroupFor(i);
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', def.id);
    g.setAttribute('class', 'structure'+(STATE.selectedId===i?' selected':''));
    removeKids(g);
    const shapes = def.shapes || [];
    for (const s of shapes) drawShape(g, s);
    // small hit rect for easy picking
    const hit = elNS('rect', { class:'hit', x:-0.52, y:-0.52, width:1.04, height:1.04, fill:'transparent', stroke:'transparent' });
    g.appendChild(hit);
    applyTransform(g, item.anchor, item.rot||0);
    g.style.pointerEvents = 'auto';
  }

  function renderGhost(){
    const old = STATE.root && STATE.root.querySelector('#ghost-structure');
    if (old) old.remove();
    if (!STATE.ghost || !STATE.root) return;
    const def = STATE.defsById.get(STATE.ghost.defId);
    if (!def) return;
    const g = elNS('g', { id:'ghost-structure', class:'structure ghost' });
    for (const s of (def.shapes||[])) drawShape(g, s);
    applyTransform(g, STATE.ghost.anchor, STATE.ghost.rot||0);
    g.style.pointerEvents = 'none';
    STATE.root.appendChild(g);
  }

  function renderAll(){
    if (!STATE.root) ensureLayer();
    pruneOrphans();
    for (let i=0;i<STATE.list.length;i++) renderOne(i);
    renderGhost();
  }

  /* ----------------- Interaction ---------------------- */
  function setGhost(defId){ STATE.ghost = { defId, rot:0, anchor:{q:0,r:0} }; renderGhost(); }
  function placeGhostAt(q,r){ if (!STATE.ghost) return; STATE.ghost.anchor={q,r}; renderGhost(); }
  function commitGhost(){
    if (!STATE.ghost) return;
    STATE.list.push({ defId: STATE.ghost.defId, anchor: {...STATE.ghost.anchor}, rot: STATE.ghost.rot||0 });
    STATE.selectedId = STATE.list.length-1;
    STATE.ghost = null; renderAll(); pulseChanged();
  }
  function rotateSelected(deltaSteps){
    if (STATE.selectedId==null){
      if (STATE.ghost){ STATE.ghost.rot = ((STATE.ghost.rot||0)+deltaSteps*60+360)%360; renderGhost(); }
      return;
    }
    const it = STATE.list[STATE.selectedId];
    it.rot = ((it.rot||0)+deltaSteps*60+360)%360;
    renderOne(STATE.selectedId); pulseChanged();
  }
  function deleteSelected(){
    if (STATE.selectedId==null) return;
    STATE.list.splice(STATE.selectedId,1);
    STATE.selectedId = null;
    pruneOrphans();
    renderAll(); pulseChanged();
  }

  function pickSvgPoint(evt){
    const svg = document.getElementById('svg'); if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x=evt.clientX; pt.y=evt.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function onPointerDown(evt){
    const target = evt.target;
    const g = target.closest && target.closest('.structure');

    // Click a structure to select / maybe start drag (when Select/Move active)
    if (g){
      STATE.selectedId = Number(g.getAttribute('data-index'));
      renderAll();
      if (STATE.moveMode){ STATE.drag.on=true; STATE.drag.idx=STATE.selectedId; }
      evt.stopPropagation(); return;
    }
    // Click board while placing → commit
    if (STATE.ghost){ commitGhost(); evt.stopPropagation(); return; }
  }
  function onPointerMove(evt){
    // Move ghost
    if (STATE.ghost){
      const p = pickSvgPoint(evt); if (!p) return;
      const hex = STATE.pxToHex(p.x,p.y); placeGhostAt(hex.q|0, hex.r|0); return;
    }
    // Dragging a selected item
    if (STATE.drag.on && STATE.drag.idx!=null){
      const p = pickSvgPoint(evt); if (!p) return;
      const hex = STATE.pxToHex(p.x,p.y);
      const it = STATE.list[STATE.drag.idx]; if (it){ it.anchor = { q:hex.q|0, r:hex.r|0 }; renderOne(STATE.drag.idx); }
    }
  }
  function onPointerUp(){
    if (STATE.drag.on){ STATE.drag.on=false; const i=STATE.drag.idx; STATE.drag.idx=null; if (i!=null) pulseChanged(); }
  }
  function attachPointerHandlers(){
    const svg = document.getElementById('svg'); if (!svg) return;
    svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  /* --------------- Heights / LOS ---------------------- */
  function getSurfaceHeight(q,r){
    // Simple version: max tile height vs. any structure footprint cell height
    let maxH = (typeof STATE.getTileHeight==='function' ? STATE.getTileHeight(q,r) : 0) || 0;
    for (let i=0;i<STATE.list.length;i++){
      const it = STATE.list[i];
      const def = STATE.defsById.get(it.defId);
      if (!def || !Array.isArray(def.footprint)) continue;
      // rotate footprint cells based on rot (60° steps)
      const steps = ((it.rot||0)/60)|0;
      for (let idx=0; idx<def.footprint.length; idx++){
        const rot = rotateAxial(def.footprint[idx].dq, def.footprint[idx].dr, steps);
        const cq = it.anchor.q + rot.dq, cr = it.anchor.r + rot.dr;
        if (cq===q && cr===r){
          const h = heightAt(def, idx, q, r);
          if (h!=null) maxH = Math.max(maxH, h);
        }
      }
    }
    return maxH;
  }
  API.getSurfaceHeight = getSurfaceHeight;

  // axial (dq,dr) rotation around origin by 60° * steps
  function rotateAxial(dq,dr,steps){
    const s=((steps%6)+6)%6;
    let x=dq, z=dr, y=-x-z;
    for (let i=0;i<s;i++){ const nx=-z, ny=-x, nz=-y; x=nx; y=ny; z=nz; }
    return { dq:x, dr:z };
  }
  function heightAt(def, cellIdx, q, r){
    const mode = def.heightMode || 'fixed';
    if (mode==='fixed') return def.height||0;
    if (mode==='cells') return (def.cellHeights||[])[cellIdx] ?? 0;
    if (mode==='tile'){  // at least minHeight over terrain at (q,r)
      const base = (typeof STATE.getTileHeight==='function'? STATE.getTileHeight(q,r):0) || 0;
      return Math.max(base, def.minHeight||0);
    }
    return 0;
  }

  /* ---------------- Save / Load ----------------------- */
  function serialize(){
    return STATE.list.map(it => ({
      defId: it.defId,
      anchor: { q: it.anchor.q, r: it.anchor.r },
      rot: it.rot||0
    }));
  }
  API.serialize = serialize;

  function hydrate(arr){
    STATE.list = Array.isArray(arr)? arr.map(x => ({
      defId: x.defId,
      anchor: { q:(x.anchor?.q|0), r:(x.anchor?.r|0) },
      rot: x.rot|0
    })) : [];
    STATE.selectedId = null;
    renderAll();
  }
  API.hydrate = hydrate;

  function clear(){ STATE.list=[]; STATE.selectedId=null; renderAll(); pulseChanged(); }
  API.clear = clear;

  /* -------------------- UI --------------------------- */
  function mountUI(sel){
    const host = document.querySelector(sel);
    if (!host){ console.warn('[Structures] UI container not found:', sel); return; }

    const root = el('div', { class:'structures-ui' });
    root.innerHTML = `
      <div class="group">
        <div class="types" id="structuresTypeList"></div>
        <div class="row">
          <select id="structuresDefSelect" class="def-select"></select>
        </div>
      </div>

      <div class="group row gap" id="structToolbar">
        <button class="btn sm" id="btnStructPlace" title="Place structure">Place</button>
        <button class="btn sm" id="btnStructMove"  title="Select / Move">Select/Move</button>
        <button class="icon sm" id="btnStructRotL" title="Rotate left">⟲</button>
        <button class="icon sm" id="btnStructRotR" title="Rotate right">⟲</button>
        <button class="icon sm danger" id="btnStructDelete" title="Delete selected">🗑</button>
      </div>
    `;
    host.replaceChildren(root);
    STATE.ui = root;

    const selDef = root.querySelector('#structuresDefSelect');

    // events
    const btnPlace = root.querySelector('#btnStructPlace');
    const btnMove  = root.querySelector('#btnStructMove');
    const btnRotL  = root.querySelector('#btnStructRotL');
    const btnRotR  = root.querySelector('#btnStructRotR');
    const btnDel   = root.querySelector('#btnStructDelete');

    let toolMode = 'move'; // 'place' | 'move'

    function setToolMode(m){
      const isPlace = (m === 'place');
      STATE.moveMode = !isPlace;
      btnPlace.classList.toggle('active',  isPlace);
      btnMove.classList.toggle('active',  !isPlace);
      if (isPlace){
        const id = selDef.value || '';
        if (id) setGhost(id);
      } else {
        STATE.ghost = null; renderGhost();
      }
    }

    btnPlace.addEventListener('click', ()=> {
      const nowPlace = btnPlace.classList.contains('active');
      setToolMode(nowPlace ? 'move' : 'place');
    });
    btnMove .addEventListener('click', ()=> setToolMode('move'));
    btnRotL .addEventListener('click', ()=> rotateSelected(-1));
    btnRotR .addEventListener('click', ()=> rotateSelected(+1));
    btnDel  .addEventListener('click', ()=> deleteSelected());

    selDef.addEventListener('change', ()=>{
      if (toolMode==='place'){
        const id = selDef.value || '';
        if (id) setGhost(id); else { STATE.ghost=null; renderGhost(); }
      }
    });

    buildUILists();
    setToolMode('move');
    injectCSS();
  }
  API.mountUI = mountUI;

  function buildUILists(){
    if (!STATE.ui) return;
    const tEl = STATE.ui.querySelector('#structuresTypeList');
    const sEl = STATE.ui.querySelector('#structuresDefSelect');
    if (!tEl || !sEl) return;

    tEl.innerHTML = '';
    sEl.innerHTML = '<option value="">— pick a definition —</option>';

    // type chips
    const mkChip = (t)=> {
      const b = el('button', { class:'chip', type:'button', textContent: t.name });
      b.addEventListener('click', ()=>{
        tEl.querySelectorAll('.chip').forEach(n=>n.classList.remove('selected'));
        b.classList.add('selected');
        renderDefsDropdown(t.id);
      });
      return b;
    };
    if ((STATE.catalog.types||[]).length){
      STATE.catalog.types.forEach(t => tEl.appendChild(mkChip(t)));
      // select first type by default
      const first = tEl.querySelector('.chip'); first && first.click();
    } else {
      // no types -> just dump all defs
      renderDefsDropdown(null);
    }
  }

  function renderDefsDropdown(typeId){
    const sEl = STATE.ui.querySelector('#structuresDefSelect'); if (!sEl) return;
    sEl.innerHTML = '<option value="">— pick a definition —</option>';
    const defs = (STATE.catalog.defs||[]).filter(d => !typeId || d.type===typeId);
    defs.forEach(d=>{
      const opt = el('option'); opt.value=d.id; opt.textContent=d.name||d.id;
      sEl.appendChild(opt);
    });
  }

  /* ----------------- Hotkeys ------------------------- */
  let hotkeys=false;
  function attachHotkeys(){
    if (hotkeys) return; hotkeys = true;
    window.addEventListener('keydown', (e)=>{
      if (e.repeat) return;
      if (e.key==='q' || e.key==='Q'){ rotateSelected(-1); e.preventDefault(); }
      if (e.key==='e' || e.key==='E'){ rotateSelected(+1); e.preventDefault(); }
      if (e.key==='Delete'){ deleteSelected(); e.preventDefault(); }
      if (e.key==='Enter' && STATE.ghost){ commitGhost(); e.preventDefault(); }
    });
  }

  /* ----------------- Change pulse -------------------- */
  let _pulseChanged = function(){
    if (typeof STATE.publish === 'function'){
      STATE.publish('structures:changed', API.serialize());
    }
  };
  function pulseChanged(){ _pulseChanged(); }

  /* -------------------- Init ------------------------- */
  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css = document.createElement('style');
    css.id='structures-css';
    css.textContent = `
      :root { --bt-amber: #f0b000; --line: #2a2d33; }
      .structure.selected * { filter: drop-shadow(0 0 2px var(--bt-amber)); }
      .ghost :where(.bldg-body,.wall-body,.gate-closed,.gate-wing){ opacity:.5; }

      .structures-ui { font:12px system-ui, sans-serif; color: var(--ink, #ddd); }
      .structures-ui .row { display:flex; align-items:center; gap:8px; }
      .structures-ui .group { margin: 8px 0; }
      .structures-ui .chip { margin:2px 6px 6px 0; padding:3px 10px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:14px; cursor:pointer; }
      .structures-ui .chip.selected { border-color: var(--bt-amber); }
      .structures-ui .def-select { width:100%; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:#0f1115; color: inherit; }
      .structures-ui .btn, .structures-ui .icon { padding:4px 8px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
      .structures-ui .btn.sm, .structures-ui .icon.sm { font-size:12px; }
      .structures-ui .icon { width:28px; text-align:center; }
      .structures-ui .danger { border-color:#844; color:#f88; }
      .structures-ui .active { outline:1px solid var(--bt-amber); }
    `;
    document.head.appendChild(css);
  }

  function init(opts){
    if (STATE.inited) return;
    STATE.hexToPx = opts.hexToPx;
    STATE.pxToHex = opts.pxToHex;
    STATE.getTileHeight = opts.getTileHeight || STATE.getTileHeight;
    STATE.registerLosProvider = opts.registerLosProvider || null;
    STATE.onMapTransform = opts.onMapTransform || null;
    STATE.publish = opts.publish || null;
    STATE.subscribe = opts.subscribe || null;

    ensureLayer();
    attachPointerHandlers();
    attachHotkeys();

    if (typeof STATE.registerLosProvider === 'function'){
      STATE.registerLosProvider((q,r)=> getSurfaceHeight(q,r));
    }
    if (typeof STATE.onMapTransform === 'function'){
      STATE.onMapTransform(()=> renderAll());
    }
    injectCSS();
    STATE.inited = true;
    console.info('[Structures] ready');
  }
  API.init = init;

  /* ---------------- Catalog -------------------------- */
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('Failed to load catalog: '+res.status);
    ingestCatalog(await res.json());
    console.info('[Structures] catalog loaded:', url);
  }
  API.loadCatalog = loadCatalog;

  function clearCatalog(){
    STATE.catalog = {version:1, types:[], defs:[]};
    STATE.defsById.clear();
  }
  function ingestCatalog(json){
    clearCatalog();
    if (!json || !Array.isArray(json.defs)) throw new Error('Invalid catalog.json');
    STATE.catalog = json;
    for (const def of json.defs) STATE.defsById.set(def.id, def);
    // refresh UI if mounted
    if (STATE.ui) buildUILists();
  }

  /* -------------- Local Storage bind ----------------- */
  API.bindLocalStorage = function(getKey){
    if (typeof getKey !== 'function') return;
    // initial restore
    try{
      const key = getKey();
      const raw = localStorage.getItem(key);
      if (raw) API.hydrate(JSON.parse(raw));
    }catch{}
    // wrap change pulse
    _pulseChanged = function(){
      if (typeof STATE.publish === 'function'){
        STATE.publish('structures:changed', API.serialize());
      }
      try{
        const key = getKey();
        localStorage.setItem(key, JSON.stringify(API.serialize()));
      }catch{}
    };
  };

  /* --------------- Expose global --------------------- */
  window.MSS_Structures = API;

  /* ---------------- Wiring Notes ---------------------
     1) Include:
          /modules/structures.js
          /modules/catalog.json
     2) Module injects <g id="world-structures"> under #world-tokens.
     3) In your app (already done in script.js):
          MSS_Structures.init({...});
          MSS_Structures.loadCatalog('./modules/catalog.json');
          MSS_Structures.mountUI('#structuresPanel');
          MSS_Structures.bindLocalStorage(()=> `mss84.structures.${window.CURRENT_MAP_ID||'local'}`);
  ---------------------------------------------------- */
})();
