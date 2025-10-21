/*!
 * MSS:84 — Structures Module (Buildings / Walls / Gates)
 * Single-file drop-in: /modules/structures.js
 *
 * Public API (window.MSS_Structures):
 *   init(opts)                 -> initialize with engine helpers and options
 *   mountUI(containerSel)      -> build UI controls in given container element
 *   loadCatalog(url)           -> load /modules/catalog.json (or another URL)
 *   enableTool(on:boolean)     -> toggle interactivity
 *   serialize()                -> array for save
 *   hydrate(structuresArray)   -> restore from save
 *   clear()                    -> remove all placed structures, re-render
 *   bindLocalStorage(fn)       -> (optional) auto-save/restore to localStorage key from fn()
 *   onMapChanged()             -> call when current map changes; re-hydrates from new LS key
 *   getSurfaceHeight(q,r)      -> surface/roof height at hex (for movement/LOS)
 *
 * Notes:
 * - Shapes accept inline styling: { fill:"#20262c", stroke:"#9aa4ae", sw:0.05 }.
 * - Class-based styles still work; inline attrs override CSS.
 * - “Toggle” button only shows if any catalog def contains `states`.
 */
(function(){
  const API = {};
  const STATE = {
    inited:false,
    tool:false,
    catalog:{version:1, types:[], defs:[]},
    defsById:new Map(),
    // runtime structs
    list:[],             // {defId, anchor:{q,r}, rot, state?, skin?}
    selectedId:null,     // index into STATE.list
    ghost:null,          // {defId, rot, anchor:{q,r}} while placing
    // move/drag
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
    root:null,           // svg layer (g within main #svg)
    defsNode:null,       // <defs> for patterns etc within #svg
    ui:null,             // mounted UI root
    zBelowTokens: 20,
    zTokens:      30,
    // keys
    hotkeysAttached:false,
    _unitScale:null,
    // storage
    _getLocalKey:null,   // fn -> string key for localStorage
    _hasStates:false
  };

  /* ------------------------- Utility: DOM ------------------------- */
  function elNS(name, attrs){
    const n = document.createElementNS('http://www.w3.org/2000/svg', name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function el(name, attrs){
    const n = document.createElement(name);
    if (attrs) for (const k in attrs) {
      if (k === 'textContent') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    return n;
  }
  function ensureLayer(){
    // Use the main map SVG and create a group under world-tokens
    const mapSvg = document.getElementById('svg');
    if (!mapSvg) return;
    let layer = document.getElementById('world-structures');
    if (!layer){
      const tokens = document.getElementById('world-tokens');
      layer = elNS('g', { id:'world-structures' });
      layer.classList.add('layer-structures');
      if (tokens && tokens.parentNode){
        tokens.parentNode.insertBefore(layer, tokens); // below tokens
      } else {
        mapSvg.appendChild(layer);
      }
    }
    layer.style.pointerEvents = 'none'; // inert unless tool enabled
    STATE.root = layer;

    // defs should be in the main svg <defs>
    const defs = mapSvg.querySelector('defs');
    STATE.defsNode = defs || mapSvg.insertBefore(elNS('defs'), mapSvg.firstChild);
  }

  function removeChildren(n){ while(n.firstChild) n.removeChild(n.firstChild); }

  function pruneOrphans(){
    if (!STATE.root) return;
    const max = STATE.list.length;
    STATE.root.querySelectorAll('.structure').forEach(n=>{
      const idx = Number(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx >= max) n.remove();
    });
  }

  /* ------------------------- Utility: Math ------------------------ */
  // axial rotation of (dq,dr) around (0,0) in 60° steps.
  function rotateAxial(dq, dr, steps){
    const s = ((steps % 6)+6)%6;
    let q = dq, r = dr, x, z, y;
    x = q; z = r; y = -x - z;
    for (let i=0;i<s;i++){
      const nx = -z, ny = -x, nz = -y;
      x = nx; y = ny; z = nz;
    }
    return {dq:x, dr:z};
  }
  function unitScale(){
    if (STATE._unitScale) return STATE._unitScale;
    try{
      const a = STATE.hexToPx(0,0) || {x:0,y:0};
      const b = STATE.hexToPx(1,0) || {x:1,y:0};
      STATE._unitScale = Math.hypot((b.x-a.x),(b.y-a.y)) || 100;
    }catch(e){ STATE._unitScale = 100; }
    return STATE._unitScale;
  }

  /* ------------------------- Rendering ---------------------------- */
  function worldToScreen(q,r){
    const p = STATE.hexToPx(q,r);
    return { x:p.x, y:p.y };
  }

  function ensureGroupFor(i){
    const id = 'struct-'+i;
    let g = STATE.root.querySelector('#'+CSS.escape(id));
    if (!g){
      g = elNS('g', { id, class:'structure' });
      g.style.pointerEvents = STATE.tool ? 'auto' : 'none';
      STATE.root.appendChild(g);
    }
    return g;
  }

  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    const deg = (rot||0);
    const sc = unitScale();
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${deg}) scale(${sc})`);
  }

  // NEW: draw shape with inline style support
  function drawShape(container, shape){
    const base = {};
    if (shape.fill)   base.fill = shape.fill;
    if (shape.stroke) base.stroke = shape.stroke;
    if (shape.sw!=null) base['stroke-width'] = shape.sw;

    switch(shape.kind){
      case 'path': {
        const n = elNS('path', { d: shape.d, class: shape.class||'', ...base });
        n.setAttribute('vector-effect','non-scaling-stroke');
        container.appendChild(n); break;
      }
      case 'rect': {
        const n = elNS('rect', {
          x:shape.x, y:shape.y, width:shape.w, height:shape.h, rx:shape.rx||0,
          class: shape.class||'', ...base
        });
        n.setAttribute('vector-effect','non-scaling-stroke');
        container.appendChild(n); break;
      }
      case 'polyline': {
        const pts = (shape.points||[]).map(p=>p.join(',')).join(' ');
        const n = elNS('polyline', { points: pts, class: shape.class||'', ...base });
        n.setAttribute('vector-effect','non-scaling-stroke');
        container.appendChild(n); break;
      }
      case 'polygon': {
        const pts2 = (shape.points||[]).map(p=>p.join(',')).join(' ');
        const n = elNS('polygon', { points: pts2, class: shape.class||'', ...base });
        n.setAttribute('vector-effect','non-scaling-stroke');
        container.appendChild(n); break;
      }
    }
  }

  function footprintCells(def, anchor, rotSteps){
    const out = [];
    const steps = (rotSteps/60)|0;
    for (let idx=0; idx<def.footprint.length; idx++){
      const {dq,dr} = def.footprint[idx];
      const {dq:rq, dr:rr} = rotateAxial(dq,dr,steps);
      out.push({ q: anchor.q + rq, r: anchor.r + rr, idx });
    }
    return out;
  }

  function pickShapes(def, stateKey){
    if (def.states && Array.isArray(def.states)){
      const chosen = def.states.find(s=>s.key=== (stateKey || def.defaultState));
      if (chosen && Array.isArray(chosen.shapes)){
        return chosen.shapes;
      }
    }
    return def.shapes || [];
  }

  function renderOne(i){
    const item = STATE.list[i];
    const def = STATE.defsById.get(item.defId);
    if (!def) return;
    const g = ensureGroupFor(i);
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', def.id);
    g.setAttribute('class', 'structure'+(STATE.selectedId===i?' selected':''));
    removeChildren(g);
    const shapes = pickShapes(def, item.state);
    for (const s of shapes) drawShape(g, s);
    applyTransform(g, item.anchor, item.rot||0);
    // invisible 1×1 hit rect centered at origin for selection
    let hit = g.querySelector('.hit');
    if (!hit){
      hit = elNS('rect', { class:'hit', x:-0.52, y:-0.52, width:1.04, height:1.04, fill:'transparent', stroke:'transparent' });
      g.appendChild(hit);
    }
    g.style.pointerEvents = STATE.tool ? 'auto' : 'none';
  }

  function renderGhost(){
    const old = STATE.root && STATE.root.querySelector('#ghost-structure');
    if (old) old.remove();
    if (!STATE.tool || !STATE.ghost || !STATE.root) return;
    const def = STATE.defsById.get(STATE.ghost.defId);
    if (!def) return;
    const g = elNS('g', { id:'ghost-structure', class:'structure ghost' });
    const shapes = pickShapes(def, def.defaultState);
    for (const s of shapes) drawShape(g, s);
    applyTransform(g, STATE.ghost.anchor, STATE.ghost.rot||0);
    g.style.pointerEvents = 'none';
    STATE.root.appendChild(g);
  }

  function renderAll(){
    if (!STATE.root) ensureLayer();
    pruneOrphans();
    for (let i=0;i<STATE.list.length;i++){
      renderOne(i);
    }
    renderGhost();
  }

  /* ------------------------ Interaction -------------------------- */
  function enableTool(on){
    STATE.tool = !!on;
    if (STATE.root){
      const all = STATE.root.querySelectorAll('.structure');
      all.forEach(g=> g.style.pointerEvents = STATE.tool ? 'auto' : 'none');
      STATE.root.classList.toggle('tool-on', STATE.tool);
    }
    if (!STATE.tool){
      STATE.ghost = null;
      STATE.selectedId = null;
      renderAll();
    }
  }
  API.enableTool = enableTool;

  function setGhost(defId){
    STATE.ghost = { defId, rot:0, anchor:{q:0,r:0} };
    renderGhost();
  }

  function placeGhostAt(q,r){
    if (!STATE.ghost) return;
    STATE.ghost.anchor = {q,r};
    renderGhost();
  }

  function commitGhost(){
    if (!STATE.ghost) return;
    STATE.list.push({
      defId: STATE.ghost.defId,
      anchor: { ...STATE.ghost.anchor },
      rot: STATE.ghost.rot || 0,
      state: undefined
    });
    STATE.selectedId = STATE.list.length-1;
    STATE.ghost = null;
    renderAll();
    pulseChanged();
  }

  function rotateSelected(deltaSteps){
    if (STATE.selectedId==null) {
      if (STATE.ghost){
        STATE.ghost.rot = ((STATE.ghost.rot||0) + deltaSteps*60 + 360) % 360;
        renderGhost();
      }
      return;
    }
    const item = STATE.list[STATE.selectedId];
    item.rot = ((item.rot||0) + deltaSteps*60 + 360) % 360;
    renderOne(STATE.selectedId);
    pulseChanged();
  }

  function deleteSelected(){
    if (STATE.selectedId==null) return;
    STATE.list.splice(STATE.selectedId,1);
    STATE.selectedId = null;
    pruneOrphans();
    renderAll();
    pulseChanged();
  }

  function toggleSelectedState(){
    if (!STATE._hasStates) return; // inert when no states in catalog
    if (STATE.selectedId==null) return;
    const item = STATE.list[STATE.selectedId];
    const def  = STATE.defsById.get(item.defId);
    if (!def || !def.states) return;
    const keys = def.states.map(s=>s.key);
    const cur  = item.state || def.defaultState || keys[0];
    const idx  = keys.indexOf(cur);
    const next = keys[(idx+1)%keys.length];
    item.state = next;
    renderOne(STATE.selectedId);
    pulseChanged();
  }

  function pickSvgPoint(evt){
    const mapSvg = document.getElementById('svg');
    if (!mapSvg) return null;
    const pt = mapSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = mapSvg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function onPointerDown(evt){
    if (!STATE.tool) return;
    const target = evt.target;
    const g = target.closest && target.closest('.structure');

    // Click a structure
    if (g){
      STATE.selectedId = Number(g.getAttribute('data-index'));
      renderAll();
      if (STATE.moveMode){
        STATE.drag.on  = true;
        STATE.drag.idx = STATE.selectedId;
      }
      evt.stopPropagation();
      return;
    }

    // Click board while adding -> commit
    if (STATE.ghost){
      commitGhost();
      evt.stopPropagation();
    }
  }

  function onPointerMove(evt){
    if (!STATE.tool) return;

    // Move ghost
    if (STATE.ghost){
      const svgPt = pickSvgPoint(evt);
      if (!svgPt) return;
      const hex = STATE.pxToHex(svgPt.x, svgPt.y);
      placeGhostAt(hex.q|0, hex.r|0);
      return;
    }

    // Dragging a selected item
    if (STATE.drag.on && STATE.drag.idx!=null){
      const svgPt = pickSvgPoint(evt);
      if (!svgPt) return;
      const hex = STATE.pxToHex(svgPt.x, svgPt.y);
      const item = STATE.list[STATE.drag.idx];
      if (item){
        item.anchor = { q: hex.q|0, r: hex.r|0 };
        renderOne(STATE.drag.idx);
      }
    }
  }

  function onPointerUp(){
    if (STATE.drag.on){
      STATE.drag.on = false;
      const idx = STATE.drag.idx; STATE.drag.idx = null;
      if (idx!=null) { pulseChanged(); }
    }
  }

  function attachPointerHandlers(){
    const mapSvg = document.getElementById('svg');
    if (mapSvg){
      mapSvg.addEventListener('pointerdown', onPointerDown);
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  /* ------------------------ Heights / LOS ------------------------- */
  function getSurfaceHeight(q,r){
    let maxH = (typeof STATE.getTileHeight==='function' ? STATE.getTileHeight(q,r) : 0) || 0;
    for (let i=0;i<STATE.list.length;i++){
      const item = STATE.list[i];
      const def  = STATE.defsById.get(item.defId);
      if (!def) continue;
      const cells = footprintCells(def, item.anchor, item.rot||0);
      for (const c of cells){
        if (c.q===q && c.r===r){
          const h = heightAt(def, c.idx, item.state, c.q, c.r);
          if (h!=null) maxH = Math.max(maxH, h);
        }
      }
    }
    return maxH;
  }
  API.getSurfaceHeight = getSurfaceHeight;

  function heightAt(def, cellIdx, stateKey, q, r){
    if (def.states && Array.isArray(def.states)){
      const chosen = def.states.find(s=>s.key=== (stateKey || def.defaultState));
      if (chosen){
        if (chosen.heightMode==='fixed') return chosen.height||0;
        if (chosen.heightMode==='tile')  return Math.max((typeof STATE.getTileHeight==='function'? STATE.getTileHeight(q,r):0) || 0, chosen.minHeight||0);
      }
    }
    const mode = def.heightMode || 'fixed';
    if (mode==='fixed') return def.height||0;
    if (mode==='cells'){
      const arr = def.cellHeights||[];
      return arr[cellIdx] ?? 0;
    }
    if (mode==='tile'){
      const minH = def.minHeight||0;
      const base = (typeof STATE.getTileHeight==='function' ? STATE.getTileHeight(q,r) : 0) || 0;
      return Math.max(base, minH);
    }
    return 0;
  }

  /* ------------------------- Save / Load -------------------------- */
  function serialize(){
    return STATE.list.map(it => ({
      defId: it.defId,
      anchor: { q: it.anchor.q, r: it.anchor.r },
      rot: it.rot||0,
      state: it.state,
      skin: it.skin
    }));
  }
  API.serialize = serialize;

  function hydrate(arr){
    STATE.list = Array.isArray(arr)? arr.map(x => ({
      defId: x.defId,
      anchor: { q:(x.anchor?.q|0), r:(x.anchor?.r|0) },
      rot: x.rot|0,
      state: x.state,
      skin: x.skin
    })) : [];
    STATE.selectedId = null;
    renderAll();
  }
  API.hydrate = hydrate;

  function clear(){
    STATE.list = [];
    STATE.selectedId = null;
    renderAll();
    pulseChanged();
  }
  API.clear = clear;

  /* --------------------------- UI -------------------------------- */
  function mountUI(sel){
    const host = document.querySelector(sel);
    if (!host){
      console.warn('[Structures] UI container not found:', sel);
      return;
    }
    const root = el('div', { class:'structures-ui' });
    root.innerHTML = `
      <div class="row between">
        <strong>Structures</strong>
        <label class="sw"><input type="checkbox" id="structsEnable"> Enable</label>
      </div>
      <div class="group">
        <details open>
          <summary>Catalog</summary>
          <div class="types" id="structuresTypeList"></div>
          <div class="defs" id="structuresDefList"></div>
          <button class="btn sm" id="btnStructAdd">Add</button>
        </details>
      </div>
      <div class="group row gap">
        <button class="btn sm" id="btnStructMove">Select/Move</button>
        <button class="btn sm" id="btnStructRotL">◀ Rotate</button>
        <button class="btn sm" id="btnStructRotR">Rotate ▶</button>
        <button class="btn sm" id="btnStructToggleState" style="display:none">Toggle</button>
        <button class="btn sm danger" id="btnStructDelete">Delete</button>
      </div>
    `;
    host.appendChild(root);
    STATE.ui = root;

    // events
    root.querySelector('#structsEnable').addEventListener('change', (e)=> enableTool(e.target.checked));
    root.querySelector('#btnStructAdd').addEventListener('click', ()=> {
      const sel = root.querySelector('.def-item.selected');
      if (!sel) { alert('Pick a definition first'); return; }
      setGhost(sel.getAttribute('data-id'));
    });
    const btnMove = root.querySelector('#btnStructMove');
    btnMove.addEventListener('click', ()=>{
      STATE.moveMode = !STATE.moveMode;
      STATE.ghost = null;
      renderGhost();
      btnMove.classList.toggle('active', STATE.moveMode);
    });
    root.querySelector('#btnStructRotL').addEventListener('click', ()=> rotateSelected(-1));
    root.querySelector('#btnStructRotR').addEventListener('click', ()=> rotateSelected(+1));
    root.querySelector('#btnStructDelete').addEventListener('click', deleteSelected);
    root.querySelector('#btnStructToggleState').addEventListener('click', toggleSelectedState);

    buildUILists();
  }
  API.mountUI = mountUI;

  function buildUILists(){
    if (!STATE.ui) return;
    const tEl = STATE.ui.querySelector('#structuresTypeList');
    const dEl = STATE.ui.querySelector('#structuresDefList');
    if (!tEl || !dEl) return;

    tEl.innerHTML = '';
    dEl.innerHTML = '';

    for (const t of STATE.catalog.types || []){
      const btn = el('button', { class:'chip', type:'button', textContent: t.name });
      btn.addEventListener('click', ()=> filterDefsByType(t.id));
      tEl.appendChild(btn);
    }
    renderDefsList(STATE.catalog.defs || []);

    // show/hide the Toggle button depending on presence of any def.states
    STATE._hasStates = !!(STATE.catalog.defs||[]).some(d=>Array.isArray(d.states) && d.states.length);
    const toggleBtn = STATE.ui.querySelector('#btnStructToggleState');
    if (toggleBtn) toggleBtn.style.display = STATE._hasStates ? '' : 'none';
  }

  function filterDefsByType(typeId){
    const defs = (STATE.catalog.defs||[]).filter(d => !typeId || d.type===typeId);
    renderDefsList(defs);
  }

  function renderDefsList(defs){
    const dEl = STATE.ui.querySelector('#structuresDefList');
    dEl.innerHTML='';
    for (const d of defs){
      const item = el('div', { class:'def-item', 'data-id': d.id });
      item.textContent = d.name || d.id;
      item.addEventListener('click', ()=>{
        dEl.querySelectorAll('.def-item').forEach(n=> n.classList.remove('selected'));
        item.classList.add('selected');
      });
      dEl.appendChild(item);
    }
  }

  /* ------------------------- Hotkeys ------------------------------ */
  function attachHotkeys(){
    if (STATE.hotkeysAttached) return;
    STATE.hotkeysAttached = true;
    window.addEventListener('keydown', (e)=>{
      if (!STATE.tool) return;
      if (e.repeat) return;
      if (e.key==='q' || e.key==='Q'){ rotateSelected(-1); e.preventDefault(); }
      if (e.key==='e' || e.key==='E'){ rotateSelected(+1); e.preventDefault(); }
      if (e.key==='Delete'){ deleteSelected(); e.preventDefault(); }
      if (e.key==='Enter' && STATE.ghost){ commitGhost(); e.preventDefault(); }
    });
  }

  /* ----------------------- Change broadcast ----------------------- */
  let _pulseChanged = function(){
    if (typeof STATE.publish === 'function'){
      STATE.publish('structures:changed', serialize());
    }
  };
  function pulseChanged(){
    _pulseChanged();
  }

  /* --------------------------- Init ------------------------------- */
  function injectDefaultCSS(){
    if (document.getElementById('structures-css')) return;
    const css = document.createElement('style');
    css.id = 'structures-css';
    css.textContent = `
      .structure.selected :where(.bldg-body,.wall-body,.gate-closed,.gate-wing) { filter: drop-shadow(0 0 2px var(--bt-amber, #f0b000)); }
      .ghost :where(.bldg-body,.wall-body,.gate-closed,.gate-wing){ opacity: .5; }
      /* UI */
      .structures-ui { font: 12px system-ui, sans-serif; color: var(--ink, #ddd); }
      .structures-ui .row { display:flex; align-items:center; gap:8px; }
      .structures-ui .between { justify-content: space-between; }
      .structures-ui .group { margin: 8px 0; }
      .structures-ui .chip { margin: 2px 4px 6px 0; padding:2px 8px; border:1px solid var(--line, #333); background:transparent; color:inherit; border-radius:12px; }
      .structures-ui .def-item { padding:4px 6px; border:1px solid var(--line,#333); border-radius:6px; margin:3px 0; cursor:pointer; }
      .structures-ui .def-item.selected { border-color: var(--bt-amber, #f0b000); }
      .structures-ui .btn { padding:4px 8px; border:1px solid var(--line,#333); background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
      .structures-ui .btn.sm { font-size:12px; }
      .structures-ui .btn.danger { border-color:#844; color:#f88; }
      .structures-ui details summary { cursor:pointer; }
      .structures-ui .sw { display:flex; align-items:center; gap:6px; }
      .structures-ui .btn.active { outline:1px solid var(--bt-amber, #f0b000); }
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

    injectDefaultCSS();
    STATE.inited = true;
    console.info('[Structures] ready');
  }
  API.init = init;

  /* ----------------------- Catalog Loading ------------------------ */
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('Failed to load catalog: '+res.status);
    const json = await res.json();
    ingestCatalog(json);
    console.info('[Structures] catalog loaded:', url, json);
  }
  API.loadCatalog = loadCatalog;

  /* ------------------- Catalog management ---------------------- */
  function clearCatalog(){
    STATE.catalog = {version:1, types:[], defs:[]};
    STATE.defsById.clear();
    STATE._hasStates = false;
  }
  function ingestCatalog(json){
    clearCatalog();
    if (!json || !Array.isArray(json.defs)) throw new Error('Invalid catalog.json');
    STATE.catalog = json;
    for (const def of json.defs){
      STATE.defsById.set(def.id, def);
    }
    buildUILists();
  }

  /* --------------------- Optional Local Storage ------------------- */
  API.bindLocalStorage = function(getKey){
    if (typeof getKey !== 'function') return;
    STATE._getLocalKey = getKey;
    // Attempt initial restore
    try{
      const key = getKey();
      const raw = localStorage.getItem(key);
      if (raw) hydrate(JSON.parse(raw));
    }catch(e){ /* ignore */ }
    // Wrap pulseChanged to auto-save + publish
    _pulseChanged = function(){
      if (typeof STATE.publish === 'function'){
        STATE.publish('structures:changed', serialize());
      }
      try{
        const key = getKey(); // evaluated each change so map switches update key
        localStorage.setItem(key, JSON.stringify(serialize()));
      }catch(e){ /* ignore */ }
    };
  };

  // Re-hydrate from new map key when maps change
  API.onMapChanged = function(){
    if (typeof STATE._getLocalKey !== 'function') return;
    try{
      const key = STATE._getLocalKey();
      const raw = localStorage.getItem(key);
      if (raw){
        hydrate(JSON.parse(raw));
      } else {
        hydrate([]); // no data for this map; clear visuals
      }
    }catch(e){ /* ignore */ }
  };

  /* ------------------- Expose global namespace -------------------- */
  window.MSS_Structures = API;

  /* ------------------- Wiring instructions ------------------------
  1) Place files:
     /modules/structures.js
     /modules/catalog.json
  2) Module injects <g id="world-structures"> under #world-tokens when present.
  3) Boot:
     MSS_Structures.init({...helpers...});
     MSS_Structures.loadCatalog('/modules/catalog.json');
     MSS_Structures.mountUI('#structuresPanel');
     MSS_Structures.bindLocalStorage(()=> 'mss84.structures.'+(window.currentMapId||'default'));
  4) Save/load/reset in your app:
     saveObj.structures = MSS_Structures.serialize();
     MSS_Structures.clear(); MSS_Structures.hydrate(saveObj.structures||[]);
  5) Map change:
     window.currentMapId = 'new-map-id';
     MSS_Structures.onMapChanged(); // re-hydrates from new LS key
  ----------------------------------------------------------------- */
})();
