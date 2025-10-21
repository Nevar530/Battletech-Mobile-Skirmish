/*!
 * MSS Structures — Simple Placement Tool
 * UI: Structures | [Type Tabs] | [Dropdown] | [Place] [Select/Move] [◀ Rotate] [Rotate ▶] [Delete]
 *
 * Public API:
 *   MSS_Structures.init({ hexToPx, pxToHex, getTileHeight?, onMapTransform?, publish?, subscribe? })
 *   MSS_Structures.loadCatalog(url)
 *   MSS_Structures.mountUI(selector)
 *   MSS_Structures.serialize() -> placed array
 *   MSS_Structures.hydrate(arr)
 *   MSS_Structures.clear()
 *   MSS_Structures.bindLocalStorage(fnKey)   // fn returns key per-map
 *   MSS_Structures.onMapChanged()            // rehydrate for new map key
 */
(function(){
  const NS = 'http://www.w3.org/2000/svg';

  const ST = {
    // engine hooks
    hexToPx:(q,r)=>({x:0,y:0}),
    pxToHex:(x,y)=>({q:0,r:0}),
    getTileHeight:(q,r)=>0,
    onMapTransform:null,
    publish:null, subscribe:null,

    // catalog
    defs:[],
    types:[],
    byId:new Map(),

    // runtime
    list:[],                 // [{defId, anchor:{q,r}, rot}]
    selected:null,           // index into list
    mode:null,               // 'place' | 'move' | null
    ghost:null,              // {defId, anchor:{q,r}, rot}
    dragging:false,
    dragIdx:null,

    // dom
    svg:null,
    layer:null,
    ui:null,

    // storage
    getLocalKey:null,

    // flags
    hotkeys:false,
    inited:false
  };

  /* ------------------ DOM helpers ------------------ */
  function el(name, attrs){ const n=document.createElementNS(NS,name); if(attrs) for(const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function $(sel,root=document){ return root.querySelector(sel); }

  function ensureSvg(){
    if (ST.svg && ST.svg.isConnected) return;
    ST.svg = document.getElementById('svg');
  }
  function ensureLayer(){
    ensureSvg(); if (!ST.svg) return;
    let layer = document.getElementById('world-structures');
    if (!layer){
      layer = el('g',{id:'world-structures'});
      const tokens = document.getElementById('world-tokens');
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(layer, tokens);
      else ST.svg.appendChild(layer);
    }
    ST.layer = layer;
  }
  function clearChildren(n){ while(n.firstChild) n.removeChild(n.firstChild); }

  /* ------------------ Catalog ------------------ */
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('catalog '+res.status);
    const data = await res.json();
    let defs=[], types=[];
    if (Array.isArray(data)) defs=data;
    else if (Array.isArray(data.items)) defs=data.items;
    else if (Array.isArray(data.defs)) { defs=data.defs; if (Array.isArray(data.types)) types=data.types; }
    else throw new Error('invalid catalog format');

    ST.defs = defs;
    ST.types = types;
    ST.byId.clear();
    defs.forEach(d=> ST.byId.set(d.id, d));

    buildTypeTabs();
    rebuildDropdown();
    renderAll();
  }

  /* ------------------ Geometry ------------------ */
  // axial rotation (dq,dr) around origin in 60° increments
  function rotAx(dq, dr, steps){
    const s = ((steps%6)+6)%6;
    let x=dq, z=dr, y=-x-z;
    for (let i=0;i<s;i++){ const nx=-z, ny=-x, nz=-y; x=nx; y=ny; z=nz; }
    return {dq:x, dr:z};
  }
  function worldToScreen(q,r){ return ST.hexToPx(q,r); }

  /* ------------------ Drawing ------------------ */
  function drawShape(s){
    const kind = s.kind || 'rect';
    const fill   = (s.fill   != null)? s.fill   : undefined;
    const stroke = (s.stroke != null)? s.stroke : undefined;
    const sw     = (s.sw     != null)? String(s.sw) : undefined;

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
      const x=(s.x!=null)? +s.x : -(w/2);
      const y=(s.y!=null)? +s.y : -(h/2);
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
    return apply(el('path',{d:s.d||''}));
  }

  function pickShapes(def){ return def.shapes || []; }

  function ensureGroupFor(i){
    ensureLayer(); if (!ST.layer) return null;
    const id='struct-'+i;
    let g = ST.layer.querySelector('#'+CSS.escape(id));
    if (!g){ g=el('g',{id, class:'structure'}); ST.layer.appendChild(g); }
    return g;
  }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0})`);
    g.style.pointerEvents = (ST.mode==='move') ? 'auto' : 'auto'; // keep clickable
  }
  function renderOne(i){
    const it = ST.list[i]; const def=ST.byId.get(it.defId); if (!def) return;
    const g = ensureGroupFor(i); if (!g) return;
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', def.id);
    g.setAttribute('class', 'structure'+(ST.selected===i?' selected':''));
    clearChildren(g);
    pickShapes(def).forEach(s=> g.appendChild(drawShape(s)));
    // enlarge hit area (in local hex units)
    const hit = el('rect',{x:-0.6,y:-0.6,width:1.2,height:1.2,fill:'transparent',stroke:'transparent'});
    g.appendChild(hit);
    applyTransform(g, it.anchor, it.rot||0);
  }
  function renderGhost(){
    if (!ST.layer) ensureLayer();
    const old = ST.layer && ST.layer.querySelector('#ghost-structure');
    if (old) old.remove();
    if (ST.mode!=='place' || !ST.ghost || !ST.layer) return;
    const def = ST.byId.get(ST.ghost.defId); if (!def) return;
    const g = el('g',{id:'ghost-structure', class:'structure ghost'});
    pickShapes(def).forEach(s=> g.appendChild(drawShape(s)));
    applyTransform(g, ST.ghost.anchor, ST.ghost.rot||0);
    g.style.opacity = .55; g.style.pointerEvents='none';
    ST.layer.appendChild(g);
  }
  function renderAll(){
    ensureLayer(); if (!ST.layer) return;
    // prune
    const max = ST.list.length;
    ST.layer.querySelectorAll('.structure').forEach(n=>{
      if (n.id==='ghost-structure') return;
      const idx = Number(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx>=max) n.remove();
    });
    for (let i=0;i<ST.list.length;i++) renderOne(i);
    renderGhost();
  }

  /* ------------------ Persistence ------------------ */
  function serialize(){
    return ST.list.map(it => ({ defId:it.defId, anchor:{q:it.anchor.q,r:it.anchor.r}, rot:it.rot||0 }));
  }
  function hydrate(arr){
    ST.list = Array.isArray(arr)? arr.map(x=>({
      defId: x.defId,
      anchor: { q:+(x.anchor?.q||0), r:+(x.anchor?.r||0) },
      rot: (+x.rot||0)%360
    })) : [];
    ST.selected = null;
    renderAll();
    pulse();
  }
  function clear(){
    ST.list = [];
    ST.selected = null;
    renderAll();
    // wipe local slot
    try{ const key = ST.getLocalKey?.(); if (key) localStorage.setItem(key, JSON.stringify([])); }catch{}
    pulse();
  }
  function bindLocalStorage(fnKey){
    ST.getLocalKey = (typeof fnKey==='function')? fnKey : null;
    // initial restore
    try{
      const key = ST.getLocalKey?.();
      if (key){
        const raw = localStorage.getItem(key);
        if (raw) hydrate(JSON.parse(raw));
      }
    }catch{}
  }
  function onMapChanged(){
    try{
      const key = ST.getLocalKey?.();
      const raw = key ? localStorage.getItem(key) : null;
      hydrate(raw? JSON.parse(raw) : []);
    }catch{ hydrate([]); }
  }

  function pulse(){
    // local autosave
    try{
      const key = ST.getLocalKey?.();
      if (key) localStorage.setItem(key, JSON.stringify(serialize()));
    }catch{}
    // publish online event (optional)
    if (typeof ST.publish === 'function'){
      try{ ST.publish('structures:changed', serialize()); }catch{}
    }
  }

  /* ------------------ Interaction ------------------ */
  function setMode(m){ ST.mode = m; if (m!=='place') ST.ghost=null; renderAll(); }
  function setGhost(defId){ ST.ghost = { defId, anchor:{q:0,r:0}, rot:0 }; renderGhost(); }
  function rotateSelected(steps){
    if (ST.mode==='place' && ST.ghost){
      ST.ghost.rot = ((ST.ghost.rot||0) + steps*60 + 360) % 360;
      renderGhost(); return;
    }
    if (ST.selected==null) return;
    const it = ST.list[ST.selected]; if (!it) return;
    it.rot = ((it.rot||0) + steps*60 + 360) % 360;
    renderOne(ST.selected); pulse();
  }
  function deleteSelected(){
    if (ST.selected==null) return;
    ST.list.splice(ST.selected,1);
    ST.selected=null; renderAll(); pulse();
  }
  function commitGhost(){
    if (!ST.ghost) return;
    ST.list.push({ defId: ST.ghost.defId, anchor: {...ST.ghost.anchor}, rot: ST.ghost.rot||0 });
    ST.selected = ST.list.length-1;
    renderAll(); pulse();
  }

  // pointer helpers
  function toSvgPoint(cx,cy){
    ensureSvg(); if (!ST.svg) return null;
    const pt = ST.svg.createSVGPoint(); pt.x=cx; pt.y=cy;
    const m = ST.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }

  function onPointerDown(e){
    // clicking on a structure?
    const g = e.target.closest && e.target.closest('#world-structures > g.structure:not(#ghost-structure)');
    if (g){
      const idx = Number(g.getAttribute('data-index'));
      if (Number.isFinite(idx)){
        ST.selected = idx; renderAll();
        if (ST.mode==='move'){ ST.dragging=true; ST.dragIdx=idx; }
      }
      e.stopPropagation(); return;
    }
    // placing
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX, e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q:h.q|0, r:h.r|0 };
      commitGhost(); // place then stay in place mode with the same def
      e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q:h.q|0, r:h.r|0 };
      renderGhost();
      return;
    }
    if (ST.mode==='move' && ST.dragging && ST.dragIdx!=null){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      const it = ST.list[ST.dragIdx]; if (!it) return;
      it.anchor = { q:h.q|0, r:h.r|0 };
      renderOne(ST.dragIdx);
      return;
    }
  }
  function onPointerUp(){
    if (ST.dragging){
      ST.dragging=false;
      const idx = ST.dragIdx; ST.dragIdx=null;
      if (idx!=null) pulse();
    }
  }
  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  /* ------------------ UI ------------------ */
  function mountUI(sel){
    const host = (typeof sel==='string')? document.querySelector(sel) : sel;
    if (!host) return;

    host.innerHTML = `
      <div class="structures-ui">
        <div class="row" id="typeTabs"></div>
        <div class="row" style="margin:6px 0;">
          <select id="defDropdown" class="input" style="min-width:220px"></select>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:8px;">
          <button class="btn sm" id="btnPlace">Place</button>
          <button class="btn sm" id="btnMove">Select/Move</button>
          <span style="flex:1 1 auto"></span>
          <button class="btn sm" id="btnRotL">◀ Rotate</button>
          <button class="btn sm" id="btnRotR">Rotate ▶</button>
          <button class="btn sm danger" id="btnDelete">Delete</button>
        </div>
      </div>
    `;
    ST.ui = host;

    $('#btnPlace',host).addEventListener('click', ()=>{
      setMode('place');
      const defId = $('#defDropdown',host).value;
      if (defId) setGhost(defId);
      syncButtons();
    });
    $('#btnMove',host).addEventListener('click', ()=>{ setMode('move'); syncButtons(); });
    $('#btnRotL',host).addEventListener('click', ()=> rotateSelected(-1));
    $('#btnRotR',host).addEventListener('click', ()=> rotateSelected(+1));
    $('#btnDelete',host).addEventListener('click', ()=> deleteSelected());
    $('#defDropdown',host).addEventListener('change', ()=>{
      if (ST.mode==='place'){
        const id = $('#defDropdown',host).value;
        if (id) setGhost(id);
      }
    });

    injectCSS();
    buildTypeTabs();
    rebuildDropdown();
    syncButtons();
  }

  function buildTypeTabs(){
    if (!ST.ui) return;
    const bar = $('#typeTabs', ST.ui); if (!bar) return;
    bar.innerHTML = '';
    const mk = (lbl, filterId=null)=>{
      const b=document.createElement('button');
      b.className='chip'; b.textContent=lbl;
      b.addEventListener('click', ()=>{
        rebuildDropdown(filterId);
        // keep current mode/ghost if in place
        if (ST.mode==='place'){
          const id = $('#defDropdown',ST.ui).value;
          if (id) setGhost(id); else { ST.ghost=null; renderGhost(); }
        }
      });
      bar.appendChild(b);
    };
    mk('All', null);
    (ST.types||[]).forEach(t=> mk(t.name||t.id, t.id));
  }

  function rebuildDropdown(typeId=null){
    if (!ST.ui) return;
    const sel = $('#defDropdown', ST.ui); if (!sel) return;
    sel.innerHTML='';
    const opt0=document.createElement('option');
    opt0.value=''; opt0.textContent='— choose structure —';
    sel.appendChild(opt0);
    (ST.defs||[]).filter(d=> !typeId || d.type===typeId).forEach(d=>{
      const o=document.createElement('option');
      o.value=d.id; o.textContent=d.name||d.id;
      sel.appendChild(o);
    });
  }

  function syncButtons(){
    if (!ST.ui) return;
    const place=$('#btnPlace',ST.ui), move=$('#btnMove',ST.ui);
    [place,move].forEach(b=> b.classList.remove('active'));
    if (ST.mode==='place') place.classList.add('active');
    if (ST.mode==='move') move.classList.add('active');
  }

  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css=document.createElement('style'); css.id='structures-css';
    css.textContent = `
      .structures-ui{ font:12px system-ui,sans-serif; color:var(--ink,#ddd); }
      .structures-ui .row{ display:flex; gap:8px; align-items:center; }
      .structures-ui .btn{ padding:4px 8px; border:1px solid var(--line,#333); background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
      .structures-ui .btn.sm{ font-size:12px; }
      .structures-ui .btn.danger{ border-color:#844; color:#f88; }
      .structures-ui .btn.active{ outline:1px solid var(--bt-amber,#f0b000); }
      .structures-ui .chip{ margin:2px 6px 6px 0; padding:2px 8px; border:1px solid var(--line,#333); background:transparent; color:inherit; border-radius:12px; cursor:pointer; }
      #world-structures .structure.selected :where(.bldg-body,.wall-body){ filter: drop-shadow(0 0 2px var(--bt-amber,#f0b000)); }
      #world-structures .ghost *{ opacity:.55 }
    `;
    document.head.appendChild(css);
  }

  /* ------------------ Hotkeys ------------------ */
  function attachHotkeys(){
    if (ST.hotkeys) return; ST.hotkeys=true;
    window.addEventListener('keydown', (e)=>{
      if (e.repeat) return;
      if (e.key==='q' || e.key==='Q'){ rotateSelected(-1); e.preventDefault(); }
      if (e.key==='e' || e.key==='E'){ rotateSelected(+1); e.preventDefault(); }
      if (e.key==='Delete'){ deleteSelected(); e.preventDefault(); }
      if (e.key==='Enter' && ST.mode==='place' && ST.ghost){ commitGhost(); e.preventDefault(); }
    });
  }

  /* ------------------ INIT ------------------ */
  function init(opts){
    if (ST.inited) return;
    ST.hexToPx = opts.hexToPx || ST.hexToPx;
    ST.pxToHex = opts.pxToHex || ST.pxToHex;
    ST.getTileHeight = opts.getTileHeight || ST.getTileHeight;
    ST.onMapTransform = opts.onMapTransform || null;
    ST.publish = opts.publish || null;
    ST.subscribe = opts.subscribe || null;
    ensureLayer();
    attachPointer();
    attachHotkeys();
    if (typeof ST.onMapTransform === 'function'){
      ST.onMapTransform(()=> renderAll());
    }
    ST.inited = true;
    console.info('[Structures] ready');
  }

  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // Expose API
  window.MSS_Structures = {
    init, loadCatalog, mountUI,
    serialize, hydrate, clear,
    bindLocalStorage, onMapChanged
  };

  // expose functions used above in scope
  function onPointerDown(e){
    const g = e.target.closest && e.target.closest('#world-structures > g.structure:not(#ghost-structure)');
    if (g){
      const idx = Number(g.getAttribute('data-index'));
      if (Number.isFinite(idx)){
        ST.selected = idx; renderAll();
        if (ST.mode==='move'){ ST.dragging=true; ST.dragIdx=idx; }
      }
      e.stopPropagation(); return;
    }
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q:h.q|0, r:h.r|0 };
      commitGhost();
      e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q:h.q|0, r:h.r|0 };
      renderGhost(); return;
    }
    if (ST.mode==='move' && ST.dragging && ST.dragIdx!=null){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      const it = ST.list[ST.dragIdx]; if (!it) return;
      it.anchor = { q:h.q|0, r:h.r|0 };
      renderOne(ST.dragIdx);
    }
  }
  function onPointerUp(){
    if (ST.dragging){
      ST.dragging=false;
      const idx = ST.dragIdx; ST.dragIdx=null;
      if (idx!=null) pulse();
    }
  }
  function toSvgPoint(cx,cy){
    ensureSvg(); if (!ST.svg) return null;
    const pt = ST.svg.createSVGPoint(); pt.x=cx; pt.y=cy;
    const m = ST.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }
})();
