
/*!
 * MSS:84 — Structures module (hydrate-safe, snapshot-safe)
 * Behavior:
 *  - Saves on placement and when exiting Select/Move (batched edits).
 *  - Bridges to master snapshot via window.saveLocal() (single blob with tokens).
 *  - Per-map fallback via bindLocalStorage(fn) for fast local restores.
 *  - Prevents early-save clobber: serialize() falls back to per-map data
 *    until master has hydrated at least once.
 *  - Skips saving while hydrating to avoid loops.
 *  - Glow only in move mode; selection cleared on mode exit.
 * API:
 *   init({ hexToPx, pxToHex, onMapTransform, publish, subscribe })
 *   loadCatalog(url)
 *   mountUI(selector)
 *   serialize()
 *   hydrate(array)
 *   clear()
 *   bindLocalStorage(fnKey)   // fnKey(): string
 *   onMapChanged()
 */
(function(){
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const ST = {
    // host hooks
    hexToPx:(q,r)=>({x:0,y:0}),
    pxToHex:(x,y)=>({q:0,r:0}),
    onMapTransform:null,
    publish:null, subscribe:null,

    // catalog
    defs:[], types:[], byId:new Map(),

    // runtime
    list:[],             // [{defId, anchor:{q,r}, rot}]
    selected:null,
    mode:'none',         // 'none' | 'place' | 'move'
    ghost:null,          // {defId, anchor:{q,r}, rot}
    dragging:false, dragIdx:null,

    // DOM
    svg:null, layer:null, ui:null,

    // storage helpers
    getLocalKey:null,

    // guards & flags
    _unitScale:null,
    dirtyWhileMove:false,
    isHydrating:false,
    hadMasterHydrate:false,

    // init guard
    inited:false
  };

  // ---------- small utils ----------
  const $ = (s,root=document)=>root.querySelector(s);
  const el = (n,attrs)=>{ const k=document.createElementNS(NS,n); if(attrs) for(const a in attrs) k.setAttribute(a, attrs[a]); return k; };
  const toInt = v => +v||0;

  function ensureSvg(){
    if (ST.svg && ST.svg.isConnected) return;
    ST.svg = document.getElementById('svg') || document.querySelector('svg#hexmap') || document.querySelector('svg');
  }
  function ensureLayer(){
    ensureSvg(); if (!ST.svg) return;
    let g = document.getElementById('world-structures');
    if (!g){
      g = el('g',{id:'world-structures'});
      const tokens = document.getElementById('world-tokens');
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(g,tokens);
      else ST.svg.appendChild(g);
    }
    ST.layer = g;
  }
  function unitScale(){
    if (ST._unitScale) return ST._unitScale;
    try{ const a=ST.hexToPx(0,0), b=ST.hexToPx(1,0); ST._unitScale=Math.hypot(b.x-a.x,b.y-a.y)||96; }
    catch{ ST._unitScale=96; }
    return ST._unitScale;
  }
  function toSvgPoint(cx,cy){
    ensureSvg(); if (!ST.svg) return null;
    const pt = ST.svg.createSVGPoint(); pt.x=cx; pt.y=cy;
    const m = ST.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }

  // ---------- draw helpers ----------
  function drawShape(s){
    const k = s.kind||'rect';
    const apply=(n)=>{ if(s.class) n.setAttribute('class',s.class);
      if(s.fill!=null) n.setAttribute('fill',s.fill);
      if(s.stroke!=null) n.setAttribute('stroke',s.stroke);
      if(s.sw!=null) n.setAttribute('stroke-width',String(s.sw));
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    };
    if (k==='rect'){
      const w=+s.w||1, h=+s.h||1;
      return apply(el('rect',{x:-(w/2), y:-(h/2), width:w, height:h, rx:s.rx!=null?+s.rx:undefined}));
    }
    if (k==='polygon'){ const pts=(s.points||[]).map(p=>p.join(',')).join(' '); return apply(el('polygon',{points:pts})); }
    if (k==='polyline'){ const pts=(s.points||[]).map(p=>p.join(',')).join(' '); return apply(el('polyline',{points:pts})); }
    return apply(el('path',{d:s.d||''}));
  }
  function worldToScreen(a){ const p=ST.hexToPx(a.q,a.r); return {x:p.x,y:p.y}; }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor);
    const k = unitScale();
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0}) scale(${k})`);
  }

  function ensureGroupFor(i){
    ensureLayer(); if (!ST.layer) return null;
    const id='struct-'+i;
    let g = ST.layer.querySelector('#'+CSS.escape(id));
    if (!g){ g = el('g',{id, class:'structure'}); ST.layer.appendChild(g); }
    return g;
  }
  function renderOne(i){
    const it = ST.list[i]; if (!it) return;
    const def = ST.byId.get(it.defId); if (!def) return;
    const g = ensureGroupFor(i); if (!g) return;
    g.setAttribute('data-index', i);
    g.setAttribute('data-def', it.defId);
    g.setAttribute('class', 'structure'+((ST.selected===i && ST.mode==='move')?' selected':''));
    g.replaceChildren();
    (def.shapes||[]).forEach(s=> g.appendChild(drawShape(s)));
    // enlarge hit area
    g.appendChild(el('rect',{x:-0.6,y:-0.6,width:1.2,height:1.2,fill:'transparent',stroke:'transparent'}));
    applyTransform(g, it.anchor, it.rot||0);

    // pointer for move mode
    g.onpointerdown = (e)=>{
      if (ST.mode!=='move') return;
      ST.selected=i; renderAll();
      ST.dragging = true; ST.dragIdx = i;
      e.stopPropagation();
    };
  }
  function renderGhost(){
    if (!ST.layer) ensureLayer();
    const old = ST.layer && ST.layer.querySelector('#ghost-structure'); if (old) old.remove();
    if (ST.mode!=='place' || !ST.ghost || !ST.layer) return;
    const def = ST.byId.get(ST.ghost.defId); if (!def) return;
    const g = el('g',{id:'ghost-structure', class:'structure ghost'});
    (def.shapes||[]).forEach(s=> g.appendChild(drawShape(s)));
    applyTransform(g, ST.ghost.anchor, ST.ghost.rot||0);
    g.style.opacity='.55'; g.style.pointerEvents='none';
    ST.layer.appendChild(g);
  }
  function pruneDom(){
    if (!ST.layer) return;
    const max = ST.list.length;
    ST.layer.querySelectorAll('#world-structures > g.structure').forEach(n=>{
      if (n.id==='ghost-structure') return;
      const idx = toInt(n.getAttribute('data-index'));
      if (!Number.isFinite(idx) || idx>=max) n.remove();
    });
  }
  function renderAll(){
    ensureLayer(); if (!ST.layer) return;
    pruneDom();
    for (let i=0;i<ST.list.length;i++) renderOne(i);
    renderGhost();
  }

  // ---------- persistence ----------
  function perMapRead(){
    try{
      const key = ST.getLocalKey?.();
      if (!key) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      // support both {items:[...]} and plain array
      if (Array.isArray(arr)) return arr;
      if (Array.isArray(arr.items)) return arr.items;
      return null;
    }catch{ return null; }
  }
  function perMapWrite(items){
    try{
      const key = ST.getLocalKey && ST.getLocalKey();
      if (key) localStorage.setItem(key, JSON.stringify({version:1, items: items}));
    }catch{}
  }

  function serialize(){
    // If we haven't hydrated from master yet and our live list is empty,
    // fall back to last per-map snapshot so early saveLocal() can't clobber the master blob.
    if (!ST.hadMasterHydrate && ST.list.length===0){
      const cached = perMapRead();
      if (Array.isArray(cached)) return cached.map(x=>({
        defId:x.defId, anchor:{q:toInt(x.anchor?.q), r:toInt(x.anchor?.r)}, rot:toInt(x.rot)
      }));
    }
    return ST.list.map(it=>({ defId:it.defId, anchor:{q:it.anchor.q, r:it.anchor.r}, rot:it.rot||0 }));
  }
  function hydrate(arr){
    ST.isHydrating = true;
    try{
      const list = Array.isArray(arr) ? arr : [];
      if (list.length) ST.hadMasterHydrate = true;
      ST.list = list.map(x=>({ defId:x.defId, anchor:{ q: toInt(x.anchor?.q), r: toInt(x.anchor?.r) }, rot: ((toInt(x.rot)||0)%360+360)%360 }));
      ST.selected = null;
      renderAll();
      // NOTE: no saving during hydrate by design
    } finally {
      ST.isHydrating = false;
    }
  }

  function pulseSave(){
    // 1) per-map snapshot (fast local restore)
    perMapWrite(serialize());
    // 2) master snapshot (single app blob) — skip while hydrating
    try{
      if (!ST.isHydrating && typeof window.saveLocal === 'function') window.saveLocal();
    }catch{}
    // 3) notify
    try{ if (typeof ST.publish==='function') ST.publish('structures:changed', serialize()); }catch{}
  }

  function bindLocalStorage(fnKey){
    ST.getLocalKey = (typeof fnKey==='function') ? fnKey : null;
    // initial restore only if master hasn't hydrated us yet
    if (!ST.hadMasterHydrate){
      const cached = perMapRead();
      if (Array.isArray(cached)){
        ST.list = cached.map(x=>({ defId:x.defId, anchor:{ q: toInt(x.anchor?.q), r: toInt(x.anchor?.r) }, rot: toInt(x.rot)||0 }));
        renderAll();
      }
    }
  }
  function onMapChanged(){
    const cached = perMapRead();
    hydrate(Array.isArray(cached) ? cached : []);
  }

  // ---------- interaction ----------
  function setMode(m){

    const prev = ST.mode;
    ST.mode = m;
    if (ST.ui){
      const bP = $('#btnPlace',ST.ui), bM = $('#btnMove',ST.ui);
      [bP,bM].forEach(b=> b&&b.classList.remove('active'));
      if (m==='place' && bP) bP.classList.add('active');
      if (m==='move'  && bM) bM.classList.add('active');
    }

    if (m!=='place'){ ST.ghost=null; renderGhost(); }

    if (prev==='move' && m!=='move'){
      ST.selected=null; renderAll();
      if (ST.dirtyWhileMove){ ST.dirtyWhileMove=false; }
    }
    if (m==='move') ST.dirtyWhileMove=false;
    renderAll();
  }
  function setGhost(defId){
    ST.mode='place';
    ST.ghost = { defId, anchor:{q:0,r:0}, rot:0 };
    renderGhost();
  }
  function commitGhost(){
    if (!ST.ghost) return;
    ST.list.push({ defId: ST.ghost.defId, anchor:{...ST.ghost.anchor}, rot: ST.ghost.rot||0 });
    ST.selected = ST.list.length-1;
    renderAll();
    // save immediately on placement
  }
  function rotateSelected(steps){
    if (ST.mode==='place' && ST.ghost){
      ST.ghost.rot = ((ST.ghost.rot||0) + steps*60 + 360) % 360;
      renderGhost(); return;
    }
    if (ST.selected==null) return;
    const it = ST.list[ST.selected]; if (!it) return;
    it.rot = ((it.rot||0) + steps*60 + 360) % 360;
    renderOne(ST.selected);
    if (ST.mode==='move') ST.dirtyWhileMove=true; else }
  function deleteSelected(){
    if (ST.selected==null) return;
    ST.list.splice(ST.selected,1);
    ST.selected=null; renderAll();
    if (ST.mode==='move') ST.dirtyWhileMove=true; else }

  function onPointerDown(e){
    const g = e.target.closest && e.target.closest('#world-structures > g.structure:not(#ghost-structure)');
    if (g && ST.mode==='move'){
      ST.selected = toInt(g.getAttribute('data-index')); renderAll();
      ST.dragging = true; ST.dragIdx = ST.selected;
      e.stopPropagation(); return;
    }
    if (ST.mode==='place' && ST.ghost){
      commitGhost(); e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      ST.ghost.anchor = { q: (h.q|0), r: (h.r|0) };
      renderGhost(); return;
    }
    if (ST.mode==='move' && ST.dragging && ST.dragIdx!=null){
      const p = toSvgPoint(e.clientX,e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x,p.y);
      const it = ST.list[ST.dragIdx]; if (!it) return;
      it.anchor = { q:(h.q|0), r:(h.r|0) };
      renderOne(ST.dragIdx);
    }
  }
  function onPointerUp(){
    if (ST.dragging){
      ST.dragging=false;
      const idx=ST.dragIdx; ST.dragIdx=null;
      if (idx!=null){ if (ST.mode==='move') ST.dirtyWhileMove=true; else }
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
    host.innerHTML = [
      '<div class="structures-ui">',
      '  <div class="row" id="typeTabs"></div>',
      '  <div class="row" style="margin:6px 0;">',
      '    <select id="defDropdown" class="input" style="min-width:220px"></select>',
      '  </div>',
      '  <div class="row" style="flex-wrap:wrap; gap:8px;">',
      '    <button class="btn sm" id="btnPlace">Place</button>',
      '    <button class="btn sm" id="btnMove">Select/Move</button>',
      '    <span style="flex:1 1 auto"></span>',
      '    <button class="icon sm" id="btnRotL" title="Rotate Left">⟲</button>',
      '    <button class="icon sm" id="btnRotR" title="Rotate Right">⟳</button>',
      '    <button class="icon sm danger" id="btnDelete" title="Delete">🗑</button>',
      '  </div>',
      '</div>'
    ].join('');
    ST.ui = host;

    const tabs = $('#typeTabs',host);
    const dd   = $('#defDropdown',host);
    const bP = $('#btnPlace',host);
    const bM = $('#btnMove',host);
    const bL = $('#btnRotL',host);
    const bR = $('#btnRotR',host);
    const bD = $('#btnDelete',host);

    bP.onclick = ()=>{ setMode(ST.mode==='place' ? 'none' : 'place'); if (ST.mode==='place'){ const id=dd.value; if (id) setGhost(id); } };
    bM.onclick = ()=> setMode(ST.mode==='move' ? 'none' : 'move');
    bL.onclick = ()=> rotateSelected(-1);
    bR.onclick = ()=> rotateSelected(+1);
    bD.onclick = ()=> deleteSelected();

    dd.onchange = ()=>{ if (ST.mode==='place'){ const id=dd.value; if (id) setGhost(id); else { ST.ghost=null; renderGhost(); } } };

    buildTypeTabs(tabs, dd);
    rebuildDropdown(dd, null);
    setMode('none'); // default idle
    injectCSS();
  }
  function buildTypeTabs(tabsEl, dd){
    tabsEl.innerHTML='';
    const mk=(label, typeId=null)=>{
      const b=document.createElement('button');
      b.className='chip'; b.textContent=label;
      b.onclick = ()=>{
        tabsEl.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        rebuildDropdown(dd, typeId);
        if (ST.mode==='place'){ const id=dd.value; if (id) setGhost(id); else { ST.ghost=null; renderGhost(); } }
      };
      tabsEl.appendChild(b);
    };
    mk('All', null);
    (ST.types||[]).forEach(t=> mk(t.name||t.id, t.id));
    const first=tabsEl.querySelector('.chip'); if (first) first.classList.add('active');
  }
  function rebuildDropdown(dd, typeId){
    dd.innerHTML='';
    const o0=document.createElement('option'); o0.value=''; o0.textContent='— choose structure —'; dd.appendChild(o0);
    (ST.defs||[]).filter(d=>!typeId || d.type===typeId).forEach(d=>{
      const o=document.createElement('option'); o.value=d.id; o.textContent=d.name||d.id; dd.appendChild(o);
    });
  }
  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css=document.createElement('style'); css.id='structures-css';
    css.textContent = [
      ':root { --bt-amber:#f0b000; --line:#2a2d33; }',
      '.structures-ui{ font:12px system-ui, sans-serif; color:var(--ink,#ddd) }',
      '.structures-ui .row{ display:flex; gap:8px; align-items:center }',
      '.structures-ui .chip{ margin:2px 6px 6px 0; padding:2px 8px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:12px; cursor:pointer }',
      '.structures-ui .chip.active{ border-color:var(--bt-amber); color:var(--bt-amber) }',
      '.structures-ui .btn,.structures-ui .icon{ padding:3px 7px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:6px; cursor:pointer }',
      '.structures-ui .btn.sm,.structures-ui .icon.sm{ font-size:12px }',
      '.structures-ui .btn.active{ outline:1px solid var(--bt-amber) }',
      '.structures-ui .icon.danger{ border-color:#844; color:#f88 }',
      '#world-structures .structure.selected * { filter: drop-shadow(0 0 2px var(--bt-amber)) }',
      '#world-structures .ghost *{ opacity:.55 }'
    ].join('\n');
    document.head.appendChild(css);
  }

  // ---------- catalog ----------
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('catalog '+res.status);
    const data = await res.json();
    let defs=[], types=[];
    if (Array.isArray(data)) defs=data;
    else if (Array.isArray(data.items)) defs=data.items;
    else if (Array.isArray(data.defs)) { defs=data.defs; if (Array.isArray(data.types)) types=data.types; }
    else throw new Error('invalid catalog');
    ST.defs=defs; ST.types=types; ST.byId.clear(); defs.forEach(d=>ST.byId.set(d.id,d));
    // refresh UI dropdowns if mounted
    if (ST.ui){ buildTypeTabs($('#typeTabs',ST.ui), $('#defDropdown',ST.ui)); rebuildDropdown($('#defDropdown',ST.ui), null); }
    renderAll();
  }

  // ---------- init ----------
  function init(opts){
    if (ST.inited) return;
    ST.hexToPx = opts?.hexToPx || ST.hexToPx;
    ST.pxToHex = opts?.pxToHex || ST.pxToHex;
    ST.onMapTransform = opts?.onMapTransform || null;
    ST.publish = opts?.publish || null;
    ST.subscribe = opts?.subscribe || null;

    ensureLayer();
    attachPointer();
    if (typeof ST.onMapTransform === 'function'){
      ST.onMapTransform(()=>{ ST._unitScale=null; renderAll(); });
    }
    ST.inited=true;
    console.info('[Structures] hydrate-safe build active');
  }

  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // ---------- expose ----------
  window.MSS_Structures = {
    init,
    loadCatalog,
    mountUI,
    serialize,
    hydrate,
    clear: ()=>{ ST.list=[]; ST.selected=null; renderAll(); },
    bindLocalStorage,
    onMapChanged,
    // optional helpers for host/UI
    setMode, setGhost, commitGhost, rotateSelected, deleteSelected
  };

})();
