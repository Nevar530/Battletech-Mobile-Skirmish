/*!
 * MSS:84 — Structures (Buildings / Walls / Gates)
 * UI: [Type Tabs] [Dropdown] [Place | Select/Move | ⟲ ⟳ | 🗑]
 *
 * Public API (window.MSS_Structures):
 *   init({ hexToPx, pxToHex, getTileHeight?, onMapTransform?, publish?, subscribe? })
 *   loadCatalog(url)
 *   mountUI(selector)
 *   serialize()
 *   hydrate(arr)
 *   clear()
 *   bindLocalStorage(fnKey)      // fnKey(): string per-map key
 *   onMapChanged()               // rehydrate current map key
 */
(function(){
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- Module state ----------
  const ST = {
    // host hooks
    hexToPx:(q,r)=>({x:0,y:0}),
    pxToHex:(x,y)=>({q:0,r:0}),
    getTileHeight:(q,r)=>0,
    onMapTransform:null,
    publish:null, subscribe:null,

    // catalog
    types:[],
    defs:[],
    byId:new Map(),

    // runtime
    list:[],                 // [{defId, anchor:{q,r}, rot}]
    selected:null,           // index or null
    mode:'none',             // 'none' | 'place' | 'move'
    ghost:null,              // {defId, anchor:{q,r}, rot}
    dragging:false,
    dragIdx:null,

    // DOM
    svg:null,
    layer:null,
    ui:null,

    // storage
    getLocalKey:null,

    // misc
    hotkeys:false,
    inited:false,
    _unitScale:null, dirtyWhileMove:false, isHydrating:false, hadMasterHydrate:false
  };

  // ---------- DOM util ----------
  const el = (n, attrs) => { const k=document.createElementNS(NS,n); if(attrs) for(const a in attrs) k.setAttribute(a, attrs[a]); return k; };
  function $(sel,root=document){ return root.querySelector(sel); }
  function clear(n){ while(n.firstChild) n.removeChild(n.firstChild); }

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

  // ---------- Geometry ----------
  function unitScale(){
    if (ST._unitScale) return ST._unitScale;
    try {
      const a = ST.hexToPx(0,0), b = ST.hexToPx(1,0);
      ST._unitScale = Math.hypot(b.x-a.x, b.y-a.y) || 96;
    } catch { ST._unitScale = 96; }
    return ST._unitScale;
  }
  function worldToScreen(q,r){ return ST.hexToPx(q,r); }
  function toSvgPoint(cx,cy){
    ensureSvg(); if (!ST.svg) return null;
    const pt = ST.svg.createSVGPoint(); pt.x=cx; pt.y=cy;
    const m = ST.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }

  // axial rotation helper (unused for footprint height here, kept if you wire LOS)
  function rotAx(dq, dr, steps){
    const s = ((steps%6)+6)%6;
    let x=dq, z=dr, y=-x-z;
    for(let i=0;i<s;i++){ const nx=-z, ny=-x, nz=-y; x=nx; y=ny; z=nz; }
    return {dq:x, dr:z};
  }

  // ---------- Drawing ----------
  function drawShape(s){
    const kind = s.kind || 'rect';
    const fill   = (s.fill   != null) ? s.fill   : undefined;
    const stroke = (s.stroke != null) ? s.stroke : undefined;
    const sw     = (s.sw     != null) ? String(s.sw) : undefined;

    function apply(n){
      if (s.class) n.setAttribute('class', s.class);
      if (fill   !== undefined) n.setAttribute('fill', fill);
      if (stroke !== undefined) n.setAttribute('stroke', stroke);
      if (sw     !== undefined) n.setAttribute('stroke-width', sw);
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    }

    if (kind === 'rect'){
      const w = +s.w || 1, h = +s.h || 1;
      const x = -(w/2), y = -(h/2);   // force centered rect so rotation pivots at center
      const n = apply(el('rect',{x,y,width:w,height:h}));
      if (s.rx != null) n.setAttribute('rx', +s.rx);
      return n;
    }
    if (kind === 'polygon'){
      const pts = (s.points||[]).map(p=>p.join(',')).join(' ');
      return apply(el('polygon',{points:pts}));
    }
    if (kind === 'polyline'){
      const pts = (s.points||[]).map(p=>p.join(',')).join(' ');
      return apply(el('polyline',{points:pts}));
    }
    return apply(el('path',{d:s.d||''}));
  }

  function ensureGroupFor(i){
    ensureLayer(); if (!ST.layer) return null;
    const id='struct-'+i;
    let g = ST.layer.querySelector('#'+CSS.escape(id));
    if (!g){ g = el('g',{id, class:'structure'}); ST.layer.appendChild(g); }
    return g;
  }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor.q, anchor.r);
    const k = unitScale();
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0}) scale(${k})`);
    g.style.pointerEvents = 'auto';
  }

  function renderOne(i){
    const it = ST.list[i]; const def = ST.byId.get(it.defId); if (!def) return;
    const g = ensureGroupFor(i); if (!g) return;
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', def.id);
    g.setAttribute('class', 'structure'+((ST.selected===i && ST.mode==='move')?' selected':''));
    clear(g);
    (def.shapes||[]).forEach(s => g.appendChild(drawShape(s)));
    // bigger hit area in local units
    g.appendChild(el('rect',{x:-0.6,y:-0.6,width:1.2,height:1.2,fill:'transparent',stroke:'transparent'}));
    applyTransform(g, it.anchor, it.rot||0);
  }

  function renderGhost(){
    if (!ST.layer) ensureLayer();
    const old = ST.layer && ST.layer.querySelector('#ghost-structure');
    if (old) old.remove();
    if (ST.mode!=='place' || !ST.ghost || !ST.layer) return;
    const def = ST.byId.get(ST.ghost.defId); if (!def) return;
    const g = el('g',{id:'ghost-structure', class:'structure ghost'});
    (def.shapes||[]).forEach(s=> g.appendChild(drawShape(s)));
    applyTransform(g, ST.ghost.anchor, ST.ghost.rot||0);
    g.style.opacity = .55; g.style.pointerEvents='none';
    ST.layer.appendChild(g);
  }

  function pruneDom(){
    if (!ST.layer) return;
    const max = ST.list.length;
    ST.layer.querySelectorAll('#world-structures > g.structure').forEach(n=>{
      if (n.id==='ghost-structure') return;
      const idx = Number(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx >= max) n.remove();
    });
  }

  function renderAll(){
    ensureLayer(); if (!ST.layer) return;
    pruneDom();
    for (let i=0;i<ST.list.length;i++) renderOne(i);
    renderGhost();
  }

  // ---------- Persistence ----------
  function serialize(){
    return ST.list.map(it => ({ defId:it.defId, anchor:{q:it.anchor.q,r:it.anchor.r}, rot:it.rot||0 }));
  }
  function hydrate(arr){
    ST.isHydrating = true;
    ST.hadMasterHydrate = Array.isArray(arr) && arr.length>0 ? true : ST.hadMasterHydrate;
    ST.list = Array.isArray(arr) ? arr.map(x=>({
      defId:x.defId,
      anchor:{ q:+(x.anchor?.q||0), r:+(x.anchor?.r||0) },
      rot:(+x.rot||0)%360
    })) : [];
    ST.selected = null;
    renderAll();
    // keep per-map copy in sync even after import, but avoid master cascade
    try{
      const key = ST.getLocalKey?.();
      if (key) localStorage.setItem(key, JSON.stringify(serialize()));
    }catch{}
    ST.isHydrating = false;
  }
  function clearAll(){ function clearAll(){
    ST.list = [];
    ST.selected = null;
    renderAll();
    pulseSave();
  }

  // autosave plumbing
  function bindLocalStorage(getKey){
    ST.getLocalKey = (typeof getKey==='function') ? getKey : null;
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
      hydrate(raw ? JSON.parse(raw) : []);
    }catch{ hydrate([]); }
  }
  function pulseSave(){
    try{
      const key = ST.getLocalKey?.();
      if (key) localStorage.setItem(key, JSON.stringify(serialize()));
    }catch{}
    if (ST.isHydrating) return;
    try{ if (typeof window.saveLocal === 'function') window.saveLocal(); }catch{}
    if (typeof ST.publish === 'function'){
      try{ ST.publish('structures:changed', serialize()); }catch{}
    }
  }catch{}
    if (typeof ST.publish === 'function'){
      try{ ST.publish('structures:changed', serialize()); }catch{}
    }
  }
  window.addEventListener('beforeunload', ()=>{ try{ pulseSave(); }catch{} });

  // ---------- Interaction ----------
  function setMode(m){
    const prev = ST.mode;
    ST.mode = m; // 'none' | 'place' | 'move'
    if (ST.ui){
      const placeBtn = $('#btnPlace', ST.ui);
      const moveBtn  = $('#btnMove', ST.ui);
      [placeBtn,moveBtn].forEach(b=> b && b.classList.remove('active'));
      if (m==='place' && placeBtn) placeBtn.classList.add('active');
      if (m==='move'  && moveBtn)  moveBtn.classList.add('active');
    }
    if (m!=='place'){ ST.ghost = null; renderGhost(); }
    // leaving move -> commit batched changes
    if (prev==='move' && m!=='move'){
      ST.selected = null;
      if (ST.dirtyWhileMove){ try{ pulseSave(); }catch{} ST.dirtyWhileMove=false; }
    }
    // entering move -> start a clean batch
    if (m==='move'){ ST.dirtyWhileMove=false; }
    renderAll();
  }
  function setGhostfunction setGhost(defId){ ST.ghost = { defId, anchor:{q:0,r:0}, rot:0 }; renderGhost(); }
  function commitGhost(){
    if (!ST.ghost) return;
    ST.list.push({ defId: ST.ghost.defId, anchor:{...ST.ghost.anchor}, rot:ST.ghost.rot||0 });
    ST.selected = ST.list.length-1;
    renderAll(); pulseSave();
  }
  function rotateSelected(steps){
    if (ST.mode==='place' && ST.ghost){
      ST.ghost.rot = ((ST.ghost.rot||0) + steps*60 + 360) % 360;
      renderGhost(); return;
    }
    if (ST.selected==null) return;
    const it = ST.list[ST.selected]; if (!it) return;
    it.rot = ((it.rot||0) + steps*60 + 360) % 360;
    renderOne(ST.selected); if (ST.mode==='move') ST.dirtyWhileMove=true; else try{ pulseSave(); }catch{};
  }
  function deleteSelected(){
    if (ST.selected==null) return;
    ST.list.splice(ST.selected,1);
    ST.selected=null; renderAll();
    if (ST.mode==='move') ST.dirtyWhileMove=true; else try{ pulseSave(); }catch{}
  }

  function onPointerDown(e){
    // select/drag only in move mode
    const g = e.target.closest && e.target.closest('#world-structures > g.structure:not(#ghost-structure)');
    if (g && ST.mode==='move'){
      ST.selected = Number(g.getAttribute('data-index'));
      renderAll();
      ST.dragging = true; ST.dragIdx = ST.selected;
      e.stopPropagation(); return;
    }
    // place mode: clicking board commits current ghost position
    if (ST.mode==='place' && ST.ghost){
      commitGhost();
      e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    // ghost follows cursor (snaps)
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q:h.q|0, r:h.r|0 };
      renderGhost(); return;
    }
    // dragging a structure (snaps)
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
      if (idx!=null) { if (ST.mode==='move') ST.dirtyWhileMove=true; else try{ pulseSave(); }catch{} }
    }
  }
  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // ---------- UI ----------
  function mountUI(sel){
    const host = (typeof sel==='string') ? document.querySelector(sel) : sel;
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
          <button class="icon sm" id="btnRotL" title="Rotate Left">⟲</button>
          <button class="icon sm" id="btnRotR" title="Rotate Right">⟳</button>
          <button class="icon sm danger" id="btnDelete" title="Delete">🗑</button>
        </div>
      </div>
    `;
    ST.ui = host;

    // wire controls
    const tabs = $('#typeTabs',host);
    const dd   = $('#defDropdown',host);
    const bPlace = $('#btnPlace',host);
    const bMove  = $('#btnMove',host);
    const bL = $('#btnRotL',host);
    const bR = $('#btnRotR',host);
    const bDel = $('#btnDelete',host);

    bPlace.addEventListener('click', ()=>{
      setMode(ST.mode==='place' ? 'none' : 'place');
      if (ST.mode==='place'){
        const id = dd.value; if (id) setGhost(id);
      }
    });
    bMove.addEventListener('click', ()=> setMode(ST.mode==='move' ? 'none' : 'move'));
    bL.addEventListener('click', ()=> rotateSelected(-1));
    bR.addEventListener('click', ()=> rotateSelected(+1));
    bDel.addEventListener('click', ()=> deleteSelected());
    dd.addEventListener('change', ()=>{
      if (ST.mode==='place'){
        const id = dd.value;
        if (id) setGhost(id); else { ST.ghost=null; renderGhost(); }
      }
    });

    // build tabs & dropdown
    buildTypeTabs(tabs, dd);
    rebuildDropdown(dd, null);

    // default to locked (none) so users opt-in
    setMode('none');

    injectCSS();
  }

  function buildTypeTabs(tabsEl, dd){
    tabsEl.innerHTML = '';
    const mk = (label, typeId=null)=>{
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', ()=>{
        tabsEl.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        rebuildDropdown(dd, typeId);
        if (ST.mode==='place'){
          const id = dd.value;
          if (id) setGhost(id); else { ST.ghost=null; renderGhost(); }
        }
      });
      tabsEl.appendChild(b);
    };
    mk('All', null);
    (ST.types||[]).forEach(t => mk(t.name||t.id, t.id));
    const first = tabsEl.querySelector('.chip'); if (first) first.classList.add('active');
  }

  function rebuildDropdown(dd, typeId){
    dd.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value=''; opt0.textContent='— choose structure —';
    dd.appendChild(opt0);
    (ST.defs||[]).filter(d => !typeId || d.type===typeId).forEach(d=>{
      const o = document.createElement('option');
      o.value=d.id; o.textContent=d.name||d.id;
      dd.appendChild(o);
    });
  }

  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css = document.createElement('style'); css.id='structures-css';
    css.textContent = `
      :root { --bt-amber:#f0b000; --line:#2a2d33; }
      .structures-ui{ font:12px system-ui, sans-serif; color:var(--ink,#ddd) }
      .structures-ui .row{ display:flex; gap:8px; align-items:center }
      .structures-ui .chip{ margin:2px 6px 6px 0; padding:2px 8px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:12px; cursor:pointer }
      .structures-ui .chip.active{ border-color:var(--bt-amber); color:var(--bt-amber) }
      .structures-ui .btn,.structures-ui .icon{ padding:3px 7px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:6px; cursor:pointer }
      .structures-ui .btn.sm,.structures-ui .icon.sm{ font-size:12px }
      .structures-ui .btn.active{ outline:1px solid var(--bt-amber) }
      .structures-ui .icon.danger{ border-color:#844; color:#f88 }
      #world-structures .structure.selected * { filter: drop-shadow(0 0 2px var(--bt-amber)) }
      #world-structures .ghost *{ opacity:.55 }
    `;
    document.head.appendChild(css);
  }

  // ---------- Catalog ----------
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('catalog '+res.status);
    const data = await res.json();

    let defs=[], types=[];
    if (Array.isArray(data)) defs = data;
    else if (Array.isArray(data.items)) defs = data.items;
    else if (Array.isArray(data.defs)) { defs = data.defs; if (Array.isArray(data.types)) types = data.types; }
    else throw new Error('invalid catalog format');

    ST.defs = defs; ST.types = types;
    ST.byId.clear(); defs.forEach(d=> ST.byId.set(d.id, d));

    if (ST.ui){
      buildTypeTabs($('#typeTabs',ST.ui), $('#defDropdown',ST.ui));
      rebuildDropdown($('#defDropdown',ST.ui), null);
    }
    renderAll();
  }

  // ---------- Hotkeys ----------
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

  // ---------- Init / wire ----------
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
      ST.onMapTransform(()=>{ ST._unitScale=null; renderAll(); });
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

  // ---------- Expose ----------
  window.MSS_Structures = {
    init,
    loadCatalog,
    mountUI,
    serialize,
    hydrate,
    clear: clearAll,
    bindLocalStorage,
    onMapChanged
  };

})();
