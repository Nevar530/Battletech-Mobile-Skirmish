/*!
 * MSS Structures — placement + rotation + local save + inline color
 * Public API on window.MSS_Structures:
 *   init({ hexToPx, pxToHex, getTileHeight?, onMapTransform?, publish?, subscribe? })
 *   loadCatalog(url)
 *   mountUI(selector)
 *   enableTool(on:boolean)
 *   serialize() -> placed array
 *   hydrate(arr) -> restore placed
 *   clear()
 *   bindLocalStorage(fnKey) -> autosave/restore per-map
 *   onMapChanged() -> call after CURRENT_MAP_ID changes
 */
(function(){
  const NS = 'http://www.w3.org/2000/svg';

  const S = {
    inited:false,
    // catalog
    defs:[],              // normalized defs
    types:[],             // [{id,name}]
    byId:new Map(),
    // placed
    list:[],              // [{id,defId,anchor:{q,r},rot}]
    selected:null,        // index
    ghost:null,           // {defId,anchor:{q,r},rot}
    // tool modes
    tool:false,
    moveMode:false,
    eraseMode:false,
    // helpers
    hexToPx:(q,r)=>({x:0,y:0}),
    pxToHex:(x,y)=>({q:0,r:0}),
    getTileHeight:(q,r)=>0,
    onMapTransform:null,
    publish:null, subscribe:null,
    // dom
    svg:null, layer:null, defsNode:null, ui:null,
    // storage
    getLocalKey:null,
    // state flags
    hasStates:false,
    hotkeys:false
  };

  /* --------------------- DOM helpers --------------------- */
  function el(name, attrs){ const n=document.createElementNS(NS,name); if(attrs) for(const k in attrs) n.setAttribute(k,attrs[k]); return n; }
  function ensureSvg(){
    if (S.svg && S.svg.isConnected) return;
    S.svg = document.getElementById('svg');
  }
  function ensureLayer(){
    ensureSvg(); if (!S.svg) return;
    let layer = document.getElementById('world-structures');
    if (!layer){
      layer = el('g', { id:'world-structures' });
      // Prefer inserting just beneath tokens so buildings sit under tokens/labels
      const tokens = document.getElementById('world-tokens');
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(layer, tokens);
      else S.svg.appendChild(layer);
    }
    S.layer = layer;
    // ensure <defs>
    S.defsNode = S.svg.querySelector('defs') || S.svg.insertBefore(el('defs'), S.svg.firstChild);
  }
  function removeAll(n){ while(n.firstChild) n.removeChild(n.firstChild); }

  /* -------------------- Catalog loading ------------------ */
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('catalog load '+res.status);
    const data = await res.json();
    let defs = [], types = [];
    if (Array.isArray(data)) defs = data;
    else if (Array.isArray(data.items)) defs = data.items;
    else if (Array.isArray(data.defs)) { defs = data.defs; if (Array.isArray(data.types)) types = data.types; }
    else throw new Error('invalid catalog format');

    S.defs = defs;
    S.types = types;
    S.byId.clear(); defs.forEach(d=> S.byId.set(d.id, d));
    S.hasStates = defs.some(d => Array.isArray(d.states) && d.states.length);
    buildUILists();
    renderPreview();
    renderAll();
  }

  /* -------------------- Geometry helpers ----------------- */
  // axial rotation around (0,0) in 60° steps
  function rotAx(dq, dr, steps){
    const s = ((steps%6)+6)%6;
    let x=dq, z=dr, y=-x-z;
    for (let i=0;i<s;i++){ const nx=-z, ny=-x, nz=-y; x=nx; y=ny; z=nz; }
    return {dq:x, dr:z};
  }
  function worldToScreen(q,r){ return S.hexToPx(q,r); }

  /* -------------------- Draw shapes ---------------------- */
  function drawShape(s){
    const kind = s.kind || 'rect';
    const fill   = s.fill   ?? (s.class? undefined : '#20262c');
    const stroke = s.stroke ?? (s.class? undefined : '#9aa4ae');
    const sw     = s.sw != null ? String(s.sw) : undefined;

    function apply(n){
      if (s.class) n.setAttribute('class', s.class);
      if (fill   !== undefined) n.setAttribute('fill', fill);
      if (stroke !== undefined) n.setAttribute('stroke', stroke);
      if (sw     !== undefined) n.setAttribute('stroke-width', sw);
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    }

    if (kind==='rect'){
      const w=+s.w||1, h=+s.h||1;
      const x = (s.x!=null)? +s.x : -(w/2);
      const y = (s.y!=null)? +s.y : -(h/2);
      const n = apply(el('rect',{x,y,width:w,height:h}));
      if (s.rx!=null) n.setAttribute('rx', +s.rx);
      return n;
    }
    if (kind==='polygon'){
      const pts=(s.points||[]).map(p=>p.join(',')).join(' ');
      return apply(el('polygon',{points:pts}));
    }
    if (kind==='polyline'){
      const pts=(s.points||[]).map(p=>p.join(',')).join(' ');
      return apply(el('polyline',{points:pts}));
    }
    // path default
    return apply(el('path',{d:s.d||''}));
  }

  function pickShapes(def, stateKey){
    if (def.states && Array.isArray(def.states)){
      const chosen = def.states.find(s=> s.key === (stateKey || def.defaultState));
      if (chosen && Array.isArray(chosen.shapes)) return chosen.shapes;
    }
    return def.shapes||[];
  }

  /* -------------------- Rendering placed ----------------- */
  function ensureGroupFor(i){
    ensureLayer(); if (!S.layer) return null;
    const id='struct-'+i;
    let g = S.layer.querySelector('#'+CSS.escape(id));
    if (!g){ g = el('g',{id, class:'structure'}); S.layer.appendChild(g); }
    return g;
  }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0})`);
    g.style.pointerEvents = S.tool ? 'auto' : 'none';
  }
  function renderOne(i){
    const item = S.list[i]; const def = S.byId.get(item.defId); if (!def) return;
    const g = ensureGroupFor(i); if (!g) return;
    g.setAttribute('data-index', i); g.setAttribute('data-def', def.id);
    g.setAttribute('class', 'structure'+(S.selected===i?' selected':''));
    removeAll(g);
    const shapes = pickShapes(def, item.state);
    shapes.forEach(s=> g.appendChild(drawShape(s)));
    // hit rect
    const hit = el('rect',{x:-0.52,y:-0.52,width:1.04,height:1.04,fill:'transparent',stroke:'transparent'});
    g.appendChild(hit);
    applyTransform(g, item.anchor, item.rot||0);
  }
  function renderGhost(){
    if (!S.layer) ensureLayer();
    const old = S.layer && S.layer.querySelector('#ghost-structure');
    if (old) old.remove();
    if (!S.tool || !S.ghost || !S.layer) return;
    const def = S.byId.get(S.ghost.defId); if (!def) return;
    const g = el('g',{id:'ghost-structure', class:'structure ghost'});
    pickShapes(def, def.defaultState).forEach(s=> g.appendChild(drawShape(s)));
    applyTransform(g, S.ghost.anchor, S.ghost.rot||0);
    g.style.opacity = .55;
    g.style.pointerEvents='none';
    S.layer.appendChild(g);
  }
  function renderAll(){
    ensureLayer(); if (!S.layer) return;
    // prune excess dom
    const max = S.list.length;
    S.layer.querySelectorAll('.structure').forEach(n=>{
      const idx = Number(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx >= max) n.remove();
    });
    for (let i=0;i<S.list.length;i++) renderOne(i);
    renderGhost();
  }

  /* ----------------------- Persistence ------------------- */
  function serialize(){
    return S.list.map(it => ({
      defId: it.defId,
      anchor: { q: it.anchor.q, r: it.anchor.r },
      rot: it.rot||0,
      state: it.state
    }));
  }
  function hydrate(arr){
    S.list = Array.isArray(arr)? arr.map(x=>({
      defId:x.defId,
      anchor:{ q:+(x.anchor?.q||0), r:+(x.anchor?.r||0) },
      rot: (+x.rot||0)%360,
      state: x.state
    })) : [];
    S.selected = null;
    renderAll();
    pulse(); // save & publish
  }
  function clear(){
    S.list = [];
    S.selected = null;
    renderAll();
    clearLocalIfBound();
    pulse(); // publish "empty" to peers if needed
  }

  function bindLocalStorage(fnKey){
    S.getLocalKey = (typeof fnKey==='function') ? fnKey : null;
    // initial restore if present
    try{
      const key = S.getLocalKey?.();
      if (key){
        const raw = localStorage.getItem(key);
        if (raw) hydrate(JSON.parse(raw));
      }
    }catch{}
  }
  function saveLocalIfBound(){
    try{
      const key = S.getLocalKey?.();
      if (key) localStorage.setItem(key, JSON.stringify(serialize()));
    }catch{}
  }
  function clearLocalIfBound(){
    try{
      const key = S.getLocalKey?.();
      if (key) localStorage.removeItem(key);
    }catch{}
  }
  function onMapChanged(){
    try{
      const key = S.getLocalKey?.();
      if (key){
        const raw = localStorage.getItem(key);
        hydrate(raw? JSON.parse(raw): []);
      }
    }catch{ hydrate([]); }
  }

  /* ----------------------- Interaction ------------------- */
  function enableTool(on){
    S.tool = !!on;
    if (!on){ S.ghost=null; S.selected=null; }
    renderAll();
  }
  function setGhost(defId){ S.ghost = { defId, rot:0, anchor:{q:0,r:0} }; renderGhost(); }
  function placeGhostAt(q,r){ if (S.ghost){ S.ghost.anchor={q,r}; renderGhost(); } }
  function commitGhost(){
    if (!S.ghost) return;
    S.list.push({ defId:S.ghost.defId, anchor:{...S.ghost.anchor}, rot:S.ghost.rot||0, state:undefined });
    S.selected = S.list.length-1;
    S.ghost = null; renderAll(); pulse();
  }
  function rotateSelected(steps){
    if (S.ghost && S.tool && S.selected==null){
      S.ghost.rot = ((S.ghost.rot||0) + steps*60 + 360) % 360;
      renderGhost(); return;
    }
    if (S.selected==null) return;
    const it = S.list[S.selected]; if (!it) return;
    it.rot = ((it.rot||0) + steps*60 + 360) % 360;
    renderOne(S.selected); pulse();
  }
  function deleteSelected(){
    if (S.selected==null) return;
    S.list.splice(S.selected,1);
    S.selected=null; renderAll(); pulse();
  }

  function toSvgPoint(evt){
    ensureSvg(); if (!S.svg) return null;
    const pt = S.svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const m = S.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }

  function onPointerDown(e){
    if (!S.tool) return;
    const t = e.target;
    const g = t.closest && t.closest('#world-structures > g.structure');
    // erase mode
    if (S.eraseMode && g){
      const idx = Number(g.getAttribute('data-index'));
      if (Number.isFinite(idx)){ S.list.splice(idx,1); S.selected=null; renderAll(); pulse(); }
      e.stopPropagation(); return;
    }
    // select & maybe start move
    if (g){
      S.selected = Number(g.getAttribute('data-index'));
      renderAll();
      e.stopPropagation(); return;
    }
    // place ghost
    if (S.ghost){
      commitGhost();
      e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    if (!S.tool) return;
    if (S.ghost){
      const p = toSvgPoint(e); if (!p) return;
      const hex = S.pxToHex(p.x,p.y);
      placeGhostAt(hex.q|0, hex.r|0);
    }
  }
  function onPointerUp(){ /* no-op; simple click-to-place */ }

  function attachPointer(){
    ensureSvg(); if (!S.svg) return;
    S.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  function attachHotkeys(){
    if (S.hotkeys) return;
    S.hotkeys = true;
    window.addEventListener('keydown', (e)=>{
      if (!S.tool) return;
      if (e.repeat) return;
      if (e.key==='q' || e.key==='Q'){ rotateSelected(-1); e.preventDefault(); }
      if (e.key==='e' || e.key==='E'){ rotateSelected(+1); e.preventDefault(); }
      if (e.key==='Delete'){ deleteSelected(); e.preventDefault(); }
      if (e.key==='Enter' && S.ghost){ commitGhost(); e.preventDefault(); }
    });
  }

  /* ------------------------- UI -------------------------- */
  function mountUI(sel){
    const host = typeof sel==='string'? document.querySelector(sel) : sel;
    if (!host) return;
    host.innerHTML = `
      <div class="structures-ui">
        <div class="row between">
          <strong>Structures</strong>
          <label class="sw"><input type="checkbox" id="structsEnable"> Enable</label>
        </div>

        <div class="group">
          <details open>
            <summary>Catalog</summary>
            <div class="types" id="structuresTypeList"></div>
            <div class="defs" id="structuresDefList"></div>
            <button class="btn sm" id="btnStructAdd">Place Mode</button>
          </details>
        </div>

        <div class="group row gap">
          <button class="btn sm" id="btnStructMove">Select/Move</button>
          <button class="btn sm" id="btnStructRotL">◀ Rotate</button>
          <button class="btn sm" id="btnStructRotR">Rotate ▶</button>
          <button class="btn sm ghost" id="btnStructErase">Erase</button>
          <button class="btn sm danger" id="btnStructDelete">Delete</button>
        </div>
      </div>
    `;
    S.ui = host;

    // enable toggle
    host.querySelector('#structsEnable').addEventListener('change', e=> enableTool(e.target.checked));
    // catalog handlers
    host.querySelector('#btnStructAdd').addEventListener('click', ()=>{
      const sel = host.querySelector('.def-item.selected'); if (!sel){ alert('Pick a definition first'); return; }
      setGhost(sel.getAttribute('data-id'));
    });
    const btnMove = host.querySelector('#btnStructMove');
    btnMove.addEventListener('click', ()=>{
      S.moveMode = !S.moveMode;
      S.eraseMode = false;
      S.ghost = null; renderGhost();
      btnMove.classList.toggle('active', S.moveMode);
      host.querySelector('#btnStructErase').classList.remove('active');
    });
    const btnErase = host.querySelector('#btnStructErase');
    btnErase.addEventListener('click', ()=>{
      S.eraseMode = !S.eraseMode;
      S.moveMode = false;
      S.ghost = null; renderGhost();
      btnErase.classList.toggle('active', S.eraseMode);
      btnMove.classList.remove('active');
    });

    host.querySelector('#btnStructRotL').addEventListener('click', ()=> rotateSelected(-1));
    host.querySelector('#btnStructRotR').addEventListener('click', ()=> rotateSelected(+1));
    host.querySelector('#btnStructDelete').addEventListener('click', deleteSelected);

    buildUILists();
    injectCSS();
  }

  function buildUILists(){
    if (!S.ui) return;
    const tEl = S.ui.querySelector('#structuresTypeList');
    const dEl = S.ui.querySelector('#structuresDefList');
    if (tEl) tEl.innerHTML = '';
    if (dEl) dEl.innerHTML = '';

    // types (optional)
    if (tEl && (S.types||[]).length){
      const all = document.createElement('button');
      all.className='chip'; all.textContent='All';
      all.onclick = ()=> renderDefsList(S.defs);
      tEl.appendChild(all);
      (S.types||[]).forEach(t=>{
        const b=document.createElement('button'); b.className='chip'; b.textContent=t.name||t.id;
        b.onclick=()=> renderDefsList(S.defs.filter(d=>d.type===t.id));
        tEl.appendChild(b);
      });
    }
    renderDefsList(S.defs);
  }
  function renderDefsList(defs){
    if (!S.ui) return;
    const dEl = S.ui.querySelector('#structuresDefList'); if (!dEl) return;
    dEl.innerHTML='';
    defs.forEach(d=>{
      const n=document.createElement('div'); n.className='def-item'; n.setAttribute('data-id', d.id);
      n.textContent = d.name||d.id;
      n.onclick = ()=>{ dEl.querySelectorAll('.def-item').forEach(m=>m.classList.remove('selected')); n.classList.add('selected'); };
      dEl.appendChild(n);
    });
  }

  function renderPreview(){
    // (optional) hook a small preview elsewhere if desired; keeping light here
  }

  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css=document.createElement('style'); css.id='structures-css';
    css.textContent=`
      .structures-ui{ font:12px system-ui,sans-serif; color:var(--ink,#ddd); }
      .structures-ui .row{ display:flex; gap:8px; align-items:center; }
      .structures-ui .between{ justify-content:space-between; }
      .structures-ui .group{ margin:8px 0; }
      .structures-ui .chip{ margin:2px 4px 6px 0; padding:2px 8px; border:1px solid var(--line,#333); background:transparent; color:inherit; border-radius:12px; cursor:pointer; }
      .structures-ui .def-item{ padding:4px 6px; border:1px solid var(--line,#333); border-radius:6px; margin:3px 0; cursor:pointer; }
      .structures-ui .def-item.selected{ border-color: var(--bt-amber,#f0b000); }
      .structures-ui .btn{ padding:4px 8px; border:1px solid var(--line,#333); background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
      .structures-ui .btn.sm{ font-size:12px; }
      .structures-ui .btn.danger{ border-color:#844; color:#f88; }
      .structures-ui .btn.active{ outline:1px solid var(--bt-amber,#f0b000); }
      .structure.selected :where(.bldg-body,.wall-body){ filter: drop-shadow(0 0 2px var(--bt-amber,#f0b000)); }
      .ghost :where(*){ opacity:.55 }
    `;
    document.head.appendChild(css);
  }

  /* ---------------------- Change pulse ------------------- */
  function pulse(){
    saveLocalIfBound();
    if (typeof S.publish === 'function'){
      try{ S.publish('structures:changed', serialize()); }catch{}
    }
  }

  /* ------------------------ INIT ------------------------- */
  function init(opts){
    if (S.inited) return;
    S.hexToPx = opts.hexToPx || S.hexToPx;
    S.pxToHex = opts.pxToHex || S.pxToHex;
    S.getTileHeight = opts.getTileHeight || S.getTileHeight;
    S.onMapTransform = opts.onMapTransform || null;
    S.publish = opts.publish || null;
    S.subscribe = opts.subscribe || null;

    ensureLayer();
    attachPointer();
    attachHotkeys();

    if (typeof S.onMapTransform === 'function'){
      S.onMapTransform(()=> renderAll());
    }

    S.inited = true;
    console.info('[Structures] ready');
  }

  /* -------------------- Expose API ----------------------- */
  const API = {
    init,
    loadCatalog,
    mountUI,
    enableTool,
    serialize,
    hydrate,
    clear,
    bindLocalStorage,
    onMapChanged
  };
  window.MSS_Structures = API;
})();
