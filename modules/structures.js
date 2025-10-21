/* ===== MSS Structures — drop-in module =====
 * Exposes:
 *   MSS_Structures.init(opts)
 *   MSS_Structures.loadCatalog(url)
 *   MSS_Structures.mountUI(selector)
 *   MSS_Structures.serialize() -> array
 *   MSS_Structures.hydrate(arr)
 *   MSS_Structures.clear()
 *   MSS_Structures.bindLocalStorage(getKeyFn)
 *
 * Def shape fields supported:
 *   kind: 'rect'|'polygon'|'path'
 *   rect:  w,h,(x,y auto-centered),rx?, fill?, stroke?, sw?
 *   polygon: points:[[x,y]...], fill?, stroke?, sw?
 *   path: d:'M ...', fill?, stroke?, sw?
 */
(function(){
  const svgNS = 'http://www.w3.org/2000/svg';

  let API = {};
  let ROOT = null;            // <g id="world-structures">
  let CATALOG = [];           // [{id,name,type,heightMode,height,minHeight,cellHeights,footprint,shapes}]
  let BY_ID = new Map();
  let PLACED = [];            // [{id, defId, q, r, angle, scale}]
  let LOCAL_KEY_FN = null;    // () => string
  let SAVING_ENABLED = false;

  // host app bridges (provided by init())
  let hexToPx = (q,r)=>({x:0,y:0});
  let pxToHex = (x,y)=>({q:0,r:0});
  let getTileHeight = (q,r)=>0;
  let registerLosProvider = null;
  let onMapTransform = null;
  let publish = null, subscribe = null;

  // --- Utility ---
  const clamp = (v,min,max)=> Math.max(min, Math.min(max,v));
  function el(tag){ return document.createElementNS(svgNS, tag); }
  function ensureRoot(){
    if (ROOT && ROOT.isConnected) return ROOT;
    const svg = document.getElementById('svg');
    if (!svg) return null;
    ROOT = el('g');
    ROOT.id = 'world-structures';
    // put above textures but below labels/tokens
    const over = document.getElementById('world-overlays');
    if (over && over.parentNode) over.parentNode.insertBefore(ROOT, over);
    else svg.appendChild(ROOT);
    return ROOT;
  }

  function saveLocalIfBound(){
    if (!SAVING_ENABLED || !LOCAL_KEY_FN) return;
    try { localStorage.setItem(LOCAL_KEY_FN(), JSON.stringify(API.serialize())); } catch {}
  }
  function loadLocalIfBound(){
    if (!LOCAL_KEY_FN) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEY_FN());
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) API.hydrate(arr);
    }catch{}
  }
  function clearLocalIfBound(){
    if (!LOCAL_KEY_FN) return;
    try { localStorage.removeItem(LOCAL_KEY_FN()); } catch {}
  }

  // --- LOS height provider: return structure height on a cell if any ---
  function makeLosProvider(){
    // map tile -> max height contributed by structures that cover it
    const tileMax = new Map(); // key "q,r" -> h
    function k(q,r){ return `${q},${r}`; }
    function setMax(q,r,h){
      const kk = k(q,r); const cur = tileMax.get(kk) || 0;
      if (h > cur) tileMax.set(kk, h);
    }
    function recompute(){
      tileMax.clear();
      for (const inst of PLACED){
        const def = BY_ID.get(inst.defId); if (!def) continue;
        const hmode = def.heightMode || 'fixed';
        if (!Array.isArray(def.footprint) || !def.footprint.length){
          // if no footprint, treat only anchor cell
          const h = hmode==='fixed' ? (+def.height||0)
                   : hmode==='tile' ? Math.max(+def.minHeight||0, 0)
                   : 0;
          setMax(inst.q, inst.r, h);
          continue;
        }
        // footprint dq/dr around (q,r)
        const cells = def.footprint.map((c, i) => ({
          q: inst.q + (c.dq||0),
          r: inst.r + (c.dr||0),
          h: (hmode==='fixed') ? (+def.height||0)
             : (hmode==='tile') ? Math.max(+def.minHeight||0, 0)
             : (hmode==='cells') ? (+def.cellHeights?.[i]||0)
             : 0
        }));
        for (const c of cells) setMax(c.q, c.r, c.h);
      }
    }
    recompute();

    return {
      get(q,r){ return tileMax.get(`${q},${r}`) || 0; },
      refresh(){ recompute(); }
    };
  }
  let LOS = null;

  // --- Rendering ---
  function clearRender(){
    const root = ensureRoot(); if (!root) return;
    root.replaceChildren();
  }
  function draw(){
    const root = ensureRoot(); if (!root) return;
    root.replaceChildren();
    for (const inst of PLACED) root.appendChild(drawInstance(inst));
  }
  function drawInstance(inst){
    const def = BY_ID.get(inst.defId);
    const g = el('g');
    g.setAttribute('class', 'structure');
    g.dataset.defId = inst.defId;
    g.dataset.id = inst.id;

    const {x,y} = hexToPx(inst.q, inst.r);
    const scale = 1 * (inst.scale || 1);
    g.setAttribute('transform', `translate(${x},${y}) rotate(${inst.angle||0})`);
    g.style.pointerEvents = 'auto';

    const shapes = Array.isArray(def?.shapes) ? def.shapes : [];
    shapes.forEach(s => g.appendChild(drawShape(s)));

    // simple hit ring to make selection easy
    const hit = el('circle');
    hit.setAttribute('r', 6);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('transform', `scale(${scale})`);
    g.appendChild(hit);

    return g;
  }

  function drawShape(s){
    const kind = s.kind || 'rect';
    const fill   = s.fill   ?? '#20262c';
    const stroke = s.stroke ?? '#9aa4ae';
    const sw     = s.sw != null ? +s.sw : 0.02;

    if (kind === 'rect'){
      const w = +s.w || 1, h = +s.h || 1;
      const n = el('rect');
      n.setAttribute('x', (-w/2).toFixed(4));
      n.setAttribute('y', (-h/2).toFixed(4));
      n.setAttribute('width',  w.toFixed(4));
      n.setAttribute('height', h.toFixed(4));
      if (s.rx != null) n.setAttribute('rx', +s.rx);
      n.setAttribute('fill', fill);
      n.setAttribute('stroke', stroke);
      n.setAttribute('stroke-width', sw);
      n.setAttribute('vector-effect', 'non-scaling-stroke'); // ← add this
      return n;
    } else if (kind === 'polygon'){
      const pts = Array.isArray(s.points) ? s.points : [];
      const n = el('polygon');
      n.setAttribute('points', pts.map(p => p.join(',')).join(' '));
      n.setAttribute('fill', fill);
      n.setAttribute('stroke', stroke);
      n.setAttribute('stroke-width', sw);
      n.setAttribute('vector-effect', 'non-scaling-stroke'); // ← add this
      return n;
    } else { // path
      const n = el('path');
      n.setAttribute('d', s.d || '');
      n.setAttribute('fill', fill);
      n.setAttribute('stroke', stroke);
      n.setAttribute('stroke-width', sw);
      n.setAttribute('vector-effect', 'non-scaling-stroke'); // ← add this
      return n;
    }
  }

  // --- UI ---
  let UI = null;
  let placeMode = false;
  let eraseMode = false;
  let selectedId = null;

  function mountUI(selector){
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return;

    host.innerHTML = `
      <div class="struct-ui">
        <div class="row gap">
          <select id="structCatalog" class="input" title="Catalog"></select>
          <button id="structTogglePlace" class="btn">Place</button>
          <button id="structToggleErase" class="btn ghost" title="Delete structures">Erase</button>
        </div>
        <div class="mini muted" style="margin-top:6px;">Click a hex to place while Place is ON. Click a structure while Erase is ON to remove.</div>
        <div class="struct-preview card" style="margin-top:8px; padding:8px; border:1px solid #2a2d33; border-radius:10px;">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <strong>Preview</strong>
            <div class="row" style="gap:6px; align-items:center;">
              <label class="small">Fill <input id="structFill" type="color" value="#20262c" style="width:28px;height:20px;border:none;background:transparent;"/></label>
              <label class="small">Stroke <input id="structStroke" type="color" value="#9aa4ae" style="width:28px;height:20px;border:none;background:transparent;"/></label>
              <label class="small">SW <input id="structSW" type="number" step="0.01" value="0.02" style="width:70px"/></label>
            </div>
          </div>
          <svg id="structPreviewSvg" viewBox="-1.5 -1.5 3 3" style="width:100%;height:120px;display:block;background:#0c0f14;border-radius:8px"></svg>
        </div>
      </div>
    `;
    UI = {
      host,
      sel: host.querySelector('#structCatalog'),
      btnPlace: host.querySelector('#structTogglePlace'),
      btnErase: host.querySelector('#structToggleErase'),
      fill: host.querySelector('#structFill'),
      stroke: host.querySelector('#structStroke'),
      sw: host.querySelector('#structSW'),
      pv: host.querySelector('#structPreviewSvg')
    };

    rebuildCatalogSelect();
    UI.sel.addEventListener('change', updatePreviewFromCurrentDef);
    UI.fill.addEventListener('input', applyPreviewOverrides);
    UI.stroke.addEventListener('input', applyPreviewOverrides);
    UI.sw.addEventListener('input', applyPreviewOverrides);

    UI.btnPlace.addEventListener('click', () => {
      placeMode = !placeMode;
      eraseMode = false;
      UI.btnPlace.classList.toggle('active', placeMode);
      UI.btnErase.classList.remove('active');
      UI.btnPlace.textContent = placeMode ? 'Place (ON)' : 'Place';
      setCursor();
    });
    UI.btnErase.addEventListener('click', () => {
      eraseMode = !eraseMode;
      placeMode = false;
      UI.btnErase.classList.toggle('active', eraseMode);
      UI.btnPlace.classList.remove('active');
      UI.btnPlace.textContent = 'Place';
      setCursor();
    });

    // hook stage events for placing/removing
    const svg = document.getElementById('svg');
    svg.addEventListener('click', (e) => {
      const targetStruct = e.target.closest && e.target.closest('#world-structures > g.structure');
      if (eraseMode && targetStruct){
        const id = targetStruct.dataset.id;
        PLACED = PLACED.filter(p => p.id !== id);
        draw(); LOS?.refresh?.(); pulse();

        return;
      }
      if (!placeMode) return;
      const pt = toSvgPoint(svg, e.clientX, e.clientY);
      const cell = pxToHex(pt.x, pt.y);
      const defId = UI.sel.value;
      if (!defId) return;
      place(defId, cell.q, cell.r);
    });

    updatePreviewFromCurrentDef();

    // cursor nicety
    function setCursor(){ svg.style.cursor = placeMode ? 'crosshair' : (eraseMode ? 'not-allowed' : 'default'); }
    API._setCursor = setCursor; // for refresh after mount
  }

  function toSvgPoint(svg, cx, cy){
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function rebuildCatalogSelect(){
    if (!UI || !UI.sel) return;
    UI.sel.replaceChildren();
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '— choose structure —';
    UI.sel.appendChild(opt0);
    CATALOG.forEach(def => {
      const o = document.createElement('option');
      o.value = def.id; o.textContent = def.name || def.id;
      UI.sel.appendChild(o);
    });
  }

  function applyPreviewOverrides(){
    const def = BY_ID.get(UI.sel.value); if (!def) return;
    const fill = UI.fill.value;
    const stroke = UI.stroke.value;
    const sw = parseFloat(UI.sw.value)||0.02;
    preview(def, {fill, stroke, sw});
  }

  function updatePreviewFromCurrentDef(){
    const def = BY_ID.get(UI?.sel?.value || '');
    if (!def) { if (UI?.pv) UI.pv.replaceChildren(); return; }
    // set preview pickers using first shape (fallbacks included)
    const s0 = (def.shapes||[])[0] || {};
    if (UI.fill) UI.fill.value   = s0.fill   || '#20262c';
    if (UI.stroke) UI.stroke.value = s0.stroke || '#9aa4ae';
    if (UI.sw) UI.sw.value = (s0.sw!=null ? s0.sw : 0.02);
    preview(def);
  }

  function pulse(){
  // local autosave
  saveLocalIfBound();
  // live publish (optional; harmless if not provided)
  if (typeof publish === 'function'){
    publish('structures:changed', API.serialize());
  }
}

  function preview(def, override){ // override = {fill,stroke,sw}
    if (!UI || !UI.pv) return;
    const pv = UI.pv;
    pv.replaceChildren();

    const g = el('g');
    g.setAttribute('transform','scale(1)');
    pv.appendChild(g);

    (def.shapes||[]).forEach(s => {
      const dup = Object.assign({}, s);
      if (override){
        if (dup.kind === 'polygon' || dup.kind === 'rect' || dup.kind === 'path'){
          dup.fill = override.fill;
          dup.stroke = override.stroke;
          dup.sw = override.sw;
        }
      }
      g.appendChild(drawShape(dup));
    });
  }

  // --- Placement / model ---
  function newId(){ return 'st_' + Math.random().toString(36).slice(2,9); }
  function place(defId, q, r){
    const inst = { id: newId(), defId, q: clamp(q,0,1e6), r: clamp(r,0,1e6), angle: 0, scale: 1 };
    PLACED.push(inst);
    draw(); LOS?.refresh?.(); pulse();

  }

  // --- Public API ---
  API.init = function(opts){
    hexToPx = opts.hexToPx || hexToPx;
    pxToHex = opts.pxToHex || pxToHex;
    getTileHeight = opts.getTileHeight || getTileHeight;
    registerLosProvider = opts.registerLosProvider || null;
    onMapTransform = opts.onMapTransform || null;
    publish = opts.publish || null;
    subscribe = opts.subscribe || null;

    ensureRoot();
    if (onMapTransform) onMapTransform(() => { /* vector; no reraster step needed */ });

    // provide LOS height
    LOS = makeLosProvider();
    if (registerLosProvider && typeof registerLosProvider === 'function'){
      registerLosProvider((q,r) => LOS.get(q,r));
    }
  };

API.onMapChanged = function(){
  // If a new map id is in effect, the caller will also update LOCAL_KEY_FN via bindLocalStorage or reuse the same function.
  if (!LOCAL_KEY_FN) return;
  try{
    const raw = localStorage.getItem(LOCAL_KEY_FN());
    const arr = raw ? JSON.parse(raw) : [];
    API.hydrate(Array.isArray(arr) ? arr : []);
  }catch{
    API.hydrate([]);
  }
};
  
  API.loadCatalog = async function(url){
    try{
      const res = await fetch(url, { cache:'no-store' });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      CATALOG = arr;
      BY_ID.clear(); arr.forEach(d => BY_ID.set(d.id, d));
      rebuildCatalogSelect();
      updatePreviewFromCurrentDef();
      draw(); LOS?.refresh?.();
    }catch(e){
      console.warn('[structures] catalog load failed', e);
    }
  };

  API.mountUI = mountUI;

  API.serialize = function(){
    // Nothing fancy: just persist placed instances
    return PLACED.map(p => ({ id:p.id, defId:p.defId, q:p.q, r:p.r, angle:p.angle||0, scale:p.scale||1 }));
  };

  API.hydrate = function(arr){
    PLACED = Array.isArray(arr) ? arr.map(x => ({
      id: x.id || newId(),
      defId: x.defId,
      q: +x.q||0, r:+x.r||0,
      angle: ((+x.angle||0)%360+360)%360,
      scale: clamp(+x.scale||1, 0.25, 4)
    })) : [];
    draw(); LOS?.refresh?.();
    saveLocalIfBound();
  };

  API.clear = function(){
    PLACED.length = 0;
    draw(); LOS?.refresh?.();
    clearLocalIfBound();
  };

  API.bindLocalStorage = function(getKeyFn){
    LOCAL_KEY_FN = getKeyFn;
    SAVING_ENABLED = true;
    // load once now
    loadLocalIfBound();
  };

  // expose for app
  window.MSS_Structures = API;
})();
