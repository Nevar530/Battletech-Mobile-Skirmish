
/*!
 * MSS:84 — Structures (Simplified)
 * Purpose: place/rotate/move/delete SVG structures from catalog.json,
 *          and participate in app-level save/load via serialize()/hydrate().
 * Design rules:
 *  - NO writes except when user toggles Place or Move (enter OR exit).
 *  - serialize(): pure snapshot; BUT during early startup (before hydrate) if list empty,
 *    fall back to existing hexmap_autosave.structures to avoid clobber.
 *  - hydrate(data): replace in-memory list and render; NEVER writes.
 *  - UI layout preserved: tabs, dropdown, buttons (Place, Select/Move, Rotate L/R, Delete).
 */
(function(){
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const ST = {
    // host bridges
    hexToPx: (q,r)=>({x: q*80, y: r*92}),  // will be overridden by init()
    pxToHex: (x,y)=>({q: Math.round(x/80), r: Math.round(y/92)}),
    onMapTransform: null,
    publish: null,
    subscribe: null,

    // catalog
    defs: [],
    types: [],
    byId: new Map(),

    // runtime
    items: [],          // [{defId, anchor:{q,r}, rot:deg}]
    selected: null,     // index
    mode: 'none',       // 'none' | 'place' | 'move'
    ghost: null,        // {defId, anchor:{q,r}, rot}
    dragging: false,
    dragIdx: null,

    // dom
    svg: null,
    layer: null,
    uiHost: null,

    // guards
    hydratedOnce: false,
    isHydrating: false,
    _unit: null,
    inited: false
  };

  // ---------- utilities ----------
  const $ = (sel, root=document)=>root.querySelector(sel);
  const el = (n, attrs)=>{ const k=document.createElementNS(NS,n); if(attrs) for(const a in attrs) if(attrs[a]!=null) k.setAttribute(a, attrs[a]); return k; };
  const toInt = v => (v|0);

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
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(g, tokens);
      else ST.svg.appendChild(g);
    }
    ST.layer = g;
  }
  function unit(){
    if (ST._unit) return ST._unit;
    try{ const a=ST.hexToPx(0,0), b=ST.hexToPx(1,0); ST._unit = Math.hypot(b.x-a.x, b.y-a.y)||96; }
    catch{ ST._unit = 96; }
    return ST._unit;
  }
  function toSvgPoint(cx,cy){
    ensureSvg(); if (!ST.svg) return null;
    const pt = ST.svg.createSVGPoint(); pt.x=cx; pt.y=cy;
    const m = ST.svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }
  function worldToPx(anchor){ const p = ST.hexToPx(anchor.q, anchor.r); return {x:p.x, y:p.y}; }

  // ---------- catalog ----------
  async function loadCatalog(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error('Structures catalog '+res.status);
    const data = await res.json();
    let defs=[], types=[];
    if (Array.isArray(data)) defs = data;
    else if (Array.isArray(data.defs)) { defs = data.defs; types = Array.isArray(data.types)?data.types:[]; }
    else if (Array.isArray(data.items)) defs = data.items;
    else throw new Error('Invalid catalog format');
    ST.defs = defs;
    ST.types = types;
    ST.byId.clear();
    defs.forEach(d=> ST.byId.set(d.id, d));
    if (ST.uiHost){ rebuildTypeTabs(); rebuildDropdown(); }
    renderAll();
  }

  // ---------- render ----------
  function drawShape(s){
    const kind = s.kind || 'rect';
    const apply = (n)=>{
      if (s.class) n.setAttribute('class', s.class);
      if (s.fill!=null) n.setAttribute('fill', s.fill);
      if (s.stroke!=null) n.setAttribute('stroke', s.stroke);
      if (s.sw!=null) n.setAttribute('stroke-width', String(s.sw));
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    };
    if (kind==='rect'){
      const w=+s.w||1, h=+s.h||1;
      const attrs={x:-(w/2), y:-(h/2), width:w, height:h};
      if (s.rx!=null) attrs.rx=+s.rx;
      return apply(el('rect',attrs));
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
  function applyTransform(group, anchor, rot){
    const p = worldToPx(anchor);
    group.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0}) scale(${unit()})`);
  }
  function ensureItemGroup(i){
    ensureLayer(); if (!ST.layer) return null;
    const id='struct-'+i;
    let g = ST.layer.querySelector('#'+CSS.escape(id));
    if (!g){ g = el('g',{id, class:'structure'}); ST.layer.appendChild(g); }
    return g;
  }
  function renderOne(i){
    const it = ST.items[i]; if (!it) return;
    const def = ST.byId.get(it.defId); if (!def) return;
    const g = ensureItemGroup(i); if (!g) return;
    g.replaceChildren();
    (def.shapes||[]).forEach(s=> g.appendChild(drawShape(s)));
    // enlarged hit area
    g.appendChild(el('rect',{x:-0.6,y:-0.6,width:1.2,height:1.2,fill:'transparent',stroke:'transparent'}));
    g.setAttribute('data-index', String(i));
    g.setAttribute('data-def', it.defId);
    g.setAttribute('class','structure'+((ST.selected===i && ST.mode==='move')?' selected':''));
    applyTransform(g, it.anchor, it.rot||0);
    g.onpointerdown = (e)=>{
      if (ST.mode!=='move') return;
      ST.selected = i;
      ST.dragging = true;
      ST.dragIdx = i;
      renderAll();
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
    g.style.opacity='.55'; g.style.pointerEvents='none';
    applyTransform(g, ST.ghost.anchor, ST.ghost.rot||0);
    ST.layer.appendChild(g);
  }
  function pruneDom(){
    if (!ST.layer) return;
    const max = ST.items.length;
    ST.layer.querySelectorAll('#world-structures > g.structure').forEach(n=>{
      if (n.id==='ghost-structure') return;
      const idx = +n.getAttribute('data-index');
      if (!Number.isFinite(idx) || idx>=max) n.remove();
    });
  }
  function renderAll(){
    ensureLayer(); if (!ST.layer) return;
    pruneDom();
    for (let i=0;i<ST.items.length;i++) renderOne(i);
    renderGhost();
  }

  // ---------- interaction ----------
  function setMode(m){
    const prev = ST.mode;
    if (prev===m) return;
    ST.mode = m;

    if (ST.uiHost){
      const bP = $('#btnPlace', ST.uiHost);
      const bM = $('#btnMove', ST.uiHost);
      [bP,bM].forEach(b=> b&&b.classList.remove('active'));
      if (m==='place' && bP) bP.classList.add('active');
      if (m==='move'  && bM) bM.classList.add('active');
    }
    if (m!=='place'){ ST.ghost=null; renderGhost(); }
    if (prev==='move' && m!=='move'){ ST.selected=null; }

    // ONLY writer: save on entering or exiting place/move (if host provides saveLocal)
    if ((m==='place'||m==='move'||prev==='place'||prev==='move') && !ST.isHydrating){
      try{ if (typeof window.saveLocal==='function') window.saveLocal(); }catch{}
      try{ if (typeof ST.publish==='function') ST.publish('structures:changed', serialize()); }catch{}
    }

    renderAll();
  }
  function setGhost(defId){
    ST.mode='place';
    ST.ghost = { defId, anchor:{q:0,r:0}, rot:0 };
    renderGhost();
  }
  function commitGhost(){
    if (!ST.ghost) return;
    ST.items.push({ defId: ST.ghost.defId, anchor:{q:ST.ghost.anchor.q, r:ST.ghost.anchor.r}, rot: ST.ghost.rot||0 });
    ST.selected = ST.items.length-1;
    renderAll();
    // no save here; save occurs on mode toggle
  }
  function rotateSelected(step){
    if (ST.mode==='place' && ST.ghost){
      ST.ghost.rot = ((ST.ghost.rot||0) + step*60 + 360) % 360;
      renderGhost(); return;
    }
    if (ST.selected==null) return;
    const it = ST.items[ST.selected]; if (!it) return;
    it.rot = ((it.rot||0) + step*60 + 360) % 360;
    renderOne(ST.selected);
  }
  function deleteSelected(){
    if (ST.selected==null) return;
    ST.items.splice(ST.selected,1);
    ST.selected = null;
    renderAll();
    // no save; will save when toggling mode
  }

  // pointer handling
  function onPointerDown(e){
    const g = e.target.closest && e.target.closest('#world-structures > g.structure:not(#ghost-structure)');
    if (g && ST.mode==='move'){
      ST.selected = +g.getAttribute('data-index')|0;
      ST.dragging = true;
      ST.dragIdx = ST.selected;
      renderAll();
      e.stopPropagation(); return;
    }
    if (ST.mode==='place' && ST.ghost){
      commitGhost(); e.stopPropagation(); return;
    }
  }
  function onPointerMove(e){
    if (ST.mode==='place' && ST.ghost){
      const p = toSvgPoint(e.clientX, e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x, p.y);
      ST.ghost.anchor = { q:(h.q|0), r:(h.r|0) };
      renderGhost(); return;
    }
    if (ST.mode==='move' && ST.dragging && ST.dragIdx!=null){
      const p = toSvgPoint(e.clientX, e.clientY); if (!p) return;
      const h = ST.pxToHex(p.x, p.y);
      const it = ST.items[ST.dragIdx]; if (!it) return;
      it.anchor = { q:(h.q|0), r:(h.r|0) };
      renderOne(ST.dragIdx);
    }
  }
  function onPointerUp(){
    if (ST.dragging){
      ST.dragging=false;
      ST.dragIdx=null;
    }
  }
  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // ---------- UI ----------
  function mountUI(hostSel){
    const host = (typeof hostSel==='string') ? document.querySelector(hostSel) : hostSel;
    if (!host) return;
    ST.uiHost = host;
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

    const dd = $('#defDropdown', host);
    const bP = $('#btnPlace', host);
    const bM = $('#btnMove', host);
    const bL = $('#btnRotL', host);
    const bR = $('#btnRotR', host);
    const bD = $('#btnDelete', host);

    bP.onclick = ()=>{ setMode(ST.mode==='place'?'none':'place'); if (ST.mode==='place'){ const id=dd.value; if (id) setGhost(id); } };
    bM.onclick = ()=> setMode(ST.mode==='move'?'none':'move');
    bL.onclick = ()=> rotateSelected(-1);
    bR.onclick = ()=> rotateSelected(+1);
    bD.onclick = ()=> deleteSelected();
    dd.onchange = ()=>{ if (ST.mode==='place'){ const id=dd.value; if (id) setGhost(id); else { ST.ghost=null; renderGhost(); } } };

    rebuildTypeTabs();
    rebuildDropdown();
    setMode('none');
    injectCSS();
  }
  function rebuildTypeTabs(){
    const tabs = $('#typeTabs', ST.uiHost); if (!tabs) return;
    tabs.innerHTML='';
    const mk=(label, typeId=null)=>{
      const b=document.createElement('button'); b.className='chip'; b.textContent=label;
      b.onclick = ()=>{
        tabs.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        rebuildDropdown(typeId);
        if (ST.mode==='place'){ const id=$('#defDropdown',ST.uiHost).value; if (id) setGhost(id); }
      };
      tabs.appendChild(b);
    };
    mk('All', null);
    (ST.types||[]).forEach(t=> mk(t.name||t.id, t.id));
    const first=tabs.querySelector('.chip'); if (first) first.classList.add('active');
  }
  function rebuildDropdown(typeId=null){
    const dd = $('#defDropdown', ST.uiHost); if (!dd) return;
    dd.innerHTML='';
    const o0=document.createElement('option'); o0.value=''; o0.textContent='— choose structure —'; dd.appendChild(o0);
    (ST.defs||[]).filter(d=>!typeId || d.type===typeId).forEach(d=>{
      const o=document.createElement('option'); o.value=d.id; o.textContent=d.name||d.id; dd.appendChild(o);
    });
  }
  function injectCSS(){
    if (document.getElementById('structures-css')) return;
    const css = document.createElement('style'); css.id='structures-css';
    css.textContent = [
      ':root { --bt-amber:#f0b000; --ink:#ddd; --line:#2a2d33; }',
      '.structures-ui{ font:12px system-ui, sans-serif; color:var(--ink) }',
      '.structures-ui .row{ display:flex; gap:8px; align-items:center }',
      '.structures-ui .chip{ margin:2px 6px 6px 0; padding:2px 8px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:12px; cursor:pointer }',
      '.structures-ui .chip.active{ border-color:var(--bt-amber); color:var(--bt-amber) }',
      '.structures-ui .btn,.structures-ui .icon{ padding:3px 7px; border:1px solid var(--line); background:transparent; color:inherit; border-radius:6px; cursor:pointer }',
      '.structures-ui .btn.sm,.structures-ui .icon.sm{ font-size:12px }',
      '.structures-ui .btn.active{ outline:1px solid var(--bt-amber) }',
      '.structures-ui .icon.danger{ border-color:#844; color:#f88 }',
      '#world-structures .structure.selected *{ filter: drop-shadow(0 0 2px var(--bt-amber)) }',
      '#world-structures .ghost *{ opacity:.55 }'
    ].join('\\n');
    document.head.appendChild(css);
  }

  // ---------- persistence ----------
  function readMasterStructures(){
    try{
      const raw = localStorage.getItem('hexmap_autosave');
      if (!raw) return null;
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      if (typeof data === 'string'){ try{ data = JSON.parse(data); }catch{} }
      const arr = Array.isArray(data?.structures) ? data.structures : null;
      return (arr && arr.length) ? arr : null;
    }catch{ return null; }
  }

  function serialize(){
    // Early-init safety: if app calls saveLocal() before hydrate and list is empty,
    // reuse the last known structures from master to avoid clobber.
    if (!ST.hydratedOnce && ST.items.length===0){
      const prev = readMasterStructures();
      if (prev) return prev.map(x=>({ defId:x.defId, anchor:{q:+(x.anchor?.q||0), r:+(x.anchor?.r||0)}, rot:+(x.rot||0) }));
    }
    return ST.items.map(it=>({ defId:it.defId, anchor:{q:it.anchor.q, r:it.anchor.r}, rot:it.rot||0 }));
  }

  function hydrate(arr){
    ST.isHydrating = true;
    try{
      const list = Array.isArray(arr) ? arr : [];
      ST.items = list.map(x=>({ defId:x.defId, anchor:{q: toInt(x.anchor?.q), r: toInt(x.anchor?.r)}, rot: ((toInt(x.rot)||0)%360+360)%360 }));
      ST.selected = null;
      ST.hydratedOnce = true;
      renderAll();
    } finally {
      ST.isHydrating = false;
    }
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
      ST.onMapTransform(()=>{ ST._unit=null; renderAll(); });
    }
    ST.inited = true;
    console.info('[Structures] Simplified module mounted');
  }

  // ---------- expose ----------
  window.MSS_Structures = {
    init,
    loadCatalog,
    mountUI,
    serialize,
    hydrate,
    // UI helpers
    setMode, setGhost, rotateSelected, deleteSelected
  };

})();
