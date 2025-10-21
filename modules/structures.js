/*!
 * MSS:84 — Structures Module (Buildings / Walls / Gates)
 * Single-file drop-in: /modules/structures.js
 * 
 * Goals:
 * - Top-down, multi-hex vector structures (no images).
 * - Snap to hex grid; rotate in 60° steps.
 * - Mechs stay above structures (z-index); tokens can "stand on roofs".
 * - Simple LOS surface heights: fixed | per-cell | tile inherit.
 * - Only interactive when the tool is enabled; otherwise inert.
 * - Minimal UI that can mount inside your left terrain menu.
 *
 * Public API (window.MSS_Structures):
 *   init(opts)                -> initialize with engine helpers and options
 *   mountUI(containerSel)     -> build UI controls in given container element
 *   loadCatalog(url)          -> load /modules/catalog.json (or another URL)
 *   enableTool(on:boolean)    -> toggle interactivity
 *   serialize()               -> array for save
 *   hydrate(structuresArray)  -> restore from save
 *   getSurfaceHeight(q,r)     -> surface/roof height at hex (for movement/LOS)
 *
 * Wiring tips are at the bottom of this file.
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
    // helpers injected by init()
    hexToPx:null,
    pxToHex:null,
    getTileHeight:(q,r)=>0,
    registerLosProvider:null,
    onMapTransform:null,
    publish:null,
    subscribe:null,
    // DOM
    root:null,           // svg layer
    defsNode:null,       // <defs> for patterns etc
    ui:null,             // mounted UI root
    zBelowTokens: 20,
    zTokens:      30,
    // keys
    hotkeysAttached:false,
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
    // Create or reuse SVG layer
    let layer = document.getElementById('layer-structures');
    if (!layer){
      layer = elNS('svg', { id:'layer-structures', class:'layer-structures' });
      // Attempt to place just under tokens layer if present
      const tokens = document.getElementById('layer-tokens') || document.getElementById('tokens');
      if (tokens && tokens.parentNode){
        tokens.parentNode.insertBefore(layer, tokens); // below tokens
      } else {
        document.body.appendChild(layer);
      }
    }
    // basic style defaults
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.zIndex = String(STATE.zBelowTokens);
    layer.style.pointerEvents = 'none'; // inert by default
    STATE.root = layer;

    // defs node for patterns if needed later
    const existingDefs = layer.querySelector('defs');
    STATE.defsNode = existingDefs || layer.insertBefore(elNS('defs'), layer.firstChild);
  }

  /* ------------------------- Utility: Math ------------------------ */
  // axial rotation of (dq,dr) around (0,0) in 60° steps.
  function rotateAxial(dq, dr, steps){
    const s = ((steps % 6)+6)%6;
    let q = dq, r = dr, x, z, y;
    // Convert axial (q,r) to cube (x,y,z): x=q, z=r, y=-x-z
    x = q; z = r; y = -x - z;
    for (let i=0;i<s;i++){
      // 60° rotation: (x,y,z) -> (-z,-x,-y)
      const nx = -z, ny = -x, nz = -y;
      x = nx; y = ny; z = nz;
    }
    // back to axial: q=x, r=z
    return {dq:x, dr:z};
  }
  function key(q,r){ return q+'|'+r; }

  /* ---------------------- Catalog management ---------------------- */
  function clearCatalog(){
    STATE.catalog = {version:1, types:[], defs:[]};
    STATE.defsById.clear();
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
      STATE.root.appendChild(g);
    }
    return g;
  }

  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    const deg = (rot||0);
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${deg})`);
  }

  function drawShape(container, shape){
    switch(shape.kind){
      case 'path': {
        const n = elNS('path', { d: shape.d, class: shape.class||'' });
        container.appendChild(n); break;
      }
      case 'rect': {
        const n = elNS('rect', { x:shape.x, y:shape.y, width:shape.w, height:shape.h, rx:shape.rx||0, class: shape.class||'' });
        container.appendChild(n); break;
      }
      case 'polyline': {
        const pts = (shape.points||[]).map(p=>p.join(',')).join(' ');
        const n = elNS('polyline', { points: pts, class: shape.class||'' });
        container.appendChild(n); break;
      }
      case 'polygon': {
        const pts2 = (shape.points||[]).map(p=>p.join(',')).join(' ');
        const n = elNS('polygon', { points: pts2, class: shape.class||'' });
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

  function removeChildren(n){ while(n.firstChild) n.removeChild(n.firstChild); }

  function renderAll(){
    // rebuild all groups
    if (!STATE.root) ensureLayer();
    for (let i=0;i<STATE.list.length;i++){
      renderOne(i);
    }
    renderGhost();
  }

  function renderOne(i){
    const item = STATE.list[i];
    const def = STATE.defsById.get(item.defId);
    if (!def) return;
    const g = ensureGroupFor(i);
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', def.id);
    // selection classes
    g.setAttribute('class', 'structure'+(STATE.selectedId===i?' selected':''));
    // clear and draw
    removeChildren(g);
    // optional state visuals (e.g., gates)
    const shapes = pickShapes(def, item.state);
    for (const s of shapes) drawShape(g, s);
    // transform
    applyTransform(g, item.anchor, item.rot||0);
    // hit target (outline) only when tool enabled
    let hit = g.querySelector('.hit');
    if (!hit){
      hit = elNS('rect', { class:'hit', x:-0.52, y:-0.52, width:1.04, height:1.04, fill:'transparent', stroke:'transparent' });
      g.appendChild(hit);
    }
    // pointer-events only in tool mode
    g.style.pointerEvents = STATE.tool ? 'auto' : 'none';
  }

  function pickShapes(def, stateKey){
    // Handles def.shapes (default) or def.states[].shapes
    if (def.states && Array.isArray(def.states)){
      const chosen = def.states.find(s=>s.key=== (stateKey || def.defaultState));
      if (chosen && Array.isArray(chosen.shapes)){
        return chosen.shapes;
      }
    }
    return def.shapes || [];
  }

  function renderGhost(){
    // Remove old ghost
    const old = STATE.root.querySelector('#ghost-structure');
    if (old) old.remove();
    if (!STATE.tool || !STATE.ghost) return;
    const def = STATE.defsById.get(STATE.ghost.defId);
    if (!def) return;
    const g = elNS('g', { id:'ghost-structure', class:'structure ghost' });
    const shapes = pickShapes(def, def.defaultState);
    for (const s of shapes) drawShape(g, s);
    applyTransform(g, STATE.ghost.anchor, STATE.ghost.rot||0);
    g.style.pointerEvents = 'none';
    STATE.root.appendChild(g);
  }

  /* ------------------------ Interaction -------------------------- */
  function enableTool(on){
    STATE.tool = !!on;
    // pointer-events on structures when tool is active
    const all = STATE.root.querySelectorAll('.structure');
    all.forEach(g=> g.style.pointerEvents = STATE.tool ? 'auto' : 'none');
    STATE.root.classList.toggle('tool-on', STATE.tool);
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
      // rotate ghost if placing
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
    renderAll();
    pulseChanged();
  }

  function toggleSelectedState(){
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

  function onPointerDown(evt){
    if (!STATE.tool) return;
    const target = evt.target;
    const g = target.closest && target.closest('.structure');
    if (g){
      STATE.selectedId = Number(g.getAttribute('data-index'));
      renderAll();
      evt.stopPropagation();
      return;
    }
    // if in "add" mode (ghost active), clicking board commits
    if (STATE.ghost){
      commitGhost();
      evt.stopPropagation();
    }
  }

  function onPointerMove(evt){
    if (!STATE.tool || !STATE.ghost) return;
    const rect = STATE.root.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const h = STATE.pxToHex(x,y);
    placeGhostAt(h.q, h.r);
  }

  function attachPointerHandlers(){
    // attach to top svg pane so we get consistent coords
    STATE.root.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
  }

  /* ------------------------ Heights / LOS ------------------------- */
  function getSurfaceHeight(q,r){
    // Return the structure surface height at (q,r) if any; else underlying tile height.
    // If multiple structures stack (rare), take max.
    let maxH = STATE.getTileHeight(q,r) || 0;
    for (let i=0;i<STATE.list.length;i++){
      const item = STATE.list[i];
      const def  = STATE.defsById.get(item.defId);
      if (!def) continue;
      const cells = footprintCells(def, item.anchor, item.rot||0);
      for (const c of cells){
        if (c.q===q && c.r===r){
          const h = heightAt(def, c.idx, item.state);
          if (h!=null) maxH = Math.max(maxH, h);
        }
      }
    }
    return maxH;
  }
  API.getSurfaceHeight = getSurfaceHeight;

  function heightAt(def, cellIdx, stateKey){
    // fixed | cells | tile (with optional minHeight)
    if (def.states && Array.isArray(def.states)){
      const chosen = def.states.find(s=>s.key=== (stateKey || def.defaultState));
      if (chosen){
        if (chosen.heightMode==='fixed') return chosen.height||0;
        if (chosen.heightMode==='tile')  return Math.max(STATE.getTileHeight, chosen.minHeight||0);
      }
    }
    const mode = def.heightMode || 'fixed';
    if (mode==='fixed') return def.height||0;
    if (mode==='cells'){
      const arr = def.cellHeights||[];
      return arr[cellIdx] ?? 0;
    }
    if (mode==='tile'){
      const h = STATE.getTileHeight;
      const minH = def.minHeight||0;
      return Math.max(typeof h==='function'? h(0,0):0, minH); // fallback-safe
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
      anchor: { q:x.anchor.q|0, r:x.anchor.r|0 },
      rot: x.rot|0,
      state: x.state,
      skin: x.skin
    })) : [];
    STATE.selectedId = null;
    renderAll();
  }
  API.hydrate = hydrate;

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
        <button class="btn sm" id="btnStructToggleState">Toggle</button>
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
    root.querySelector('#btnStructMove').addEventListener('click', ()=>{ STATE.ghost=null; renderGhost(); });
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

    // Types list (collapsible)
    for (const t of STATE.catalog.types || []){
      const btn = el('button', { class:'chip', type:'button', textContent: t.name });
      btn.addEventListener('click', ()=> filterDefsByType(t.id));
      tEl.appendChild(btn);
    }
    // Default: show all defs
    renderDefsList(STATE.catalog.defs || []);
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
      // Piggyback the same rotate keys as mechs, commonly Q/E (left/right)
      if (e.key==='q' || e.key==='Q'){ rotateSelected(-1); e.preventDefault(); }
      if (e.key==='e' || e.key==='E'){ rotateSelected(+1); e.preventDefault(); }
      // Delete
      if (e.key==='Delete'){ deleteSelected(); e.preventDefault(); }
      // Enter to place ghost
      if (e.key==='Enter' && STATE.ghost){ commitGhost(); e.preventDefault(); }
    });
  }

  /* ----------------------- Change broadcast ----------------------- */
  function pulseChanged(){
    // publish if provided, else noop
    if (typeof STATE.publish === 'function'){
      STATE.publish('structures:changed', serialize());
    }
  }

  /* --------------------------- Init ------------------------------- */
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

    // If your LOS system supports providers, let us register a surface hook
    if (typeof STATE.registerLosProvider === 'function'){
      STATE.registerLosProvider((q,r)=> getSurfaceHeight(q,r));
    }

    // Re-render when map pans/zooms
    if (typeof STATE.onMapTransform === 'function'){
      STATE.onMapTransform(()=> renderAll());
    }

    injectDefaultCSS();
    STATE.inited = true;
    console.info('[Structures] ready');
  }
  API.init = init;

  function injectDefaultCSS(){
    if (document.getElementById('structures-css')) return;
    const css = document.createElement('style');
    css.id = 'structures-css';
    css.textContent = `
      svg#layer-structures { position:absolute; inset:0; pointer-events:none; }
      svg#layer-structures .structure { vector-effect: non-scaling-stroke; }
      svg#layer-structures .structure .hit { stroke-width:0; }
      svg#layer-structures .structure.selected { outline: none; }
      /* Themeable classes (match your app palette) */
      .bldg-body { fill: var(--panel, #1b1b1b); stroke: var(--ink, #888); stroke-width: 0.02; }
      .bldg-seam { stroke: var(--ink-weak, #666); stroke-width: 0.02; fill: none; }
      .wall-body { fill: var(--ink, #888); opacity: .9; }
      .gate-closed { fill: var(--ink, #888); }
      .gate-wing { stroke: var(--ink, #888); stroke-width: 0.03; }
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
    `;
    document.head.appendChild(css);
  }

  /* ----------------------- Catalog Loading ------------------------ */
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    const json = await res.json();
    ingestCatalog(json);
    console.info('[Structures] catalog loaded:', url, json);
  }
  API.loadCatalog = loadCatalog;

  /* ------------------- Expose global namespace -------------------- */
  window.MSS_Structures = API;

  /* ------------------- Wiring instructions ------------------------

  1) Place these files:
     /modules/structures.js
     /modules/catalog.json

  2) Add an SVG layer (below tokens) in your map container. If you already have
     a #layer-tokens element, the module will insert #layer-structures just below it
     automatically on init(). Otherwise, it appends to body.

  3) Boot-time wiring (e.g., in app init after your map is ready):

     MSS_Structures.init({
       hexToPx: (q,r)=> MAP.hexToPx(q,r),        // your existing helper
       pxToHex: (x,y)=> MAP.pxToHex(x,y),        // your existing helper
       getTileHeight: (q,r)=> TERRAIN.heightAt(q,r), // optional
       registerLosProvider: (fn)=> LOS.addSurfaceProvider(fn), // optional
       onMapTransform: (fn)=> MAP.onTransform(fn),            // optional
       publish: (evt,payload)=> BUS.publish(evt,payload),     // optional
       subscribe: (evt,cb)=> BUS.subscribe(evt,cb)            // optional
     });
     MSS_Structures.loadCatalog('/modules/catalog.json');

  4) Left menu placement:
     Add a container DIV between "Quick Paint" and "Fill Terrain":
       <div id="structuresPanel"></div>
     Then mount the UI:
       MSS_Structures.mountUI('#structuresPanel');

  5) Save / Load:
     // when saving
     state.structures = MSS_Structures.serialize();
     // when loading
     MSS_Structures.hydrate(state.structures || []);

  6) Z-order & input:
     Mechs/tokens stay on top because the structures layer z-index is set lower
     and pointer-events are disabled unless the tool is enabled.

  7) Hotkeys:
     With the tool enabled: Q/E rotate, Delete removes, Enter commits ghost.

  ----------------------------------------------------------------- */
})();