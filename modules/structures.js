
/*!
 * MSS:84 — Structures module (Repaired)
 * Scope of change (per user request):
 *   - Remove/disable all local saves except on Place / Select-Move button state change.
 *   - Do NOT save during init/hydrate/map-load or in rotate/drag/delete/commit.
 *   - Keep UI and public API intact: dropdowns/types/defs, place/move/rotate/delete, serialize/hydrate, etc.
 *
 * Public API:
 *   MSS_Structures.init(opts)
 *   MSS_Structures.loadCatalog(url)
 *   MSS_Structures.mountUI(rootSelector)    // builds dropdowns + buttons
 *   MSS_Structures.setMode(mode)            // 'none' | 'place' | 'move' (ONLY place/move triggers save)
 *   MSS_Structures.setGhost(defId)
 *   MSS_Structures.commitGhost()
 *   MSS_Structures.rotateSelected(step)
 *   MSS_Structures.deleteSelected()
 *   MSS_Structures.serialize()
 *   MSS_Structures.hydrate(array)
 *   MSS_Structures.clear()
 *   MSS_Structures.bindLocalStorage(fnKey)  // for per-map key
 *   MSS_Structures.onMapChanged()
 */
(function(){
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const ST = {
    // host hooks
    hexToPx:(q,r)=>({x:0,y:0}),
    pxToHex:(x,y)=>({q:0,r:0}),
    publish:null, subscribe:null,

    // catalog
    defs:[], types:[], byId:new Map(), defsByType:new Map(),

    // runtime
    list:[],                 // [{defId, anchor:{q,r}, rot}]
    mode:'none',             // exposed via window property
    selected:null,
    ghost:null,
    dragging:false, dragIdx:null,

    // DOM
    svg:null, layer:null,
    ui:null, ddlType:null, ddlDef:null, btnPlace:null, btnMove:null, btnRot:null, btnDel:null,

    // storage
    getLocalKey:null,

    // guards
    isHydrating:false,
    mapReady:false,
    inited:false
  };

  // ===== utils =====
  const $ = (s,root=document)=>root.querySelector(s);
  const el = (n,attrs)=>{ const k=document.createElementNS(NS,n); if(attrs) for(const a in attrs){ const v=attrs[a]; if(v!=null) k.setAttribute(a, String(v)); } return k; };
  const clampRot = n => ((n%360)+360)%360;
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
    try{ const a=ST.hexToPx(0,0), b=ST.hexToPx(1,0); return Math.hypot(b.x-a.x,b.y-a.y)||96; }catch{ return 96; }
  }
  function worldToScreen(a){ const p=ST.hexToPx(a.q,a.r); return {x:p.x,y:p.y}; }
  function applyTransform(g, anchor, rot){
    const p = worldToScreen(anchor);
    g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${rot||0}) scale(${unitScale()})`);
  }

  // ===== catalog =====
  async function loadCatalog(url='./modules/catalog.json'){
    try{
      const res = await fetch(url); const j = await res.json();
      ST.defs = j.defs||[]; ST.types = j.types||[]; ST.byId = new Map(ST.defs.map(d=>[d.id,d]));
      // index by type
      ST.defsByType.clear();
      for(const d of ST.defs){
        const t = d.type || 'Misc';
        if (!ST.defsByType.has(t)) ST.defsByType.set(t, []);
        ST.defsByType.get(t).push(d);
      }
      console.log('[Structures] catalog loaded:', url, {version:j.version, types:ST.types.length, defs:ST.defs.length});
      // populate UI if mounted
      populateTypeDropdown();
    }catch(e){
      console.warn('[Structures] failed to load catalog', e);
    }
  }

  // ===== render =====
  function drawShape(s){
    const apply=(n)=>{ if(s.class) n.setAttribute('class',s.class);
      if(s.fill!=null) n.setAttribute('fill',s.fill);
      if(s.stroke!=null) n.setAttribute('stroke',s.stroke);
      if(s.sw!=null) n.setAttribute('stroke-width',String(s.sw));
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    };
    const kind = s.kind||'rect';
    if (kind==='rect'){
      const w=+s.w||1, h=+s.h||1;
      return apply(el('rect',{x:-(w/2), y:-(h/2), width:w, height:h, rx:s.rx!=null?+s.rx:undefined}));
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
    g.setAttribute('class','structure'+((ST.mode==='move'&&ST.selected===i)?' selected':''));
    g.replaceChildren();
    (def.shapes||[]).forEach(s=> g.appendChild(drawShape(s)));
    // generous hit area
    g.appendChild(el('rect',{x:-0.6,y:-0.6,width:1.2,height:1.2,fill:'transparent',stroke:'transparent'}));
    applyTransform(g, it.anchor, it.rot||0);

    g.onpointerdown = (e)=>{
      if (ST.mode!=='move') return;
      ST.selected=i; renderAll();
      ST.dragging=true; ST.dragIdx=i;
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

  // ===== persistence (NO autosave here) =====
  function perMapRead(){
    try{
      const key = ST.getLocalKey?.();
      if (!key) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Array.isArray(obj)) return obj;
      if (Array.isArray(obj.items)) return obj.items;
      return null;
    }catch{ return null; }
  }
  function perMapWrite(items){
    try{
      const key = ST.getLocalKey?.();
      if (!key) return;
      localStorage.setItem(key, JSON.stringify({version:1, items: items}));
    }catch{}
  }
  function serialize(){
    // never writes by itself
    return ST.list.map(it=>({defId:it.defId, anchor:{q:it.anchor.q,r:it.anchor.r}, rot:it.rot||0}));
  }
  function hydrate(arr){
    ST.isHydrating = true;
    try{
      ST.list = Array.isArray(arr) ? arr.map(it=>({
        defId: it.defId,
        anchor: {q: toInt(it.anchor?.q), r: toInt(it.anchor?.r)},
        rot: clampRot(toInt(it.rot||0))
      })) : [];
      ST.selected=null;
      renderAll();
    }finally{
      ST.isHydrating = false;
    }
  }
  function clear(){
    ST.list.length = 0;
    ST.selected = null;
    renderAll();
  }

  // ===== editing (NO save here) =====
  function setGhost(defId){
    if (!defId){ ST.ghost=null; renderGhost(); return; }
    const a = ST.list[ST.selected]?.anchor || {q:0,r:0};
    ST.ghost = {defId, anchor:{q:a.q,r:a.r}, rot:0};
    renderGhost();
  }
  function commitGhost(){
    if (ST.mode!=='place' || !ST.ghost) return;
    ST.list.push({defId:ST.ghost.defId, anchor:{...ST.ghost.anchor}, rot:ST.ghost.rot||0});
    renderAll();
  }
  function rotateSelected(step=60){
    if (ST.mode==='place' && ST.ghost){
      ST.ghost.rot = clampRot((ST.ghost.rot||0)+step); renderGhost(); return;
    }
    const i = ST.selected; if (i==null) return;
    ST.list[i].rot = clampRot((ST.list[i].rot||0)+step);
    renderAll();
  }
  function deleteSelected(){
    if (ST.mode==='place' && ST.ghost){ ST.ghost=null; renderGhost(); return; }
    const i = ST.selected; if (i==null) return;
    ST.list.splice(i,1); ST.selected=null;
    renderAll();
  }

  // ===== pointer (NO save here) =====
  function screenToWorld(e){
    const svg = ST.svg; if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x=e.clientX; pt.y=e.clientY;
    const m = svg.getScreenCTM(); if (!m) return null;
    const spt = pt.matrixTransform(m.inverse());
    return ST.pxToHex(spt.x, spt.y);
  }
  function attachPointer(){
    ensureSvg(); if (!ST.svg) return;
    ST.svg.addEventListener('pointermove', (e)=>{
      if (ST.mode==='place' && ST.ghost){
        const a = screenToWorld(e); if (!a) return;
        ST.ghost.anchor={q:Math.round(a.q), r:Math.round(a.r)};
        renderGhost();
      }else if (ST.mode==='move' && ST.dragging && ST.dragIdx!=null){
        const a = screenToWorld(e); if (!a) return;
        const i = ST.dragIdx; ST.list[i].anchor={q:Math.round(a.q), r:Math.round(a.r)};
        renderAll();
      }
    });
    ST.svg.addEventListener('pointerup', ()=>{ ST.dragging=false; ST.dragIdx=null; });
    ST.svg.addEventListener('click', (e)=>{
      if (ST.mode==='place' && ST.ghost){
        const a = screenToWorld(e); if (!a) return;
        ST.ghost.anchor={q:Math.round(a.q), r:Math.round(a.r)};
        commitGhost();
      }
    });
  }

  // ===== SAVE trigger (ONLY here) =====
  function flushSaveIfAllowed(){
    // Only write to disk on Place/Move mode change and only when map is ready, not during hydrate.
    if (ST.isHydrating || !ST.mapReady) return;
    const arr = serialize();
    perMapWrite(arr);
    try{ ST.publish && ST.publish('structures:saved', {count:arr.length}); }catch{}
  }
  function setMode(newMode){
    if (newMode!=='place' && newMode!=='move' && newMode!=='none') newMode='none';
    if (ST.mode === newMode) return;
    ST.mode = newMode;
    window.MSS_Structures.mode = ST.mode; // reflect externally
    ST.selected=null;
    renderAll();
    // TRIGGER SAVE only on toggling Place or Move
    if (newMode==='place' || newMode==='move') flushSaveIfAllowed();
  }

  // ===== UI (dropdowns kept) =====
  function populateTypeDropdown(){
    if (!ST.ddlType) return;
    const types = Array.from(new Set(ST.defs.map(d=>d.type||'Misc'))).sort();
    ST.ddlType.replaceChildren();
    const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='— Type —';
    ST.ddlType.appendChild(opt0);
    for(const t of types){
      const o=document.createElement('option'); o.value=t; o.textContent=t;
      ST.ddlType.appendChild(o);
    }
  }
  function populateDefDropdown(type){
    if (!ST.ddlDef) return;
    ST.ddlDef.replaceChildren();
    const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='— Structure —';
    ST.ddlDef.appendChild(opt0);
    const list = type ? (ST.defsByType.get(type)||[]) : ST.defs;
    for(const d of list){
      const o=document.createElement('option'); o.value=d.id; o.textContent=d.name||d.id;
      ST.ddlDef.appendChild(o);
    }
  }
  function mountUI(rootSelector){
    const root = typeof rootSelector==='string' ? $(rootSelector) : rootSelector;
    if (!root) return;
    ST.ui = root;

    const wrap = document.createElement('div');
    wrap.className = 'col gap';
    wrap.innerHTML = `
      <div class="row gap">
        <select id="structuresType" class="input sm"></select>
        <select id="structuresDef" class="input sm"></select>
      </div>
      <div class="row gap">
        <button class="btn sm" data-struct="place">Place</button>
        <button class="btn sm" data-struct="move">Select / Move</button>
        <button class="btn sm" data-struct="rot">Rotate</button>
        <button class="btn sm" data-struct="del">Delete</button>
      </div>
    `;
    root.appendChild(wrap);
    ST.ddlType = wrap.querySelector('#structuresType');
    ST.ddlDef  = wrap.querySelector('#structuresDef');
    ST.btnPlace = wrap.querySelector('[data-struct="place"]');
    ST.btnMove  = wrap.querySelector('[data-struct="move"]');
    ST.btnRot   = wrap.querySelector('[data-struct="rot"]');
    ST.btnDel   = wrap.querySelector('[data-struct="del"]');

    // wire
    ST.ddlType.onchange = ()=>{
      populateDefDropdown(ST.ddlType.value);
    };
    ST.ddlDef.onchange = ()=>{
      const id = ST.ddlDef.value || null;
      setGhost(id);
      if (ST.mode!=='place' && id) setMode('place'); // UX: picking an item flips to place
    };
    ST.btnPlace.onclick = ()=> setMode('place');
    ST.btnMove.onclick  = ()=> setMode('move');
    ST.btnRot.onclick   = ()=> rotateSelected(60);
    ST.btnDel.onclick   = ()=> deleteSelected();

    // initial data
    populateTypeDropdown();
    populateDefDropdown('');
  }

  // ===== lifecycle =====
  function init(opts={}){
    if (ST.inited) return;
    ST.inited = true;
    ST.hexToPx = opts.hexToPx || ST.hexToPx;
    ST.pxToHex = opts.pxToHex || ST.pxToHex;
    ST.publish = opts.publish || null;
    ST.subscribe= opts.subscribe || null;

    ensureSvg(); ensureLayer();
    attachPointer();

    // map ready
    if (typeof opts.onMapReady === 'function') opts.onMapReady(()=>{ ST.mapReady=true; });
    else ST.mapReady = true;

    // reflect mode
    // mode is exposed as a getter; no assignment needed

    console.log('[Structures] init');
  }
  function onMapChanged(){ renderAll(); }
  function bindLocalStorage(fnKey){
    ST.getLocalKey = typeof fnKey==='function' ? fnKey : null;
    // hydrate from disk, but DO NOT save here
    const arr = perMapRead();
    if (arr) hydrate(arr);
  }

  // expose
  window.MSS_Structures = {
    // state
    get mode(){ return ST.mode; },
    // main
    init, loadCatalog, mountUI,
    setMode, setGhost, commitGhost, rotateSelected, deleteSelected,
    serialize, hydrate, clear,
    bindLocalStorage, onMapChanged
  };
})();
