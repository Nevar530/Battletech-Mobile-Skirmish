
/*!
 * MSS:84 — Structures module (save only on place & move toggle)
 * - Saves ONLY on: (1) placement, (2) toggling Select/Move ON or OFF.
 * - No saves on drag/rotate/delete pointer events.
 * - Bridges to master snapshot via window.saveLocal() (single blob).
 * - Per-map fallback retained; serialize() protects against early blanking.
 * - Skips saving during hydrate; glow only when Select/Move is active.
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
    list:[],                 // [{defId, anchor:{q,r}, rot}]
    selected:null,
    mode:'none',             // 'none' | 'place' | 'move'
    ghost:null,              // {defId, anchor:{q,r}, rot}
    dragging:false, dragIdx:null,

    // DOM
    svg:null, layer:null, ui:null,

    // storage helpers
    getLocalKey:null,

    // guards & flags
    _unitScale:null,
    dirtyWhileMove:false,    // true if edits happened while in 'move'
    isHydrating:false,
    hadMasterHydrate:false,

    inited:false
  };


  // ---------- utils ----------
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
      g = document.createElementNS(NS,'g'); g.setAttribute('id','world-structures');
      const tokens = document.getElementById('world-tokens');
      if (tokens && tokens.parentNode) tokens.parentNode.insertBefore(g, tokens);
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


  // ---------- draw ----------
  function drawShape(s){
    const k = s.kind||'rect';
    const apply=(n)=>{
      if (s.class) n.setAttribute('class', s.class);
      if (s.fill!=null) n.setAttribute('fill', s.fill);
      if (s.stroke!=null) n.setAttribute('stroke', s.stroke);
      if (s.sw!=null) n.setAttribute('stroke-width', String(s.sw));
      n.setAttribute('vector-effect','non-scaling-stroke');
      return n;
    };
    if (k==='rect'){
      const w=+s.w||1, h=+s.h||1;
      const n = document.createElementNS(NS,'rect');
      n.setAttribute('x',-(w/2)); n.setAttribute('y',-(h/2));
      n.setAttribute('width',w); n.setAttribute('height',h);
      if (s.rx!=null) n.setAttribute('rx', String(+s.rx));
      return apply(n);
    }
    if (k==='polygon'){ const pts=(s.points||[]).map(p=>p.join(',')).join(' '); const n=document.createElementNS(NS,'polygon'); n.setAttribute('points',pts); return apply(n); }
    if (k==='polyline'){ const pts=(s.points||[]).map(p=>p.join(',')).join(' '); const n=document.createElementNS(NS,'polyline'); n.setAttribute('points',pts); return apply(n); }
    const n=document.createElementNS(NS,'path'); n.setAttribute('d', s.d||''); return apply(n);
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
    if (!g){ g = document.createElementNS(NS,'g'); g.setAttribute('id',id); g.setAttribute('class','structure'); ST.layer.appendChild(g); }
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
    const hit=document.createElementNS(NS,'rect'); hit.setAttribute('x',-0.6); hit.setAttribute('y',-0.6); hit.setAttribute('width',1.2); hit.setAttribute('height',1.2); hit.setAttribute('fill','transparent'); hit.setAttribute('stroke','transparent');
    g.appendChild(hit);
    applyTransform(g, it.anchor, it.rot||0);
    g.onpointerdown = (e)=>{
      if (ST.mode!=='move') return;
      ST.selected=i; renderAll();
      ST.dragging = True; ST.dragIdx = i;
      e.stopPropagation();
    };
  }


  function renderGhost(){
    if (!ST.layer) ensureLayer();
    const old = ST.layer && ST.layer.querySelector('#ghost-structure'); if (old) old.remove();
    if (ST.mode!=='place' || !ST.ghost || !ST.layer) return;
    const def = ST.byId.get(ST.ghost.defId); if (!def) return;
    const g = document.createElementNS(NS,'g'); g.setAttribute('id','ghost-structure'); g.setAttribute('class','structure ghost');
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

})();
