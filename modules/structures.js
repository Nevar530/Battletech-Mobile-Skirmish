
/* structures.js — Batched save (place + exit-move), master-blob bridge, glow-gated, hydration-safe
   Drop-in module: exposes window.MSS_Structures
   - No core edits required.
   - Saves on placement and when leaving Select/Move (batches edits during move).
   - Bridges to window.saveLocal() so master hexmap_autosave includes structures like tokens.
   - Keeps per-map key (fallback) via bindLocalStorage().
   - Prevents save loops while hydrating.
   - Clears selection & glow when leaving move.
   - Clears cached unit scale on map transform.
*/

(function(){
  'use strict';

  const ST = {
    // host & wiring
    svg: null,
    layer: null,
    publish: null,
    subscribe: null,
    getMapId: null,
    getPerMapKey: null,
    onMapTransform: null,

    // state
    list: [],           // [{id, defId, x, y, w, h, angle, data...}]
    selected: null,     // index into list or null
    mode: 'idle',       // 'idle' | 'place' | 'move'
    ghost: null,        // {defId, w, h} while placing
    dirtyWhileMove: false,
    isHydrating: false,
    hadMasterHydrate: false,
    _unitScale: null,

    // config
    idSeq: 1
  };

  // ------------------------- Utilities -------------------------
  function uid(){ return `S${Date.now().toString(36)}_${(ST.idSeq++)}`; }
  function clamp(n,min,max){ return Math.min(max, Math.max(min, n)); }
  function ensureLayer(){
    if (!ST.layer) {
      if (!ST.svg) return null;
      let g = ST.svg.querySelector('g[data-role="structures"]');
      if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('data-role','structures');
        ST.svg.appendChild(g);
      }
      ST.layer = g;
    }
    return ST.layer;
  }
  function toPx(v){ return Number.isFinite(v) ? v : 0; }

  // ------------------------- Persistence -------------------------
  function perMapKey(){
    if (typeof ST.getPerMapKey === 'function') {
      try { return ST.getPerMapKey(); } catch(e){}
    }
    const mapId = (typeof ST.getMapId === 'function') ? (ST.getMapId()||'local') : 'local';
    return `mss84.structures.${mapId}`;
  }

  function serialize(){
    return ST.list.map(it => ({
      id: it.id, defId: it.defId,
      x: it.x, y: it.y, w: it.w, h: it.h, angle: it.angle,
      data: it.data || null
    }));
  }

  function persistNow(){
    // Write per-map key (fallback / fast restore)
    try {
      const key = perMapKey();
      localStorage.setItem(key, JSON.stringify({version:1, items: serialize()}));
    } catch(e){ /* ignore quota */ }

    // Ask host to include us in the master autosave blob
    try {
      if (typeof window.saveLocal === 'function') window.saveLocal();
    } catch(e){ /* host may not offer saveLocal in some contexts */ }

    // Notify listeners (optional)
    try {
      if (typeof ST.publish === 'function') ST.publish('structures:changed', serialize());
    } catch(e){}
  }

  function pulseSave(){
    // Guard against saving while we are hydrating state
    if (ST.isHydrating) return;
    // Only called on placement and move-exit; no heavy debounce needed
    persistNow();
  }

  function bindLocalStorage(getKeyFn){
    ST.getPerMapKey = getKeyFn;
    // Attempt initial restore only if host master did not already hydrate us
    if (!ST.hadMasterHydrate) {
      try{
        const key = perMapKey();
        const raw = localStorage.getItem(key);
        if (raw){
          const obj = JSON.parse(raw);
          if (obj && Array.isArray(obj.items)) {
            ST.list = obj.items.map(n => ({
              id: n.id || uid(), defId: n.defId || 'rect',
              x: toPx(n.x), y: toPx(n.y),
              w: toPx(n.w)||20, h: toPx(n.h)||20,
              angle: Number(n.angle)||0,
              data: n.data||null
            }));
            renderAll();
          }
        }
      }catch(e){}
    }
  }

  // ------------------------- Hydration -------------------------
  function hydrate(items){
    ST.isHydrating = true;
    try{
      if (Array.isArray(items) && items.length){
        ST.hadMasterHydrate = true;
        ST.list = items.map(n => ({
          id: n.id || uid(), defId: n.defId || 'rect',
          x: toPx(n.x), y: toPx(n.y),
          w: toPx(n.w)||20, h: toPx(n.h)||20,
          angle: Number(n.angle)||0,
          data: n.data||null
        }));
        // mirror master into per-map for fast restores
        try{
          const key = perMapKey();
          localStorage.setItem(key, JSON.stringify({version:1, items: serialize()}));
        }catch(e){}
      } else if (!ST.hadMasterHydrate) {
        // keep whatever per-map restore provided
      }
    } finally {
      ST.isHydrating = false;
      renderAll();
    }
  }

  // ------------------------- Modes & Interaction -------------------------
  function setMode(next){
    const prev = ST.mode;
    ST.mode = next || 'idle';

    // Leaving move: clear selection, commit batched changes
    if (prev === 'move' && ST.mode !== 'move'){
      ST.selected = null;
      renderAll();
      if (ST.dirtyWhileMove){
        ST.dirtyWhileMove = false;
        pulseSave();
      }
    }

    // Entering move: start clean
    if (ST.mode === 'move'){
      ST.dirtyWhileMove = false;
    }

    // Leaving place: remove ghost (no save here; placement save happens in commitGhost)
    if (prev === 'place' && ST.mode !== 'place'){
      ST.ghost = null;
    }

    // Always re-render on mode change to update glow
    renderAll();
  }

  function setGhost(defId, w, h){
    ST.mode = 'place';
    ST.ghost = { defId: defId || 'rect', w: Number(w)||20, h: Number(h)||20 };
    renderAll();
  }

  function clearAll(){
    ST.list = [];
    ST.selected = null;
    ST.ghost = null;
    ST.dirtyWhileMove = false;
    renderAll();
    pulseSave();
  }

  function selectIndex(i){
    ST.selected = (Number.isInteger(i) && i>=0 && i<ST.list.length) ? i : null;
    renderAll();
  }

  function moveSelectedBy(dx, dy){
    if (ST.mode !== 'move') return;
    const i = ST.selected;
    if (i==null) return;
    const it = ST.list[i];
    it.x += dx; it.y += dy;
    ST.dirtyWhileMove = true;
    renderOne(i);
  }

  function rotateSelectedBy(dAngle){
    if (ST.mode !== 'move') return;
    const i = ST.selected;
    if (i==null) return;
    const it = ST.list[i];
    it.angle = (Number(it.angle)||0) + dAngle;
    ST.dirtyWhileMove = true;
    renderOne(i);
  }

  function deleteSelected(){
    if (ST.mode !== 'move') return;
    const i = ST.selected;
    if (i==null) return;
    ST.list.splice(i,1);
    ST.selected = null;
    ST.dirtyWhileMove = true;
    renderAll();
  }

  function commitGhost(x, y){
    if (!ST.ghost) return;
    const g = ST.ghost;
    const item = {
      id: uid(),
      defId: g.defId || 'rect',
      x: toPx(x), y: toPx(y),
      w: toPx(g.w)||20, h: toPx(g.h)||20,
      angle: 0, data: null
    };
    ST.list.push(item);
    ST.ghost = null;
    renderAll();
    // Save immediately on placement
    pulseSave();
  }

  // ------------------------- Rendering -------------------------
  function renderAll(){
    const layer = ensureLayer();
    if (!layer) return;
    // Full redraw for simplicity
    layer.innerHTML = '';
    ST.list.forEach((_,i)=>renderOne(i));
    // ghost (optional: draw outline)
    if (ST.ghost && ST.mode==='place'){
      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x', -ST.ghost.w/2);
      r.setAttribute('y', -ST.ghost.h/2);
      r.setAttribute('width', ST.ghost.w);
      r.setAttribute('height', ST.ghost.h);
      r.setAttribute('fill','none');
      r.setAttribute('stroke','var(--bt-amber, #e2a23b)');
      r.setAttribute('stroke-dasharray','4,4');
      g.setAttribute('transform', `translate(${0},${0})`);
      g.setAttribute('opacity','0.6');
      g.appendChild(r);
      g.setAttribute('pointer-events','none');
      layer.appendChild(g);
    }
  }

  function renderOne(i){
    const layer = ensureLayer();
    if (!layer) return;
    const it = ST.list[i];
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    // Center-based drawing so rotate about center
    const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x', -it.w/2);
    r.setAttribute('y', -it.h/2);
    r.setAttribute('width', it.w);
    r.setAttribute('height', it.h);
    r.setAttribute('fill','var(--panel-2, #1a1a1a)');
    r.setAttribute('stroke','var(--ink-2, #333)');
    r.setAttribute('stroke-width','1');
    g.appendChild(r);

    const isSelected = (ST.mode==='move' && ST.selected===i);
    g.setAttribute('class', 'structure' + (isSelected ? ' selected' : ''));
    g.setAttribute('transform', `translate(${it.x},${it.y}) rotate(${it.angle})`);
    g.dataset.sid = it.id;

    // pointer handlers
    g.addEventListener('pointerdown', (ev)=>{
      if (ST.mode!=='move') return;
      ev.stopPropagation();
      ST.selected = i;
      let lastX = ev.clientX, lastY = ev.clientY;
      const onMove = (mv)=>{
        const dx = mv.clientX - lastX;
        const dy = mv.clientY - lastY;
        lastX = mv.clientX; lastY = mv.clientY;
        moveSelectedBy(dx, dy);
      };
      const onUp = ()=>{
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      renderAll();
    });

    layer.appendChild(g);
  }

  // ------------------------- Public API -------------------------
  const API = {
    init(opts){
      ST.svg = opts && opts.svg || document.querySelector('svg#hexmap');
      ST.publish = opts && opts.publish;
      ST.subscribe = opts && opts.subscribe;
      ST.getMapId = opts && opts.getMapId;
      ST.onMapTransform = opts && opts.onMapTransform;

      // hook host transform to clear unit scale cache
      if (typeof ST.onMapTransform === 'function'){
        try{
          ST.onMapTransform(()=>{
            ST._unitScale = null;
            renderAll();
          });
        }catch(e){}
      }

      ensureLayer();
      renderAll();
      console.log('[Structures] ready');
    },

    // render & selection
    render: renderAll,
    setMode,
    setGhost,
    clearAll,
    selectIndex,
    moveSelectedBy,
    rotateSelectedBy,
    deleteSelected,
    commitGhost,

    // persistence
    serialize,
    hydrate,
    bindLocalStorage
  };

  window.MSS_Structures = API;

})();
