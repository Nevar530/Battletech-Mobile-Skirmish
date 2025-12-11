/* ===== Hex Map Maker – Script with LOS/Measure toggles + Select + PaintFixed ===== */  
 
/* ---------- Constants & Config ---------- */
const COVER_DARKEN = { None: 0, Light: -5, Medium: -10, Heavy: -15 };
const SHEETS_BASE = 'https://sheets.flechs.net/';
const svgNS = 'http://www.w3.org/2000/svg';

// ~1" token on a 1.25" board hex → 1 / 1.25 = 0.8
const TOKEN_BASE_SCALE = 0.80;

// --- Interop for Sheet.migrate() ---
// Clears all crit-slot occupancy so packAllEquipment can repack cleanly
window.clearAllOccupancy = function(d){
  if (!d || !d.crits) return;
  for (const L of Object.keys(d.crits)) {
    const slots = d.crits[L] || [];
    for (let i = 0; i < slots.length; i++) {
      slots[i].occ    = false;
      slots[i].label  = '';
      slots[i].itemId = null;
      slots[i].hit    = false;
    }
  }
};

// ===== LOS physics (supports negative ground) =====
const EYE_Z = 0.9;                 // eye height above ground (tile height units)
const COVER_BLOCK_HEIGHT = [0, 0.4, 0.9, 1.4]; // None, Light, Med, Heavy -> extra blocking height
const LOS_EPS = 1e-4;

function getHexHeight(q, r) {
const t = tiles.get(key(q, r));
const h = (t && Number.isFinite(t.height)) ? t.height : 0;
    let base = Number.isFinite(h) ? h : 0;

  // Structure override: take the maximum between ground and any structure height here.
  // (Negative heights work too, e.g., trenches.)
  const sHere = structures.filter(s => s.q === q && s.r === r);
  if (sHere.length) {
    // If multiple overlap, use the max (tallest wins)
    const maxStruct = Math.max(...sHere.map(s => Number(s.height) || 0));
    base = (Number.isFinite(maxStruct)) ? Math.max(base, maxStruct) : base;
  }

  return base;

}

const TEAMS = [
  { name:'Red',    color:'#ff4757' },
  { name:'Blue',   color:'#3a86ff' },
  { name:'Green',  color:'#2ed573' },
  { name:'Yellow', color:'#ffd93d' },
  { name:'Purple', color:'#b86bff' },
  { name:'White',  color:'#e8eef6' },
  { name:'Black',  color:'#111418' },
];

const TERRAINS = [
  { name: 'Grass',    fill: '#3fa34d', pat: 'pat-grass',    opacity: 0.25 },
  { name: 'Rock',     fill: '#a3aab5', pat: 'pat-rock',     opacity: 0.25 },
  { name: 'Water',    fill: '#4c84d6', pat: 'pat-water',    opacity: 0.25 },
  { name: 'Sand',     fill: '#d7b37d', pat: 'pat-sand',     opacity: 0.22 },
  { name: 'Asphalt',  fill: '#5A5C5E', pat: 'pat-asphalt',  opacity: 0.22 },
  { name: 'Urban',    fill: '#5b687d', pat: 'pat-urban',    opacity: 0.22 },
  { name: 'Snow',     fill: '#d8e6e5', pat: 'pat-snow',     opacity: 0.22 },
  { name: 'Ice',      fill: '#b7e1f2', pat: 'pat-ice',      opacity: 0.22 },
  { name: 'Lava',     fill: '#a83232', pat: 'pat-lava',     opacity: 0.35 },
  { name: 'Volcanic', fill: '#4A2C2A', pat: 'pat-volcanic', opacity: 0.25 },
  { name: 'Moon',     fill: '#c5c5c5', pat: 'pat-moon',     opacity: 0.20 },
  { name: 'Hologram', fill: '#00ff80', pat: 'pat-holo',     opacity: 0.35 }
];

// ===== Fill Terrain dropdown =====
const elFillTerrain = document.getElementById('fillTerrain');
if (elFillTerrain) {
  TERRAINS.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.name;
    elFillTerrain.appendChild(opt);
  });
}
function fillMapWithTerrain(terrainIndex) {
  if (mapLocked) { alert('Map is locked. Unlock to edit terrain.'); return; }
  if (terrainIndex == null || isNaN(terrainIndex)) return;
  beginStroke();
  tiles.forEach(tile => {
    const prev = { h: tile.height, ter: tile.terrainIndex, cov: tile.coverIndex };
    tile.terrainIndex = terrainIndex;
    const next = { h: tile.height, ter: tile.terrainIndex, cov: tile.coverIndex };
    recordEdit(tile.q, tile.r, prev, next);
  });
  endStroke();
}
const btnFillTerrain = document.getElementById('btnFillTerrain');
if (btnFillTerrain) {
  btnFillTerrain.addEventListener('click', () => {
    const idx = +elFillTerrain.value;
    if (isNaN(idx)) { elFillTerrain.focus(); return; }
    fillMapWithTerrain(idx);
    elFillTerrain.value = '';
  });
}
if (elFillTerrain) {
  elFillTerrain.addEventListener('change', () => {
    const idx = +elFillTerrain.value;
    if (!isNaN(idx)) {
      fillMapWithTerrain(idx);
      elFillTerrain.value = '';
    }
  });
}

const COVERS = ['None','Light','Medium','Heavy'];
const COVER_ABBR = { None:'', Light:'| L1', Medium:'| M2', Heavy:'| H3' };

/* ---------- DOM ---------- */
const svg = document.getElementById('svg');
const defs = document.getElementById('tex-defs');
const frameBorder = document.getElementById('frameBorder');
const gShadows = document.getElementById('world-shadows');
const gPolys   = document.getElementById('world-polys');
const gTex     = document.getElementById('world-textures');
const gOver    = document.getElementById('world-overlays');
const gTokens  = document.getElementById('world-tokens');
const gStructs = document.getElementById('world-structures');
const gLabels  = document.getElementById('world-labels');
const gMeasure = document.getElementById('measure-group');
const gLosRays = document.getElementById('los-rays');
const gLos     = document.getElementById('los-group');
const io = document.getElementById('io');

/* Sidebar inputs */
const elCols = document.getElementById('cols');
const elRows = document.getElementById('rows');
const elHex  = document.getElementById('hexSize');
const elLegend = document.getElementById('legendRadio');
const elPresets = document.getElementById('presets');

/* Drawers */
const leftPanel  = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const toggleLeft = document.getElementById('toggleLeft');
const toggleRight= document.getElementById('toggleRight');
const closeLeft  = document.getElementById('closeLeft');
const closeRight = document.getElementById('closeRight');

/* Top bar toggles + help (support both legacy & new IDs) */
const btnLOS = document.getElementById('btnLOS') || document.getElementById('btnToggleLOS');
const btnMeasure = document.getElementById('btnMeasure') || document.getElementById('btnToggleMeasure');
const btnHelp = document.getElementById('btnHelp');
const helpPopup = document.getElementById('helpPopup');
const closeHelp = document.getElementById('closeHelp');

/* Left quick tools (mutually exclusive) */
const btnSelect    = document.getElementById('btnSelect');
const btnHeight    = document.getElementById('btnHeight');
const btnTerrain   = document.getElementById('btnTerrain');
const btnCover     = document.getElementById('btnCover');
const btnClearTile = document.getElementById('btnClearTile');

/* Fixed Paint tool UI */
const selPaintTerrain = document.getElementById('selPaintTerrain');
const selPaintHeight  = document.getElementById('selPaintHeight');
const selPaintCover   = document.getElementById('selPaintCover');
const btnPaintFixed   = document.getElementById('btnPaintFixed');
const btnClearFixed   = document.getElementById('btnClearFixed');

/* Docks */
const dockA = document.getElementById('dockA');
const dockB = document.getElementById('dockB');
const frameA = document.getElementById('frameA');
const frameB = document.getElementById('frameB');

/* ===== Docks: wire up UI buttons + graceful fallback ===== */
const btnDockL = document.getElementById('btnDockL');
const btnDockR = document.getElementById('btnDockR');
btnDockL && btnDockL.addEventListener('click', toggleDockA);
btnDockR && btnDockR.addEventListener('click', toggleDockB);

// Header controls for left dock
on('homeA', 'click', () => {
  if (!dockA.classList.contains('show')) dockA.classList.add('show');
  if (frameA && frameA.src !== SHEETS_BASE) frameA.src = SHEETS_BASE;
  localStorage.setItem('hexmap_dockA_show', '1');
});
on('openA', 'click', () => window.open(SHEETS_BASE, '_blank', 'noopener,noreferrer'));
on('closeA', 'click', () => {
  dockA.classList.remove('show');
  localStorage.setItem('hexmap_dockA_show', '0');
});

// Header controls for right dock
on('homeB', 'click', () => {
  if (!dockB.classList.contains('show')) dockB.classList.add('show');
  if (frameB && frameB.src !== SHEETS_BASE) frameB.src = SHEETS_BASE;
  localStorage.setItem('hexmap_dockB_show', '1');
});
on('openB', 'click', () => window.open(SHEETS_BASE, '_blank', 'noopener,noreferrer'));
on('closeB', 'click', () => {
  dockB.classList.remove('show');
  localStorage.setItem('hexmap_dockB_show', '0');
});

// If a browser blocks embedding, the iframe will stay blank.
function tryLoadSheetsOnce(frameEl){
  if (!frameEl || frameEl.src) return; // only try once when src is empty
  try { frameEl.src = SHEETS_BASE; } catch {}
}

// Make sure we actually attempt to load when docks get shown
const _toggleDockA = toggleDockA;
const _toggleDockB = toggleDockB;
window.toggleDockA = function(){
  _toggleDockA();
  if (dockA.classList.contains('show')) tryLoadSheetsOnce(frameA);
};
window.toggleDockB = function(){
  _toggleDockB();
  if (dockB.classList.contains('show')) tryLoadSheetsOnce(frameB);
};

/* Optional hamburger */
const menuBtn   = document.getElementById('menuBtn');
const menuPopup = document.getElementById('menuPopup');

/* Dice */
const diceOut = document.getElementById('diceOut');

/* Right drawer: Mech UI */
const mechName   = document.getElementById('mechName');
const pilotName  = document.getElementById('pilotName');
const teamSelect = document.getElementById('teamSelect');
const btnAddMech = document.getElementById('btnAddMech');
const mechList   = document.getElementById('mechList');

const initList   = document.getElementById('initList');
const btnRollInitAll = document.getElementById('btnRollInitAll');
const btnClearInit   = document.getElementById('btnClearInit');
const btnNextTurn    = document.getElementById('btnNextTurn');

const btnExportMechs = document.getElementById('btnExportMechs');
const btnImportMechs = document.getElementById('btnImportMechs');
const importFile     = document.getElementById('importFile');

/* ---------- State ---------- */
let cols = +elCols.value;
let rows = +elRows.value;
let hexSize = +elHex.value;

let tiles = new Map(); // key-> {q,r,height,terrainIndex,coverIndex}
const key = (q,r)=>`${q},${r}`;

const CURRENT_MAP_ID = 'local'; // used for per-map save slots in MSS:84 Sheet

let tokens = []; // {id,q,r,scale,angle,colorIndex,label}
let selectedTokenId = null;
let tokenDragId = null;
/* Structures (static objects above terrain, below tokens) */
let structures = [];   // { id, q, r, angle, scale, height, type, name, fill? }
let selectedStructureId = null;
let structureDragId = null;


/* Mech metadata (right panel) */
const mechMeta = new Map(); // id -> {name, pilot, team}

/* Initiative state */
let initOrder = []; // [{id, roll}]
let initIndex = -1;

/* Range / LOS / Measure */
let measurement = null; // {from:{q,r}, to:{q,r}, dist}
let losActive = false;
let losSource = null;
let measureMode = false;      // top-bar toggle
let measureAnchor = null;     // first click in measure mode

/* Paint tool mode (mutually exclusive buttons) */
let toolMode = 'select'; // 'select' | 'height' | 'terrain' | 'cover' | 'clear' | 'paintFixed'

/* Fixed Paint state */
let fixedPaint = { terrainIndex:0, height:0, coverIndex:0 };

/* Undo / Redo (tile edits) */
const UNDO_LIMIT = 50;
const undoStack = [];
const redoStack = [];
let currentStroke = null;

/* Map Lock */
let mapLocked = localStorage.getItem('hexmap_map_locked') === '1';

/* ---------- Helpers ---------- */
const clamp = (v,min,max)=> Math.max(min, Math.min(max,v));
function on(id, ev, fn){ const el = typeof id==='string' ? document.getElementById(id) : id; if (el) el.addEventListener(ev, fn); return el; }
function toSvgPoint(clientX, clientY){ const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }

/* ---------- Geometry ---------- */
// odd-q, pointy-top axial
function offsetToPixel(q, r, size) {
  const h = Math.sqrt(3) * size;
  const x = q * (size * 1.5);
  const y = r * h + (q % 2 ? h / 2 : 0);
  return { x, y, w: size * 2, h };
}
function hexPointsArray(cx, cy, size) {
  const arr = [];
  for (let i=0;i<6;i++){
    const ang = Math.PI/180 * (60*i);
    arr.push([cx + size*Math.cos(ang), cy + size*Math.sin(ang)]);
  }
  return arr;
}
function ptsToString(pts){ return pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '); }
function pixelToCell(px, py) {
  const h = Math.sqrt(3) * hexSize;
  const q = Math.round(px / (hexSize * 1.5));
  const yAdj = py - (q % 2 ? h/2 : 0);
  const r = Math.round(yAdj / h);
  return { q: clamp(q,0,cols-1), r: clamp(r,0,rows-1) };
}

/* ---------- Colors ---------- */
function hexToHsl(hex) { hex = hex.replace('#',''); const n = parseInt(hex, 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const rp = r/255, gp = g/255, bp = b/255; const max = Math.max(rp,gp,bp), min = Math.min(rp,gp,bp); let h=0, s=0, l=(max+min)/2; if (max !== min) { const d = max-min; s = l > 0.5 ? d/(2-max-min) : d/(max+min); switch(max){ case rp: h = (gp-bp)/d + (gp<bp?6:0); break; case gp: h = (bp-rp)/d + 2; break; case bp: h = (rp-gp)/d + 4; break; } h /= 6; } return { h: h*360, s: s*100, l: l*100 }; }
function hslToHex(h,s,l) { h/=360; s/=100; l/=100; function f(n){ const k = (n + h*12) % 12; const a = s * Math.min(l,1-l); const c = l - a * Math.max(-1, Math.min(k-3, Math.min(9-k,1))); return Math.round(255*c); } return "#" + [f(0),f(8),f(4)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function adjustLightness(hex, deltaPct) { let {h,s,l} = hexToHsl(hex); l = Math.max(0, Math.min(100, l + deltaPct)); return hslToHex(h,s,l); }

/* ---------- Autosave and Send ---------- */
function serializeState(){
  const meta = { cols, rows, hexSize };

  const data = [...tiles.values()].map(t => ({
    q: t.q, r: t.r,
    h: t.height,
    ter: t.terrainIndex,
    cov: t.coverIndex
  }));

  const tok = tokens.map(t => ({
    id: t.id, q: t.q, r: t.r,
    scale: t.scale,
    angle: t.angle,
    colorIndex: t.colorIndex,
    label: t.label
  }));

  const metaMap = {};
  mechMeta.forEach((v, k) => { metaMap[k] = v; });

  // include initiative (flat fields for compatibility)
  const safeInitOrder = Array.isArray(initOrder)
    ? initOrder.map(o => ({ id: o.id, roll: o.roll }))
    : [];
  const safeInitIndex = Number.isFinite(initIndex) ? initIndex : -1;

  return JSON.stringify({
    meta,
    data,
    tokens: tok,
        structures: structures.map(s => ({
      id: s.id, q: s.q, r: s.r,
      angle: s.angle || 0,
      scale: clamp(s.scale ?? 1, 0.2, 3),
      height: Number.isFinite(s.height) ? s.height : 0,
      type: s.type || '',
      name: s.name || '',
      fill: s.fill || '',
      shapes: Array.isArray(s.shapes) ? s.shapes : []
    })),
    mechMeta: metaMap,
    initOrder: safeInitOrder,
    initIndex: safeInitIndex
  });
}

// Gather unsent per-token sheets (marked by sheet.js) for this map, then clear flags
function collectDirtySheetsForTransmit(mapId = CURRENT_MAP_ID || 'local'){
  const dirtyKey = `mss84:sheets:dirty:${mapId}`;
  let dirty = {};
  try { dirty = JSON.parse(localStorage.getItem(dirtyKey) || '{}'); } catch {}
  const ids = Object.keys(dirty);
  if (!ids.length) return {};
  const out = {};
  for (const tid of ids){
    try{
      const raw = localStorage.getItem(`mss84:sheet:${mapId}:${tid}`);
      if (raw) out[tid] = JSON.parse(raw);
    }catch{}
  }
  try { localStorage.removeItem(dirtyKey); } catch {}
  return out;
}
function saveLocal(){
  try { localStorage.setItem('hexmap_autosave', serializeState()); } catch {}
}

function loadLocal(){
  try {
    const raw = localStorage.getItem('hexmap_autosave');
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || (!obj.data && !obj.tokens)) return false;
    applyState(obj);
    return true;
  } catch { return false; }
}

/* ---------- Patterns ---------- */
function ensurePatterns() {
  let pats = document.getElementById('tex-pats');
  if (!pats) { pats = document.createElementNS(svgNS,'g'); pats.setAttribute('id','tex-pats'); defs.appendChild(pats); }
  pats.replaceChildren();

  const u = Math.max(8, Math.round(hexSize * 0.4));
  const sw = Math.max(0.8, hexSize * 0.05);
  const sw2 = Math.max(0.6, hexSize * 0.035);
  function pat(id, w, h, builder){
    const p = document.createElementNS(svgNS, 'pattern');
    p.setAttribute('id', id);
    p.setAttribute('patternUnits', 'userSpaceOnUse');
    p.setAttribute('width', w);
    p.setAttribute('height', h);
    builder(p);
    pats.appendChild(p);
  }
  const ink = '#00000033';
  const inkBold = '#00000055';

  pat('pat-grass', u, u, (p)=>{
    const g1 = document.createElementNS(svgNS,'path');
    g1.setAttribute('d', `M0 ${u*0.8} L ${u*0.8} 0`);
    g1.setAttribute('stroke', ink); g1.setAttribute('stroke-width', sw2); g1.setAttribute('fill','none');
    const g2 = document.createElementNS(svgNS,'path');
    g2.setAttribute('d', `M${u*0.2} ${u} L ${u} ${u*0.2}`);
    g2.setAttribute('stroke', ink); g2.setAttribute('stroke-width', sw2); g2.setAttribute('fill','none');
    p.append(g1,g2);
  });

  pat('pat-rock', u, u, (p)=>{
    const a = document.createElementNS(svgNS,'path');
    a.setAttribute('d', `M0 0 L ${u} ${u}`);
    a.setAttribute('stroke', inkBold); a.setAttribute('stroke-width', sw); a.setAttribute('fill','none');
    const b = document.createElementNS(svgNS,'path');
    b.setAttribute('d', `M${u} 0 L 0 ${u}`);
    b.setAttribute('stroke', ink); b.setAttribute('stroke-width', sw2); b.setAttribute('fill','none');
    p.append(a,b);
  });

  pat('pat-water', u, u*0.6, (p)=>{
    const y = (u*0.6)/2;
    const path = document.createElementNS(svgNS,'path');
    path.setAttribute('d', `M0 ${y} C ${u*0.25} ${y-0.35*u}, ${u*0.75} ${y+0.35*u}, ${u} ${y}`);
    path.setAttribute('stroke', inkBold); path.setAttribute('stroke-width', sw2); path.setAttribute('fill','none');
    p.append(path);
  });

  pat('pat-sand', u, u, (p)=>{
    const mk = (cx,cy,r,op) => {
      const c = document.createElementNS(svgNS,'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', Math.max(0.7, r));
      c.setAttribute('fill', '#00000028'); c.setAttribute('opacity', op);
      return c;
    };
    p.append(mk(u*0.2,u*0.3, sw2*0.45, 1),
             mk(u*0.6,u*0.2, sw2*0.45, .9),
             mk(u*0.8,u*0.7, sw2*0.5, .7),
             mk(u*0.35,u*0.8, sw2*0.4, .8));
  });

  pat('pat-asphalt', u, u, (p) => {
    const mk = (cx,cy,op) => {
      const c = document.createElementNS(svgNS,'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', Math.max(0.5, u*0.05));
      c.setAttribute('fill', '#00000033'); c.setAttribute('opacity', op);
      return c;
    };
    p.append(
      mk(u*0.25,u*0.30, .6),
      mk(u*0.65,u*0.20, .5),
      mk(u*0.75,u*0.70, .45),
      mk(u*0.35,u*0.75, .55)
    );
    const dash = document.createElementNS(svgNS,'path');
    dash.setAttribute('d', `M ${-u*0.1} ${u*1.1} L ${u*1.1} ${-u*0.1}`);
    dash.setAttribute('stroke', '#ffd24a66');
    dash.setAttribute('stroke-width', Math.max(1, u*0.06));
    dash.setAttribute('stroke-dasharray', `${(u*0.25).toFixed(2)}, ${(u*0.18).toFixed(2)}`);
    dash.setAttribute('fill','none');
    p.append(dash);
  });

  pat('pat-urban', u, u, (p) => {
    const g1 = document.createElementNS(svgNS,'path');
    g1.setAttribute('d', `M 0 ${u*0.5} H ${u} M ${u*0.5} 0 V ${u}`);
    g1.setAttribute('stroke', '#0000003a');
    g1.setAttribute('stroke-width', Math.max(1, u*0.05));
    g1.setAttribute('fill','none');

    const g2 = document.createElementNS(svgNS,'path');
    g2.setAttribute('d', `M 0 ${u*0.25} H ${u} M ${u*0.25} 0 V ${u}`);
    g2.setAttribute('stroke', '#00000022');
    g2.setAttribute('stroke-width', Math.max(1, u*0.035));
    g2.setAttribute('fill','none');

    p.append(g1, g2);
  });

  pat('pat-snow', u, u, (p) => {
    const a = document.createElementNS(svgNS,'path');
    a.setAttribute('d', `M0 ${u} L ${u} 0`);
    a.setAttribute('stroke', '#bfc9d6');
    a.setAttribute('stroke-width', sw2);
    a.setAttribute('opacity', 0.4);
    a.setAttribute('fill','none');

    const b = document.createElementNS(svgNS,'path');
    b.setAttribute('d', `M0 0 L ${u} ${u}`);
    b.setAttribute('stroke', '#d4dbe6');
    b.setAttribute('stroke-width', sw2);
    b.setAttribute('opacity', 0.3);
    b.setAttribute('fill','none');

    p.append(a,b);
  });

  pat('pat-lava', u, u, (p) => {
    const crack = document.createElementNS(svgNS,'path');
    crack.setAttribute('d', `M0 ${u*0.6} Q ${u*0.3} ${u*0.3}, ${u*0.6} ${u*0.7} T ${u} ${u*0.4}`);
    crack.setAttribute('stroke', '#ff4500');
    crack.setAttribute('stroke-width', sw2*1.4);
    crack.setAttribute('opacity', 0.9);
    crack.setAttribute('fill','none');

    const glow = document.createElementNS(svgNS,'path');
    glow.setAttribute('d', `M0 ${u*0.8} Q ${u*0.4} ${u*0.5}, ${u*0.8} ${u*0.9}`);
    glow.setAttribute('stroke', '#ffd54a');
    glow.setAttribute('stroke-width', sw2);
    glow.setAttribute('opacity', 0.7);
    glow.setAttribute('fill','none');

    p.append(crack, glow);
  });

  pat('pat-moon', u, u, (p) => {
    function crater(cx, cy, r, op) {
      const c = document.createElementNS(svgNS,'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      c.setAttribute('fill', '#888'); c.setAttribute('opacity', op);
      return c;
    }
    p.append(
      crater(u*0.25, u*0.25, sw*0.6, 0.6),
      crater(u*0.7,  u*0.35, sw*0.8, 0.5),
      crater(u*0.5,  u*0.75, sw*0.7, 0.4)
    );
  });

  pat('pat-ice', u, u, (p) => {
    const crack1 = document.createElementNS(svgNS,'path');
    crack1.setAttribute('d', `M0 ${u*0.3} L ${u} ${u*0.1}`);
    crack1.setAttribute('stroke', '#7fcde8');
    crack1.setAttribute('stroke-width', sw2);
    crack1.setAttribute('opacity', 0.5);
    crack1.setAttribute('fill','none');

    const crack2 = document.createElementNS(svgNS,'path');
    crack2.setAttribute('d', `M${u*0.2} ${u} L ${u*0.8} 0`);
    crack2.setAttribute('stroke', '#a4dff2');
    crack2.setAttribute('stroke-width', sw2*0.9);
    crack2.setAttribute('opacity', 0.4);
    crack2.setAttribute('fill','none');

    p.append(crack1, crack2);
  });

  pat('pat-volcanic', u, u, (p) => {
    function fleck(cx, cy, r, color, op) {
      const c = document.createElementNS(svgNS,'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      c.setAttribute('fill', color); c.setAttribute('opacity', op);
      return c;
    }
    p.append(
      fleck(u*0.2, u*0.3, sw*0.5, '#555', 0.6),
      fleck(u*0.7, u*0.4, sw*0.4, '#777', 0.5),
      fleck(u*0.4, u*0.7, sw*0.6, '#333', 0.7),
      fleck(u*0.8, u*0.2, sw*0.5, '#c33', 0.7)
    );
  });

pat('pat-holo', u, u, (p) => {
  // vertical scanline
  const vline = document.createElementNS(svgNS, 'rect');
  vline.setAttribute('x', 0);
  vline.setAttribute('y', 0);
  vline.setAttribute('width', u * 0.15);
  vline.setAttribute('height', u);
  vline.setAttribute('fill', '#00ff80');
  vline.setAttribute('opacity', 0.15);

  // diagonal glow line
  const diag = document.createElementNS(svgNS, 'path');
  diag.setAttribute('d', `M0,${u} L${u},0`);
  diag.setAttribute('stroke', '#00ff80');
  diag.setAttribute('stroke-width', u * 0.05);
  diag.setAttribute('opacity', 0.25);

  p.append(vline, diag);
});

}

/* ===== Drop-shadow filters per height (H1..H5) ===== */
function ensureDropShadowFilters() {
  let bank = document.getElementById('hex-drop-bank');
  if (!bank) { bank = document.createElementNS(svgNS,'g'); bank.id = 'hex-drop-bank'; defs.appendChild(bank); }
  for (let h=1; h<=5; h++){
    let f = document.getElementById(`hexDropH${h}`);
    const base   = hexSize * 0.18;
    const extra  = Math.max(0,h) * hexSize*0.10;
    const dxdy   = (base + extra) * 0.90;
    const blur   = hexSize * (0.09 + 0.02*h);
    const alpha  = Math.min(0.70, 0.30 + 0.08*h);

    if (!f) {
      f = document.createElementNS(svgNS,'filter');
      f.setAttribute('id', `hexDropH${h}`);
      bank.appendChild(f);
    }
    f.setAttribute('x','-50%'); f.setAttribute('y','-50%');
    f.setAttribute('width','200%'); f.setAttribute('height','200%');

    f.replaceChildren();
    const ds = document.createElementNS(svgNS,'feDropShadow');
    ds.setAttribute('dx', dxdy.toFixed(2));
    ds.setAttribute('dy', dxdy.toFixed(2));
    ds.setAttribute('stdDeviation', blur.toFixed(2));
    ds.setAttribute('flood-color', '#000');
    ds.setAttribute('flood-opacity', alpha.toFixed(3));
    f.appendChild(ds);
  }
}

/* ---------- Camera (viewBox) ---------- */
const camera = {
  x: 0, y: 0, w: 100, h: 100, scale: 1, inited:false,
  setViewBox(){ svg.setAttribute('viewBox', `${this.x} ${this.y} ${this.w/this.scale} ${this.h/this.scale}`); },
  fitToContent(){
    const box = svg.getBBox(); const pad = 12;
    this.x = box.x - pad; this.y = box.y - pad;
    this.w = box.width + pad*2; this.h = box.height + pad*2;
    this.scale = 1; this.inited = true; this.setViewBox();
  },
  zoomAt(svgPoint, factor){
    const nx = svgPoint.x - (svgPoint.x - this.x) / factor;
    const ny = svgPoint.y - (svgPoint.y - this.y) / factor;
    this.x = nx; this.y = ny;
    this.scale = Math.max(0.2, Math.min(8, this.scale * factor));
    this.setViewBox();
  },
  pan(dx, dy){ this.x += dx; this.y += dy; this.setViewBox(); },
  reset(){ this.inited=false; this.fitToContent(); }
};

/* ===== Undo/Redo & Zoom buttons ===== */
on('btnUndo', 'click', () => { undo(); svg.focus(); });
on('btnRedo', 'click', () => { redo(); svg.focus(); });
function zoomAtViewportCenter(factor){
  const vb = svg.viewBox.baseVal;
  const cx = vb.x + vb.width  / 2;
  const cy = vb.y + vb.height / 2;
  camera.zoomAt({ x: cx, y: cy }, factor);
}
on('btnZoomIn',  'click', () => zoomAtViewportCenter(1/1.15));
on('btnZoomOut', 'click', () => zoomAtViewportCenter(1.15));

/* ---------- Drawer Toggles ---------- */
if (toggleLeft)  toggleLeft.addEventListener('click', () => leftPanel.classList.toggle('collapsed'));
if (closeLeft)   closeLeft.addEventListener('click', () => leftPanel.classList.add('collapsed'));
if (toggleRight) toggleRight.addEventListener('click', () => rightPanel.classList.toggle('collapsed'));
if (closeRight)  closeRight.addEventListener('click', () => rightPanel.classList.add('collapsed'));

/* ---------- Help popup ---------- */
if (helpPopup) helpPopup.hidden = true;
if (btnHelp) btnHelp.addEventListener('click', () => {
  if (!helpPopup) return;
  helpPopup.hidden = !helpPopup.hidden;
});
if (closeHelp) closeHelp.addEventListener('click', () => { if (helpPopup) helpPopup.hidden = true; });

/* ---------- Top-bar LOS / Measure toggles ---------- */
function setBtnToggleState(btn, on){
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) btn.classList.add('active'); else btn.classList.remove('active');
}

function updateHitMask() {
  const on = (losActive || measureMode);
  svg.classList.toggle('hitmask-map', on);
}

function _clearInlinePointerEventsOnce() {
  const sels = [
    '#world-structures', '#world-structures *',
    '#world-tokens',     '#world-tokens *',
    '#world-labels',     '#world-labels *'
  ];
  const nodes = svg.querySelectorAll(sels.join(','));
  for (const n of nodes) n.style.pointerEvents = '';
}

if (btnLOS) {
  btnLOS.addEventListener('click', () => {
    losActive = !losActive;
    setBtnToggleState(btnLOS, losActive);
    if (!losActive) clearLOS();
    updateHitMask();  // allow hex clicks when LoS active
  });
}
if (btnMeasure) {
  btnMeasure.addEventListener('click', () => {
    measureMode = !measureMode;
    setBtnToggleState(btnMeasure, measureMode);
    if (!measureMode) { measureAnchor = null; clearMeasurement(); }
        updateHitMask();  // let hex clicks pass through during Measure

  });
}
_clearInlinePointerEventsOnce();
updateHitMask();


/* ---------- Build & Render ---------- */
function initTiles() {
  tiles.clear();
  for (let r=0; r<rows; r++) for (let q=0; q<cols; q++)
    tiles.set(key(q,r), { q, r, height:0, terrainIndex:0, coverIndex:0 });
}

let renderQueued=false;
function requestRender(){
  if (renderQueued) return;
  renderQueued=true;
  requestAnimationFrame(()=>{ render(); renderQueued=false; });
}

function render() {
  ensurePatterns();

  // clear layers
  gShadows.replaceChildren();
  gPolys.replaceChildren();
  gTex.replaceChildren();
  gOver.replaceChildren();
  gLabels.replaceChildren();
  
  gStructs.replaceChildren();
// apply universal transparency to all structures
gStructs.setAttribute('opacity', '0.75');

  gTokens.replaceChildren();
gMeasure.replaceChildren();

const size = hexSize;
const geom = new Map();
let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;

// 1) Build geometry map first
tiles.forEach(t => {
  const {x,y} = offsetToPixel(t.q,t.r,size);
  const ptsStr = ptsToString(hexPointsArray(x,y,size));
  geom.set(key(t.q,t.r), {x,y,ptsStr});
  minX = Math.min(minX, x - size);
  minY = Math.min(minY, y - size);
  maxX = Math.max(maxX, x + size);
  maxY = Math.max(maxY, y + size);
});

// 2) Now draw structures (geom is ready)
const fontStruct = Math.max(10, hexSize * 0.18);
structures.forEach(s => {
  const ctr = geom.get(key(s.q, s.r));
  if (!ctr) return;

const g = document.createElementNS(svgNS, 'g');

// Combine base + conditional class into ONE assignment
g.setAttribute(
  'class',
  `structure${s.id === selectedStructureId ? ' selected' : ''}`
);

g.setAttribute(
  'transform',
  `translate(${ctr.x},${ctr.y}) rotate(${s.angle || 0}) scale(${(s.scale || 1) * hexSize})`
);
g.dataset.id = s.id;

// --- per-structure pattern defs (texture fills) ---
const structDefs = document.createElementNS(svgNS, 'defs');
g.appendChild(structDefs);

// cache so multiple shapes reusing same style don't duplicate patterns
const __patCache = new Map();

function __patKey(sh){
  const f   = sh.fill   || '#20262c';
  const st  = sh.stroke || '#9aa4ae';
  const sw  = Number(sh.sw) || 0.02;
  const t   = sh.texture || '';
  const sc  = Number.isFinite(+sh.texScale) ? +sh.texScale : 1;
  const ang = Number.isFinite(+sh.texAngle) ? +sh.texAngle : 0;
  return `${t}|${sc}|${ang}|${f}|${st}|${sw}`;
}

function __patternIdForShape(sh){
  if (!sh.texture) return '';
  const key = __patKey(sh);
  if (__patCache.has(key)) return __patCache.get(key);

  const id  = `pat_${s.id}_${__patCache.size}`;
  const pat = document.createElementNS(svgNS,'pattern');
  pat.setAttribute('id', id);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('patternContentUnits', 'userSpaceOnUse');

  // Base repeat size in "shape units": 0.1 * texScale (1.0 = fairly fine)
  const unit = Math.max(0.02, 0.1 * (Number.isFinite(+sh.texScale) ? +sh.texScale : 1));
  pat.setAttribute('width',  String(unit));
  pat.setAttribute('height', String(unit));

  const ang = Number.isFinite(+sh.texAngle) ? +sh.texAngle : 0;
  if (ang) pat.setAttribute('patternTransform', `rotate(${ang})`);

  const fillCol   = sh.fill   || '#20262c';
  const strokeCol = sh.stroke || '#9aa4ae';
  const strokeW   = Math.max(0.005, (Number(sh.sw) || 0.02) * 0.6);

  // background = shape fill color
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x','0'); bg.setAttribute('y','0');
  bg.setAttribute('width',  String(unit));
  bg.setAttribute('height', String(unit));
  bg.setAttribute('fill', fillCol);
  pat.appendChild(bg);

  // helpers
  function line(x1,y1,x2,y2){
    const l = document.createElementNS(svgNS,'line');
    l.setAttribute('x1',x1); l.setAttribute('y1',y1);
    l.setAttribute('x2',x2); l.setAttribute('y2',y2);
    l.setAttribute('stroke', strokeCol);
    l.setAttribute('stroke-width', String(strokeW));
    l.setAttribute('stroke-linecap', 'square');
    return l;
  }
  function circle(cx,cy,r){
    const c = document.createElementNS(svgNS,'circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r);
    c.setAttribute('fill','none');
    c.setAttribute('stroke', strokeCol);
    c.setAttribute('stroke-width', String(strokeW));
    return c;
  }
  function path(d){
    const p = document.createElementNS(svgNS,'path');
    p.setAttribute('d', d);
    p.setAttribute('fill','none');
    p.setAttribute('stroke', strokeCol);
    p.setAttribute('stroke-width', String(strokeW));
    p.setAttribute('stroke-linejoin','miter');
    return p;
  }

  // motifs
  switch (sh.texture){
    case 'line_horiz': pat.appendChild(line(0,0, unit,0)); break;
    case 'line_vert':  pat.appendChild(line(0,0, 0,unit)); break;
    case 'grid':
      pat.appendChild(line(0,0, unit,0));
      pat.appendChild(line(0,0, 0,unit));
      break;
    case 'dots': {
      const r = unit*0.12;
      const c = document.createElementNS(svgNS,'circle');
      c.setAttribute('cx', unit*0.5);
      c.setAttribute('cy', unit*0.5);
      c.setAttribute('r',  r);
      c.setAttribute('fill',   strokeCol);
      c.setAttribute('stroke', 'none');
      pat.appendChild(c);
    } break;
    case 'chevron': {
      const d = `M 0 ${unit*0.5} L ${unit*0.25} ${unit*0.25} L ${unit*0.5} ${unit*0.5} L ${unit*0.75} ${unit*0.25} L ${unit} ${unit*0.5}`;
      pat.appendChild(path(d));
    } break;
    case 'hexmesh': {
      const R = unit*0.45, cx = unit*0.5, cy = unit*0.5;
      const pts = [];
      for (let i=0;i<6;i++){
        const a = (Math.PI/180)*(60*i);
        pts.push([cx + R*Math.cos(a), cy + R*Math.sin(a)]);
      }
      const d = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(p=>`L ${p[0]} ${p[1]}`).join(' ') + ' Z';
      pat.appendChild(path(d));
    } break;
    case 'radial':
      pat.appendChild(circle(unit*0.5, unit*0.5, unit*0.18));
      pat.appendChild(circle(unit*0.5, unit*0.5, unit*0.36));
      break;
    case 'dome': {
      const cx = unit*0.5, cy = unit*0.5, R = unit*0.5, spokes = 8;
      for (let i=0;i<spokes;i++){
        const a = (Math.PI*2)*i/spokes;
        pat.appendChild(line(cx,cy, cx + R*Math.cos(a), cy + R*Math.sin(a)));
      }
    } break;
  }

  structDefs.appendChild(pat);
  __patCache.set(key, id);
  return id;
}

  
  // if s.shapes exists (from catalog)
if (Array.isArray(s.shapes)) {
  s.shapes.forEach(shape => {
    const tag = (
      shape.kind === 'rect'     ? 'rect'     :
      shape.kind === 'polygon'  ? 'polygon'  :
      shape.kind === 'polyline' ? 'polyline' :
      shape.kind === 'path'     ? 'path'     :
      shape.kind === 'circle'   ? 'circle'   :
      shape.kind === 'ellipse'  ? 'ellipse'  :
      'path'
    );

    const el = document.createElementNS(svgNS, tag);

    // CLASS: body vs hit
    const extraCls = (shape.cls || shape.class || '').trim();
    if (shape.hit) {
      el.setAttribute('class', `hit${extraCls ? ' ' + extraCls : ''}`);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', '#ffd54a');
    } else {
      el.setAttribute('class', `body${extraCls ? ' ' + extraCls : ''}`);
    }

    // GEOMETRY
    if (shape.d && tag === 'path') el.setAttribute('d', shape.d);
    if (shape.points && (tag === 'polygon' || tag === 'polyline')) {
      el.setAttribute('points', shape.points.map(p => p.join(',')).join(' '));
    }
    if (tag === 'rect') {
      const x = Number(shape.x) || 0;
      const y = Number(shape.y) || 0;
      el.setAttribute('x', x);
      el.setAttribute('y', y);
      if (shape.w) el.setAttribute('width', shape.w);
      if (shape.h) el.setAttribute('height', shape.h);
      if (shape.rx != null) {
    el.setAttribute('rx', shape.rx);
    el.setAttribute('ry', shape.ry ?? shape.rx);
    }}
    if (tag === 'circle') {
      el.setAttribute('cx', Number(shape.cx) || 0);
      el.setAttribute('cy', Number(shape.cy) || 0);
      if (shape.r) el.setAttribute('r', shape.r);
    }
    if (tag === 'ellipse') {
      el.setAttribute('cx', Number(shape.cx) || 0);
      el.setAttribute('cy', Number(shape.cy) || 0);
      if (shape.rx) el.setAttribute('rx', shape.rx);
      if (shape.ry) el.setAttribute('ry', shape.ry);
    }

// === COLOR & STROKE HANDLING (with non-scaling stroke fix) ===
// Per-shape pattern fill support (texture + scale + angle)
if (tag === 'polyline') {
  // polylines never get a fill
  el.setAttribute('fill', 'none');
} else {
  const baseFill = shape.fill || '#20262c';
  let fillVal = baseFill;
  if (shape.texture) {
    const pid = __patternIdForShape(shape);
    if (pid) fillVal = `url(#${pid})`;
  }
  el.setAttribute('fill', fillVal);
}
if (shape.stroke) el.setAttribute('stroke', shape.stroke);

// Only apply stroke-width if the shape defines one
if (shape.stroke || Number.isFinite(shape.sw)) {

  // Determine base width in hex units from catalog (e.g., 0.02)
  const swHex = Number(shape.sw) || 0.02;

  // Convert to pixels based on your current hexSize, but lock it visually
  // so it doesn’t scale up/down with zoom or structure size
  const pxWidth = Math.max(0.5, swHex * hexSize);

  el.setAttribute('vector-effect', 'non-scaling-stroke');
  el.setAttribute('stroke-width', pxWidth.toFixed(2));
}


    // PER-SHAPE TRANSFORM
    const tTX  = Number(shape.tx) || 0;
    const tTY  = Number(shape.ty) || 0;
    const tRot = Number(shape.rot) || 0;
    const tScl = Number(shape.s)   || 1;
    const t = [];
    if (tTX || tTY) t.push(`translate(${tTX},${tTY})`);
    if (tRot)       t.push(`rotate(${tRot})`);
    if (tScl !== 1) t.push(`scale(${tScl})`);
    if (t.length) el.setAttribute('transform', t.join(' '));

    g.appendChild(el);
  });
}


  gStructs.appendChild(g);
});


  tiles.forEach(t => {
    const {x,y} = offsetToPixel(t.q,t.r,size);
    const ptsStr = ptsToString(hexPointsArray(x,y,size));
    geom.set(key(t.q,t.r), {x,y,ptsStr});
    minX = Math.min(minX, x - size);
    minY = Math.min(minY, y - size);
    maxX = Math.max(maxX, x + size);
    maxY = Math.max(maxY, y + size);
  });

  // Base hexes + textures (+ cover ring)
tiles.forEach(t => {
  const poly = document.createElementNS(svgNS,'polygon');
  const terrain = TERRAINS[t.terrainIndex];

  // how strong each step darkens
  const SCALE = 8;  
  // optional max cap so it doesn't go pitch black
  const MAX_OFFSET = 50;

  // always darken by distance from 0
  let brightnessOffset = -Math.min(MAX_OFFSET, Math.abs(t.height) * SCALE);

  const fillColor = adjustLightness(terrain.fill, brightnessOffset);
  const strokeW = Math.max(1, size * 0.03);

    poly.setAttribute('points', geom.get(key(t.q,t.r)).ptsStr);
    poly.setAttribute('class','hex');
    poly.setAttribute('fill', fillColor);
    poly.setAttribute('stroke', '#00000066');
    poly.setAttribute('stroke-width', strokeW);
    poly.dataset.q = t.q; poly.dataset.r = t.r;

    if (t.height > 0) {
      const bucket = Math.min(5, Math.max(1, t.height));
      poly.setAttribute('filter', `url(#hexDropH${bucket})`);
    } else {
      poly.removeAttribute('filter');
    }
    gPolys.appendChild(poly);

    const tex = document.createElementNS(svgNS,'polygon');
    tex.setAttribute('points', geom.get(key(t.q,t.r)).ptsStr);
    tex.setAttribute('fill', `url(#${terrain.pat})`);
    tex.setAttribute('opacity', terrain.opacity);
    tex.style.pointerEvents = 'none';
    gTex.appendChild(tex);

    if (t.coverIndex > 0) {
      const covName = COVERS[t.coverIndex];
      const ringDelta = COVER_DARKEN[covName] || 0;
      const ringColor = adjustLightness(fillColor, ringDelta);
      const lvl = t.coverIndex;
      const ringW = Math.max(2.5, hexSize * (0.12 + 0.06 * lvl));
      const ring = document.createElementNS(svgNS,'polygon');
      ring.setAttribute('points', geom.get(key(t.q,t.r)).ptsStr);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', ringColor);
      ring.setAttribute('stroke-width', ringW.toFixed(2));
      ring.setAttribute('stroke-linejoin', 'round');
      ring.setAttribute('opacity', '0.95');
      ring.style.pointerEvents = 'none';
      gOver.appendChild(ring);
    }
  });

  // luminance helper
  function relLum(hex) {
    hex = hex.replace('#','');
    const n = parseInt(hex,16);
    const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    const chan = v => (v/=255) <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    return 0.2126*chan(r) + 0.7152*chan(g) + 0.0722*chan(b);
  }

  // Labels
  tiles.forEach(t => {
    const {x,y} = geom.get(key(t.q,t.r));
    const cov = COVERS[t.coverIndex];

    const fontMain  = Math.max(8, size * 0.25);
    const fontSub   = Math.max(6, size * 0.18);
    const fontCoord = Math.max(6, size * 0.16);

    const terrain   = TERRAINS[t.terrainIndex];
    const baseFill  = adjustLightness(terrain.fill, -t.height * 5);
    const isDark = relLum(baseFill) < 0.42;
    const ink    = isDark ? '#f8f8f8' : '#0b0f14';

    const label = document.createElementNS(svgNS,'text');
    label.setAttribute('x', x); label.setAttribute('y', y);
    label.setAttribute('class','lbl');
    label.setAttribute('font-size', fontMain);
    label.style.color = ink;
    label.textContent = `${t.height}${cov==='None' ? '' : ' ' + COVER_ABBR[cov]}`;
    gLabels.appendChild(label);

    const terrainText = document.createElementNS(svgNS,'text');
    terrainText.setAttribute('x', x);
    terrainText.setAttribute('y', y + size*0.44);
    terrainText.setAttribute('class','lbl');
    terrainText.setAttribute('font-size', fontSub);
    terrainText.style.color = ink;
    terrainText.textContent = terrain.name;
    gLabels.appendChild(terrainText);

    const cc = String(t.q + 1).padStart(2,'0');
    const rr = String(t.r + 1).padStart(2,'0');
    const coord = document.createElementNS(svgNS,'text');
    coord.setAttribute('x', (x - size*0.20).toFixed(2));
    coord.setAttribute('y', (y - size*0.62).toFixed(2));
    coord.setAttribute('class','coord');
    coord.setAttribute('font-size', fontCoord);
    coord.setAttribute('text-anchor','start');
    coord.setAttribute('dominant-baseline','hanging');
    coord.style.color = ink;
    coord.textContent = cc + rr;
    gLabels.appendChild(coord);
  });

  // Tokens
  const fontTok = Math.max(14, hexSize * 0.3);
  tokens.forEach(tok => {
const center = geom.get(key(tok.q, tok.r));
if (!center || center.x === undefined) return;
    const cx = center.x, cy = center.y;
    const rTok = Math.max(6, hexSize * TOKEN_BASE_SCALE * (tok.scale || 1));

    const g = document.createElementNS(svgNS, 'g');
    
    g.classList.add('token');
    if (tok.id === selectedTokenId) g.classList.add('selected');
    g.setAttribute('transform', `translate(${cx},${cy}) rotate(${tok.angle||0})`);
    g.dataset.id = tok.id;
    
    g.dataset.rtok = String(rTok);
    
    const tokPts = ptsToString(hexPointsArray(0, 0, rTok));

    const base = document.createElementNS(svgNS,'polygon');
    base.setAttribute('class','base');
    base.setAttribute('points', tokPts);
    g.appendChild(base);

    const ring = document.createElementNS(svgNS,'polygon');
    ring.setAttribute('class','ring');
    ring.setAttribute('points', tokPts);
    const team = TEAMS[(tok.colorIndex||0) % TEAMS.length].color;
    ring.setAttribute('stroke', team);
    ring.setAttribute('stroke-width', Math.max(2, rTok*0.14).toFixed(2));
    g.appendChild(ring);

    const nose = document.createElementNS(svgNS,'line');
    nose.setAttribute('class','nose');
    nose.setAttribute('x1', 0); nose.setAttribute('y1', 0 - (rTok*0.20));
    nose.setAttribute('x2', 0); nose.setAttribute('y2', 0 - (rTok + Math.max(4, rTok*0.25)));
    nose.setAttribute('stroke', team);
    nose.setAttribute('stroke-width', Math.max(2, rTok*0.12).toFixed(2));
    g.appendChild(nose);
    
    // Firing arc when selected
    if (tok.id === selectedTokenId) {
      const arcSpread = 33 * Math.PI/180;
      const arcLength = rTok * 20;
      const gradId = `arcGrad-${tok.id}`;
      if (!document.getElementById(gradId)) {
        const grad = document.createElementNS(svgNS, 'linearGradient');
        grad.id = gradId;
        grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
        grad.setAttribute('x2', '0%'); grad.setAttribute('y2', '100%');
        const stop1 = document.createElementNS(svgNS, 'stop');
        stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', team); stop1.setAttribute('stop-opacity', 0);
        const stop2 = document.createElementNS(svgNS, 'stop');
        stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', team); stop2.setAttribute('stop-opacity', 1);
        grad.appendChild(stop1); grad.appendChild(stop2);
        defs.appendChild(grad);
      }
      function makeArcLine(ang) {
        const x = Math.sin(ang) * arcLength;
        const y = -Math.cos(ang) * arcLength;
        const line = document.createElementNS(svgNS,'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', 200);
        line.setAttribute('x2', x.toFixed(2));
        line.setAttribute('y2', y.toFixed(2));
        line.setAttribute('stroke', `url(#${gradId})`);
        line.setAttribute('stroke-width', 3);
        line.setAttribute('opacity', 1);
        line.setAttribute('vector-effect','non-scaling-stroke');
        return line;
      }
      g.appendChild(makeArcLine(-arcSpread));
      g.appendChild(makeArcLine(+arcSpread));
    }

    const label = document.createElementNS(svgNS,'text');
    label.setAttribute('class','tlabel');
    label.setAttribute('font-size', fontTok);
    label.setAttribute('stroke-width', Math.max(0.8, fontTok*0.09).toFixed(2));
    label.textContent = tok.label || 'MECH';
    g.appendChild(label);

// TOP badge: Walk / Run / Jump
const mv = (typeof getMovementForToken === 'function') ? getMovementForToken(tok.id) : null;
renderMoveBadge(g, mv, rTok);

// BOTTOM badge: Initiative (keep existing behavior)
const roll = (typeof getInitRollFor === 'function') ? getInitRollFor(tok.id) : undefined;
renderInitBadge(g, roll, rTok);
    
    gTokens.appendChild(g);
  });

  // Measurement overlay
  if (measurement) {
    const p1 = tileCenter(measurement.from.q, measurement.from.r);
    const p2 = tileCenter(measurement.to.q, measurement.to.r);

    const line = document.createElementNS(svgNS,'line');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    line.setAttribute('class','measure-line');
    gMeasure.appendChild(line);

    const d1 = document.createElementNS(svgNS,'circle');
    d1.setAttribute('cx', p1.x); d1.setAttribute('cy', p1.y);
    d1.setAttribute('r', Math.max(2, hexSize*0.06));
    d1.setAttribute('class','measure-dot');
    gMeasure.appendChild(d1);

    const d2 = document.createElementNS(svgNS,'circle');
    d2.setAttribute('cx', p2.x); d2.setAttribute('cy', p2.y);
    d2.setAttribute('r', Math.max(2, hexSize*0.06));
    d2.setAttribute('class','measure-dot');
    gMeasure.appendChild(d2);

    const mx = (p1.x + p2.x)/2, my = (p1.y + p2.y)/2;
    const txt = document.createElementNS(svgNS,'text');
    txt.setAttribute('x', mx); txt.setAttribute('y', my);
    txt.setAttribute('class','measure-label');
    txt.setAttribute('font-size', Math.max(20, hexSize*0.3));
    const n = measurement.dist;
    txt.textContent = `${n} hex${n===1?'':'es'}`;
    gMeasure.appendChild(txt);
  }

  // Frame
  const pad = 12;
  frameBorder.setAttribute('x', (minX - pad).toFixed(2));
  frameBorder.setAttribute('y', (minY - pad).toFixed(2));
  frameBorder.setAttribute('width',  (maxX - minX + 2*pad).toFixed(2));
  frameBorder.setAttribute('height', (maxY - minY + 2*pad).toFixed(2));

  if (!camera.inited) camera.fitToContent();
  saveLocal();

  updateTokenControls();
  updateStructControls();  // NEW – keep structure radial in sync too
}

const tokenControls = document.getElementById('tokenControls');
const btnTurnLeft   = document.getElementById('btnTurnLeft');
const btnTurnRight  = document.getElementById('btnTurnRight');

btnTurnLeft && btnTurnLeft.addEventListener('click', () => rotateToken(-60));
btnTurnRight && btnTurnRight.addEventListener('click', () => rotateToken(+60));

function updateTokenControls() {
  if (!tokenControls) return;
  const sel = getSelected();
  if (!sel) {
    tokenControls.style.display = 'none';
    return;
  }
  const center = offsetToPixel(sel.q, sel.r, hexSize);
  const pt = svg.createSVGPoint();
  pt.x = center.x; pt.y = center.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM());

  tokenControls.style.left = (screenPt.x - 30) + 'px';
  tokenControls.style.top  = (screenPt.y - 30) + 'px';
  tokenControls.style.display = 'block';
}

// --- Structure radial controls (rotate / delete) ---
const structControls = document.getElementById('structControls');

function updateStructControls() {
  if (!structControls) return;
  const sel = structures.find(s => s.id === selectedStructureId);
  if (!sel) {
    structControls.style.display = 'none';
    return;
  }

  const center = offsetToPixel(sel.q, sel.r, hexSize);
  const pt = svg.createSVGPoint();
  pt.x = center.x;
  pt.y = center.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM());

  structControls.style.left = (screenPt.x - 30) + 'px';
  structControls.style.top  = (screenPt.y - 30) + 'px';
  structControls.style.display = 'block';
}

/* ---------- Stroke / Undo helpers ---------- */
function pushUndo(action){ undoStack.push(action); while (undoStack.length > UNDO_LIMIT) undoStack.shift(); redoStack.length = 0; }
function beginStroke(){ currentStroke = { type:'batch', edits: [] }; }
function recordEdit(q,r, prev, next){
  if (!currentStroke) beginStroke();
  if (prev.h===next.h && prev.ter===next.ter && prev.cov===next.cov) return;
  currentStroke.edits.push({ q,r, prev, next });
}
function endStroke(){ if (currentStroke && currentStroke.edits.length) pushUndo(currentStroke); currentStroke = null; requestRender(); }
function applyEdits(edits, usePrev){
  for (const e of edits){
    const t = tiles.get(key(e.q,e.r)); if (!t) continue;
    const src = usePrev ? e.prev : e.next;
    t.height = src.h; t.terrainIndex = src.ter; t.coverIndex = src.cov;
  }
  requestRender();
}
function undo(){ if (mapLocked) return; const a = undoStack.pop(); if (!a) return; if (a.type==='batch'){ applyEdits([...a.edits].reverse(), true); } redoStack.push(a); }
function redo(){ if (mapLocked) return; const a = redoStack.pop(); if (!a) return; if (a.type==='batch'){ applyEdits(a.edits, false); } undoStack.push(a); }

/* ---------- Hex math ---------- */
function offsetToCube(q,r){ const x=q; const z = r - ((q - (q&1))>>1); const y = -x - z; return {x,y,z}; }
function cubeDistance(a,b){ return (Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z))/2; }
function cubeLerp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }; }
function cubeRound(frac){ let rx=Math.round(frac.x), ry=Math.round(frac.y), rz=Math.round(frac.z); const xdiff=Math.abs(rx-frac.x), ydiff=Math.abs(ry-frac.y), zdiff=Math.abs(rz-frac.z); if (xdiff>ydiff && xdiff>zdiff) rx=-ry-rz; else if (ydiff>zdiff) ry=-rx-rz; else rz=-rx-ry; return {x:rx,y:ry,z:rz}; }
function cubeLine(a,b){ const N=Math.max(1,cubeDistance(a,b)); const out=[]; for(let i=0;i<=N;i++){ const t=(1/N)*i+1e-6*i; out.push(cubeRound(cubeLerp(a,b,t))); } return out; }
function cubeToOffset(c){ const q=c.x; const r=c.z + ((c.x - (c.x&1))>>1); return {q,r}; }
function tileCenter(q,r){ const p=offsetToPixel(q,r,hexSize); return {x:p.x, y:p.y}; }

/* ===== Structures → LoS cache (hex → height) ===== */
const StructLOS = {
  grid: new Map(),                              // "q,r" -> height
  key(q,r){ return `${q},${r}`; },
  get(q,r){ return this.grid.get(this.key(q,r)) || 0; },
  set(q,r,h){
    const k = this.key(q,r);
    const prev = this.grid.get(k) || 0;
    if (h > prev) this.grid.set(k, h);
  },
  clear(){ this.grid.clear(); }
};

// simple point-in-polygon in world px
function pointInPoly(pt, poly){
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// local-shape → polygon (hex units). Rects only (your catalog uses rects).
function rectToPolyHex(sh){
  const x = Number(sh.x)||0, y = Number(sh.y)||0;
  const w = Number(sh.w)||0, h = Number(sh.h)||0;
  // your rects are authored with (x,y) top-left; convert to 4 corners
return [
  { x: x,       y: y       },
  { x: x + w,   y: y       },
  { x: x + w,   y: y + h   },
  { x: x,       y: y + h   }
];
}

// apply per-shape transform (tx,ty,rot,s) and group rotation (s.angle) in HEX units
function transformPolyHex(poly, sh, s){
  const tx  = Number(sh.tx)||0, ty = Number(sh.ty)||0;
  const rot = (Number(sh.rot)||0) * Math.PI / 180;
  const scl = Number(sh.s)||1;
  const gRot = (Number(s.angle)||0) * Math.PI / 180;

  const out = [];
  for (const p of poly){
    // local scale
    let x = p.x * scl, y = p.y * scl;
    // local rot
    if (rot){
      const xr = x*Math.cos(rot) - y*Math.sin(rot);
      const yr = x*Math.sin(rot) + y*Math.cos(rot);
      x = xr; y = yr;
    }
    // local translate
    x += tx; y += ty;
    // group rot about (0,0) because render translates to center later
    if (gRot){
      const xr = x*Math.cos(gRot) - y*Math.sin(gRot);
      const yr = x*Math.sin(gRot) + y*Math.cos(gRot);
      x = xr; y = yr;
    }
    out.push({ x, y });
  }
  return out;
}

// Rebuilds the hex→height cache from current structures and their SHAPES
function rebuildStructLOSCache(){
  StructLOS.clear();
  const placed = structures || [];
  if (!placed.length) return;

  for (const s of placed){
    const height = Number(s.height)||0;
    if (height <= 0) continue;

    // get world center (pixels) for the anchor hex
    const ctr = offsetToPixel(s.q, s.r, hexSize);
    const cx = ctr.x, cy = ctr.y;

    // collect polygons in world px from rect shapes only (ignore .hit)
    const polysWorld = [];
    const shapes = Array.isArray(s.shapes) ? s.shapes : [];
    for (const sh of shapes){
      if (sh.hit) continue;
      if (sh.kind !== 'rect') continue;         // your sample defs use rects
      if (!Number(sh.w) || !Number(sh.h)) continue;

      // polygon in hex units (around local origin), apply transforms
      const polyHex = transformPolyHex(rectToPolyHex(sh), sh, s);
      // convert hex-units → world px by scaling with hexSize and translating to center
      const polyWorld = polyHex.map(p => ({ x: cx + p.x*hexSize, y: cy + p.y*hexSize }));
      polysWorld.push(polyWorld);
    }
    if (!polysWorld.length) continue;

    // compute world AABB to bound candidate hexes
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const poly of polysWorld){
      for (const p of poly){
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    // expand a bit for edges
    minX -= hexSize; minY -= hexSize; maxX += hexSize; maxY += hexSize;

    // iterate hex centers overlapped by that AABB
    for (let r=0; r<rows; r++){
      for (let q=0; q<cols; q++){
        const c = offsetToPixel(q, r, hexSize);           // center (px)
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;

        // if the hex center is inside ANY polygon, mark that hex with this structure height
        for (const polyW of polysWorld){
          if (pointInPoly({x:c.x, y:c.y}, polyW)){
            StructLOS.set(q, r, height);
            break;
          }
        }
      }
    }
  }
}


/* ---------- LOS ---------- */
function recomputeLOS(){
  gLos.replaceChildren(); gLosRays.replaceChildren();
  if (!losActive || !losSource) return;

  const srcTile = tiles.get(key(losSource.q, losSource.r)); 
  if (!srcTile) return;

  const srcCube = offsetToCube(losSource.q, losSource.r);
  const srcP    = tileCenter(losSource.q, losSource.r);

  // draw source outline
  const outline = document.createElementNS(svgNS,'polygon');
  outline.setAttribute('points', ptsToString(hexPointsArray(srcP.x, srcP.y, hexSize)));
  outline.setAttribute('class','los-source');
  gLos.appendChild(outline);

  // eye height over *true* ground (negative allowed)
  const z0 = getHexHeight(losSource.q, losSource.r) + EYE_Z;

  tiles.forEach(t => {
    // skip self
    if (t.q === losSource.q && t.r === losSource.r) return;

    const tgtCube = offsetToCube(t.q, t.r);
    const line    = cubeLine(srcCube, tgtCube);

    // target eye height
    const z1 = getHexHeight(t.q, t.r) + EYE_Z;

    let blocked = false;

    // short adjacency is trivially visible
    if (line.length > 2) {
      for (let i = 1; i < line.length - 1; i++) {
        const midOff = cubeToOffset(line[i]);
        const midT   = tiles.get(key(midOff.q, midOff.r));
        const ground = getHexHeight(midOff.q, midOff.r);

// cover + structure height at this hex
const covIdx  = midT?.coverIndex ?? 0;
const structH = StructLOS.get(midOff.q, midOff.r);
const blockTop = ground + (COVER_BLOCK_HEIGHT[covIdx] || 0) + structH;


        // param along segment; if cubeLine doesn't carry t, use i/(N-1)
        const tParam = i / (line.length - 1);
        const zRay   = z0 + (z1 - z0) * tParam;

        // if terrain + cover reach/cross the ray, it blocks LOS
        if (blockTop + LOS_EPS >= zRay) { blocked = true; break; }
      }
    }

    if (!blocked) markVisible(t, srcP);
  });
}

function markVisible(t, srcP){
  const center = tileCenter(t.q,t.r);
  const poly = document.createElementNS(svgNS,'polygon');
  poly.setAttribute('points', ptsToString(hexPointsArray(center.x, center.y, hexSize)));
  poly.setAttribute('class','los-visible');
  gLos.appendChild(poly);

  const line = document.createElementNS(svgNS,'line');
  line.setAttribute('x1', srcP.x); line.setAttribute('y1', srcP.y);
  line.setAttribute('x2', center.x); line.setAttribute('y2', center.y);
  line.setAttribute('class','los-ray');
  gLosRays.appendChild(line);
}
function clearLOS(){ gLos.replaceChildren(); gLosRays.replaceChildren(); losSource=null; }

/* ---------- Measurement helpers ---------- */
function setMeasurement(fromCell, toCell){
  const a = offsetToCube(fromCell.q, fromCell.r);
  const b = offsetToCube(toCell.q, toCell.r);
  const dist = cubeDistance(a,b);
  measurement = { from: {q:fromCell.q,r:fromCell.r}, to: {q:toCell.q,r:toCell.r}, dist };
  requestRender();
}
function clearMeasurement(){ measurement = null; gMeasure.replaceChildren(); }

/* ---------- Painting / Interaction ---------- */
let isSpaceHeld=false, isPanning=false, panLast=null;
let brushMode=null; // 'height'|'terrain'|'cover'|'reset'|'sample'|'fixed'
let sample=null;
let paintedThisStroke=null;
let dragStartPt = null;
const DRAG_THRESH = 4; // px in SVG coords

function setCursor(){ if (isPanning) svg.style.cursor='grabbing'; else if (isSpaceHeld) svg.style.cursor='grab'; else svg.style.cursor='default'; }

/* Tool mode UI */
const toolButtons = [btnSelect, btnHeight, btnTerrain, btnCover, btnClearTile].filter(Boolean);
function setToolMode(mode){
  toolMode = mode;
  toolButtons.forEach(btn => {
    const on = (btn === ({
      select:btnSelect, height:btnHeight, terrain:btnTerrain, cover:btnCover, clear:btnClearTile
    }[mode]));
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) btn.classList.add('active'); else btn.classList.remove('active');
  });
  if (btnPaintFixed) {
    const onFixed = (mode === 'paintFixed');
    btnPaintFixed.setAttribute('aria-pressed', onFixed ? 'true' : 'false');
    btnPaintFixed.classList.toggle('active', onFixed);
  }
  brushMode = null; sample = null; paintedThisStroke=null;
}
if (btnSelect)    btnSelect.addEventListener('click', () => setToolMode('select'));
if (btnHeight)    btnHeight.addEventListener('click', () => setToolMode('height'));
if (btnTerrain)   btnTerrain.addEventListener('click', () => setToolMode('terrain'));
if (btnCover)     btnCover.addEventListener('click', () => setToolMode('cover'));
if (btnClearTile) btnClearTile.addEventListener('click', () => setToolMode('clear'));
setToolMode('select'); // default safe mode

/* Fixed Paint selectors init (drop-in replacement) */
function initFixedPaintSelectors(){
  if (selPaintTerrain) {
    selPaintTerrain.replaceChildren();
    TERRAINS.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.name;
      selPaintTerrain.appendChild(opt);
    });
    selPaintTerrain.value = String(fixedPaint.terrainIndex);
  }

  if (selPaintCover) {
    selPaintCover.replaceChildren();
    COVERS.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = c;
      selPaintCover.appendChild(opt);
    });
    selPaintCover.value = String(fixedPaint.coverIndex);
  }

  if (selPaintHeight) {
    selPaintHeight.replaceChildren();
    for (let h = -3; h <= 5; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = String(h);
      selPaintHeight.appendChild(opt);
    }
    selPaintHeight.value = String(fixedPaint.height);
  }
}
initFixedPaintSelectors();

selPaintTerrain?.addEventListener('change', () => { fixedPaint.terrainIndex = +selPaintTerrain.value || 0; });
selPaintHeight?.addEventListener('change',  () => { fixedPaint.height       = +selPaintHeight.value  || 0; });
selPaintCover?.addEventListener('change',   () => { fixedPaint.coverIndex   = +selPaintCover.value   || 0; });

btnPaintFixed?.addEventListener('click', () => {
  setToolMode(toolMode === 'paintFixed' ? 'select' : 'paintFixed');
});
btnClearFixed?.addEventListener('click', () => {
  if (selPaintTerrain) selPaintTerrain.value = 0;
  if (selPaintHeight)  selPaintHeight.value  = 0;
  if (selPaintCover)   selPaintCover.value   = 0;
  fixedPaint = { terrainIndex:0, height:0, coverIndex:0 };
  setToolMode('paintFixed');
});

/* ===== Load structure catalog (core, no external module) ===== */
let STRUCTURE_CATALOG = {};

(async function loadStructureCatalog() {
  try {
    const res = await fetch('modules/catalog.json', { cache: 'no-store' });
    const data = await res.json();

    // Group defs by type id/name for picker use
    const typeMap = {};
    for (const t of data.types) typeMap[t.id] = { name: t.name, defs: [] };
    for (const d of data.defs) {
      if (typeMap[d.type]) typeMap[d.type].defs.push(d);
    }
        STRUCTURE_CATALOG = typeMap;

    // now that the catalog is ready, refresh the dropdowns
    if (typeof initStructurePickers === 'function') initStructurePickers();

    console.info('[Structures] catalog loaded:', STRUCTURE_CATALOG);

  } catch (e) {
    console.error('[Structures] failed to load catalog.json', e);
  }
})();



/* ===== Structures UI ===== */
const btnStructSelect = document.getElementById('btnStructSelect');
const btnStructPlace  = document.getElementById('btnStructPlace');
const btnStructDelete = document.getElementById('btnStructDelete');
const btnStructRotL   = document.getElementById('btnStructRotL');
const btnStructRotR   = document.getElementById('btnStructRotR');
const selStructType   = document.getElementById('structType');
const selStruct       = document.getElementById('structSelect');
const inpStructH      = document.getElementById('structHeight');
const inpStructScale  = document.getElementById('structScale');

let structTool = 'select'; // 'select' | 'place' | 'rotate' | 'delete'
function setStructTool(mode){
  // clicking the same button again clears structure mode (lets tokens work)
  structTool = (structTool === mode) ? '' : mode;

  const map = {
    select: btnStructSelect,
    place:  btnStructPlace,
    delete: btnStructDelete
  };
  [btnStructSelect, btnStructPlace, btnStructDelete].forEach(b=>{
    if (!b) return;
    const on = (b === map[structTool]);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('active', on);
  });
}

btnStructSelect?.addEventListener('click', ()=> setStructTool('select'));
btnStructPlace ?.addEventListener('click', ()=> setStructTool('place'));
btnStructDelete?.addEventListener('click', () => {
  // If something is selected, delete it immediately.
  if (selectedStructureId) {
    const ok = deleteSelectedStructure();
    // leave structure tool OFF so tokens can be moved next
    structTool = '';
    [btnStructSelect, btnStructPlace, btnStructDelete].forEach(b=>{
      if (!b) return; b.setAttribute('aria-pressed','false'); b.classList.remove('active');
    });
    return;
  }
  // Otherwise enter delete mode (tap board to delete by click)
  setStructTool('delete');
});
setStructTool('select');

if (!STRUCTURE_CATALOG) STRUCTURE_CATALOG = {};

function rotateSelectedStructure(dir){
  const s = structures.find(x => x.id === selectedStructureId);
  if (!s) return;
  const step = s.rotateStep || 60;  // default 60° if not in catalog
s.angle = ((s.angle || 0) + dir * step + 360) % 360;
rebuildStructLOSCache();
requestRender(); saveLocal();
if (losActive && losSource) recomputeLOS();
}
btnStructRotL?.addEventListener('click', () => rotateSelectedStructure(-1));
btnStructRotR?.addEventListener('click', () => rotateSelectedStructure(1));

function deleteSelectedStructure(){
  if (!selectedStructureId) return false;
  const before = structures.length;
  structures = structures.filter(s => s.id !== selectedStructureId);
  const deleted = (structures.length !== before);
  if (deleted) {
    console.info('[Structures] Deleted', selectedStructureId);
    selectedStructureId = null;
    requestRender(); 
    saveLocal();
  }
  return deleted;
}

function initStructurePickers(){
  if (!selStructType || !selStruct) return;
  selStructType.replaceChildren();

  // STRUCTURE_CATALOG = { typeId: { name, defs: [...] }, ... }
  Object.entries(STRUCTURE_CATALOG).forEach(([typeId, group], i) => {
    const opt = document.createElement('option');
    opt.value = typeId;
    opt.textContent = (group && group.name) ? String(group.name) : String(typeId);
    selStructType.appendChild(opt);
    if (i === 0) selStructType.value = typeId;
  });

  refillStructsForType(selStructType.value);
}
function refillStructsForType(type){
  if (!selStruct) return;
  selStruct.replaceChildren();

  const group = STRUCTURE_CATALOG[type] || {};
  const list = Array.isArray(group.defs) ? group.defs : [];   // ← was STRUCTURE_CATALOG[type] || []

  list.forEach((item, i)=>{
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = item.name || `Item ${i+1}`;
    selStruct.appendChild(opt);
  });
  selStruct.value = list.length ? '0' : '';
}
selStructType?.addEventListener('change', ()=> refillStructsForType(selStructType.value));
initStructurePickers();

function getSelectedStructCatalogItem(){
  const type = selStructType?.value || '';
  const idx  = +selStruct?.value;
  const group = STRUCTURE_CATALOG[type] || {};
  const list = Array.isArray(group.defs) ? group.defs : [];
  return list[idx] || null;
}


/* Tile mutators + helpers used by paint */
const cycleHeight = t => { const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; t.height=(t.height>=5)?-3:t.height+1; const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; recordEdit(t.q,t.r,prev,next); };
const cycleTerrain = t => { const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; t.terrainIndex=(t.terrainIndex+1)%TERRAINS.length; const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; recordEdit(t.q,t.r,prev,next); };
const cycleCover = t => { const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; t.coverIndex=(t.coverIndex+1)%COVERS.length; const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; recordEdit(t.q,t.r,prev,next); };
const resetTile = t => { const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; t.height=0; t.terrainIndex=0; t.coverIndex=0; const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; recordEdit(t.q,t.r,prev,next); };
const applySampleTo = (t, sam) => { const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; t.height=sam.h; t.terrainIndex=sam.ter; t.coverIndex=sam.cov; const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex}; recordEdit(t.q,t.r,prev,next); };
function applyFixedToTile(t){
  const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex};
  const next={h:fixedPaint.height,ter:fixedPaint.terrainIndex,cov:fixedPaint.coverIndex};
  if (prev.h===next.h && prev.ter===next.ter && prev.cov===next.cov) return;
  t.height=next.h; t.terrainIndex=next.ter; t.coverIndex=next.cov;
  recordEdit(t.q,t.r,prev,next);
}

svg.addEventListener('pointerdown', (e) => {
  const pt = toSvgPoint(e.clientX, e.clientY);

  // Middle or Space+Left => pan
  if (e.button===1 || (e.button===0 && isSpaceHeld)) {
    isPanning = true;
    panLast = pt;
    svg.setPointerCapture(e.pointerId);
    setCursor();
    return;
  }

  const tokElHit = e.target.closest && e.target.closest('.token');
  const hexElHit = e.target.closest && e.target.closest('.hex');
  const structElHit = e.target.closest && e.target.closest('.structure');

  // Measure mode: hex clicks define start/end
  if (measureMode && hexElHit && e.button===0) {
    e.preventDefault();
    const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
    if (!measureAnchor) {
      measureAnchor = { q, r };
      setMeasurement(measureAnchor, measureAnchor);
    } else {
      setMeasurement(measureAnchor, { q, r });
      measureAnchor = null;
    }
    return;
  }

// Token selection (click) — don't preventDefault so dblclick can fire
if (toolMode==='select' && tokElHit && e.button===0) {
  e.preventDefault();
  selectedTokenId = tokElHit.dataset.id;
  dragStartPt = toSvgPoint(e.clientX, e.clientY); // start threshold check
  // DO NOT set tokenDragId yet; we’ll promote after threshold in pointermove
  requestRender();
  return;
}

  // Structure selection
if (structTool === 'select' && structElHit && e.button === 0) {
  e.preventDefault();
  selectedStructureId = structElHit.dataset.id;
  dragStartPt = toSvgPoint(e.clientX, e.clientY);
  requestRender();
  return;
}


// Deselect if clicking empty space in select mode
if (toolMode === 'select' && !tokElHit && !structElHit && e.button === 0) {
  if (selectedTokenId || selectedStructureId) {
    selectedTokenId = null;
    selectedStructureId = null;
    requestRender();
  }
}

  // RANGE: selected token + right-click ⇒ range to target
  if (toolMode==='select' && e.button===2 && selectedTokenId) {
    e.preventDefault();
    let targetCell;
    if (tokElHit) {
      const tid = tokElHit.dataset.id;
      const t2 = tokens.find(t => t.id === tid);
      if (t2) targetCell = { q:t2.q, r:t2.r };
    } else if (hexElHit) {
      targetCell = { q:+hexElHit.dataset.q, r:+hexElHit.dataset.r };
    } else {
      targetCell = pixelToCell(pt.x, pt.y);
    }
    const sel = tokens.find(t => t.id === selectedTokenId);
    if (sel && targetCell) setMeasurement({q:sel.q,r:sel.r}, targetCell);
    return;
  }

  // Hex hit for LOS or painting
  if (!hexElHit) return;

// Structures tool takes precedence over terrain painting
if (structTool !== 'select' && (hexElHit || structElHit) && e.button === 0) {
  e.preventDefault();
  const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;

if (structTool === 'place') {
  const cat = getSelectedStructCatalogItem();
  if (!cat) return;
  const id = String(Date.now()) + Math.random().toString(16).slice(2,6);
  const angle = 0;
  const type = cat.type || '';
  const name = cat.name || 'Structure';
  const fill = (Array.isArray(cat.shapes) && cat.shapes[0]?.fill) || cat.fill || '#c9d2e0';
  const shapes = Array.isArray(cat.shapes) ? cat.shapes.map(x => JSON.parse(JSON.stringify(x))) : [];
  const height = Number.isFinite(cat.height) ? cat.height : 0;
  const rotateStep = Number.isFinite(cat.rotateStep) ? cat.rotateStep : 60;
structures.push({ id, q, r, angle, scale: 1, height, type, name, fill, shapes, rotateStep });
selectedStructureId = id;
rebuildStructLOSCache();
requestRender(); saveLocal();
if (losActive && losSource) recomputeLOS();
return;

}





if (structTool === 'delete') {
  // If user clicked directly on a structure, delete that one.
  if (structElHit) {
    const id = structElHit.dataset.id;
    if (id) {
      const before = structures.length;
      structures = structures.filter(s => s.id !== id);
      if (selectedStructureId === id) selectedStructureId = null;
      if (structures.length !== before) {
        console.info('[Structures] Deleted by click', id);
        requestRender(); saveLocal();
        rebuildStructLOSCache();
if (losActive && losSource) recomputeLOS();

        // exit delete mode on success
        structTool = '';
        [btnStructSelect, btnStructPlace, btnStructDelete].forEach(b=>{
          if (!b) return; b.setAttribute('aria-pressed','false'); b.classList.remove('active');
        });
        return;
      }
    }
  }

  // Otherwise, delete currently selected (if any)…
  if (selectedStructureId) {
    if (deleteSelectedStructure()) {
      structTool = '';
      [btnStructSelect, btnStructPlace, btnStructDelete].forEach(b=>{
        if (!b) return; b.setAttribute('aria-pressed','false'); b.classList.remove('active');
      });
    }
    return;
  }

  // …or delete the first structure on this hex (fallback)
  if (hexElHit) {
    const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
    const ix = structures.findIndex(s => s.q === q && s.r === r);
    if (ix >= 0) {
      const id = structures[ix].id;
      structures.splice(ix, 1);
      if (selectedStructureId === id) selectedStructureId = null;
      console.info('[Structures] Deleted by hex fallback', id);
      requestRender(); saveLocal();
      rebuildStructLOSCache();
if (losActive && losSource) recomputeLOS();

      // exit delete mode on success
      structTool = '';
      [btnStructSelect, btnStructPlace, btnStructDelete].forEach(b=>{
        if (!b) return; b.setAttribute('aria-pressed','false'); b.classList.remove('active');
      });
    }
  }
  return;
}


}

  
  // LOS click sets source (left)
  if (losActive && e.button===0 && !e.ctrlKey) {
    const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
    losSource = {q,r};
    recomputeLOS();
    return;
  }

  // --- LOCK: block mouse-driven tile edits while locked ---
  if (mapLocked) { e.preventDefault(); return; }

  // If in SELECT mode, never paint
  if (toolMode==='select') return;

  // Painting — toolMode directly selects brush mode
  e.preventDefault();
  beginStroke();
  paintedThisStroke = new Set();

  const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
  const t = tiles.get(key(q,r));
  sample = null;

  // Eyedropper (Alt): in any paint mode copies tile to sample OR to fixedPaint if in paintFixed
  if (e.altKey) {
    if (toolMode === 'paintFixed') {
      fixedPaint.height       = t.height;
      fixedPaint.terrainIndex = t.terrainIndex;
      fixedPaint.coverIndex   = t.coverIndex;
      if (selPaintHeight)  selPaintHeight.value  = fixedPaint.height;
      if (selPaintTerrain) selPaintTerrain.value = fixedPaint.terrainIndex;
      if (selPaintCover)   selPaintCover.value   = fixedPaint.coverIndex;
      brushMode = 'fixed';
    } else {
      sample = { h:t.height, ter:t.terrainIndex, cov:t.coverIndex };
      brushMode = 'sample';
    }
  } else {
    brushMode =
      toolMode==='height'     ? 'height'  :
      toolMode==='terrain'    ? 'terrain' :
      toolMode==='cover'      ? 'cover'   :
      toolMode==='clear'      ? 'reset'   :
      toolMode==='paintFixed' ? 'fixed'   : null;
  }

  if (brushMode) {
    paintHex(t);
    svg.setPointerCapture(e.pointerId);
  }
});

function paintHex(t){
  const k = key(t.q,t.r);
  if (paintedThisStroke && paintedThisStroke.has(k)) return;
  switch(brushMode){
    case 'height':  cycleHeight(t); break;
    case 'terrain': cycleTerrain(t); break;
    case 'cover':   cycleCover(t); break;
    case 'reset':   resetTile(t); break;
    case 'sample':  if (sample) applySampleTo(t, sample); break;
    case 'fixed':   applyFixedToTile(t); break;
    default: return;
  }
  paintedThisStroke && paintedThisStroke.add(k);
  requestRender();
  if (losActive && losSource) recomputeLOS();
}

svg.addEventListener('pointermove', (e) => {
  const cur = toSvgPoint(e.clientX, e.clientY);

  if (isPanning) {
    camera.pan(panLast.x - cur.x, panLast.y - cur.y);
    panLast = cur;
    return;
  }

  // delayed drag start (avoid accidental drags)
  if (selectedTokenId && (e.buttons & 1) && toolMode === 'select') {
    if (!tokenDragId && dragStartPt) {
      const dx = cur.x - dragStartPt.x;
      const dy = cur.y - dragStartPt.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESH) {
        tokenDragId = selectedTokenId;
        svg.setPointerCapture?.(e.pointerId);
      }
    }
  } // <— closes the outer if

// Delayed drag start for structures (select mode)
if (selectedStructureId && (e.buttons & 1) && structTool === 'select') {
  if (!structureDragId && dragStartPt) {
    const dx = cur.x - dragStartPt.x;
    const dy = cur.y - dragStartPt.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESH) {
      structureDragId = selectedStructureId;
      document.body.style.userSelect = 'none';
      svg.setPointerCapture?.(e.pointerId);

    }
  }
}

if (structureDragId) {
  const sel = structures.find(s => s.id === structureDragId);
  if (sel) {
    const cell = pixelToCell(cur.x, cur.y);
    sel.q = clamp(cell.q, 0, cols - 1);
    sel.r = clamp(cell.r, 0, rows - 1);
    requestRender();
  }
  return;
}

  
  if (tokenDragId) {
    const sel = tokens.find(t => t.id === tokenDragId);
    if (sel) {
      const cell = pixelToCell(cur.x, cur.y);
      sel.q = clamp(cell.q, 0, cols - 1);
      sel.r = clamp(cell.r, 0, rows - 1);
      requestRender();
    }
    return;
  }

  if (!brushMode) return;
  if (mapLocked) return;

  const target = document.elementFromPoint(e.clientX, e.clientY);
  const hexEl = target?.closest?.('.hex');
  if (!hexEl) return;

  const q = +hexEl.dataset.q, r = +hexEl.dataset.r;
  const t = tiles.get(key(q, r));
  paintHex(t);
});

function endPointer(e){
  if (isPanning) {
    isPanning = false; panLast = null; setCursor();
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    return;
  }

  if (tokenDragId) {
    tokenDragId = null;
    dragStartPt = null;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    saveLocal();
    return;
  }

if (structureDragId) {
  structureDragId = null;
  document.body.style.userSelect = '';
  dragStartPt = null;
  try { svg.releasePointerCapture(e.pointerId); } catch {}
  rebuildStructLOSCache();
  saveLocal();
  if (losActive && losSource) recomputeLOS();
  return;
}

  
  if (brushMode) {
    brushMode = null;
    sample = null;
    paintedThisStroke = null;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    endStroke();
  }

  dragStartPt = null;
}

svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('lostpointercapture', endPointer);
svg.addEventListener('contextmenu', (e)=> e.preventDefault());


/* ===== Pinch-to-zoom + two-finger pan ===== */
const pointers = new Map(); // pointerId -> {x,y}
let pinchStartDist = null;
let pinchStartScale = null;
let pinchCenterSvg = null;

function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }
function setScaleAtPoint(newScale, svgPoint){
  newScale = clamp(newScale, 0.2, 8);
  const k = newScale / camera.scale;
  camera.x = svgPoint.x - (svgPoint.x - camera.x) / k;
  camera.y = svgPoint.y - (svgPoint.y - camera.y) / k;
  camera.scale = newScale;
  camera.setViewBox();
}

svg.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    svg.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a,b] = [...pointers.values()];
      pinchStartDist  = dist(a,b);
      pinchStartScale = camera.scale;
      const midClient = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
      pinchCenterSvg  = toSvgPoint(midClient.x, midClient.y);
    }
  }
}, { passive: true });

svg.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStartDist && pinchCenterSvg) {
      const [a,b] = [...pointers.values()];
      const d = dist(a,b);
      if (d > 0) {
        const midClient = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
        const midSvg    = toSvgPoint(midClient.x, midClient.y);

        const dx = pinchCenterSvg.x - midSvg.x;
        const dy = pinchCenterSvg.y - midSvg.y;
        if (dx || dy) camera.pan(dx, dy);

        const factor = d / pinchStartDist;
        setScaleAtPoint(clamp(pinchStartScale * factor, 0.2, 8), midSvg);

        pinchCenterSvg = midSvg;
      }
    }
  }
}, { passive: true });

function endTouch(e){
  if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
  if (pointers.size < 2) {
    pinchStartDist = null;
    pinchStartScale = null;
    pinchCenterSvg = null;
  }
}
svg.addEventListener('pointerup', endTouch, { passive: true });
svg.addEventListener('pointercancel', endTouch, { passive: true });

/* ===== Wheel zoom ===== */
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1/1.15 : 1.15;
  const pt = toSvgPoint(e.clientX, e.clientY);
  camera.zoomAt(pt, factor);
}, { passive:false });

// === DOUBLE CLICK TO OPEN/CLOSE SHEET ===
svg.addEventListener('dblclick', (e) => {
  const tokEl = e.target.closest?.('g.token');
  if (!tokEl) return; // not a token

  const tid = tokEl.dataset.id;
  selectedTokenId = tid;
  requestRender?.();

  if (window.MSS84_SHEET) {
    const current = MSS84_SHEET.getIds();
    // If same token double-clicked again → toggle (close if open)
    if (current.mapId === CURRENT_MAP_ID && current.tokenId === tid) {
      MSS84_SHEET.toggle();
    } else {
      MSS84_SHEET.setIds(CURRENT_MAP_ID, tid);
      MSS84_SHEET.open();
    }
  }
});


/* ===== Recenter button ===== */
on('btnRecenter', 'click', () => { camera.reset(); svg.focus(); });

/* ===== Space key (grab-to-pan) ===== */
document.addEventListener('keydown', (e)=>{ if (e.code === 'Space') { isSpaceHeld=true; setCursor(); } });
document.addEventListener('keyup',   (e)=>{ if (e.code === 'Space') { isSpaceHeld=false; setCursor(); } });

/* ---------- View + menu + docks ---------- */
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}
const fsBtn = document.getElementById('fsBtn');
if (fsBtn) fsBtn.addEventListener('click', () => { toggleFullscreen(); svg.focus(); });

function toggleDockA(){
  const show = !dockA.classList.contains('show');
  dockA.classList.toggle('show', show);
  localStorage.setItem('hexmap_dockA_show', show ? '1' : '0');
  if (show && frameA && !frameA.src) frameA.src = SHEETS_BASE;
}
function toggleDockB(){
  const show = !dockB.classList.contains('show');
  dockB.classList.toggle('show', show);
  localStorage.setItem('hexmap_dockB_show', show ? '1' : '0');
  if (show && frameB && !frameB.src) frameB.src = SHEETS_BASE;
}

// Hamburger (guarded if hidden)
function toggleMenu(){ if (!menuPopup) return; menuPopup.style.display = (menuPopup.style.display === 'block') ? 'none' : 'block'; }
if (menuBtn) menuBtn.addEventListener('click', (e)=>{ e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => {
  if (!menuPopup) return;
  if (menuPopup.style.display === 'block' && !menuPopup.contains(e.target) && e.target !== menuBtn) menuPopup.style.display = 'none';
});

/* ===== ESC behavior ===== */
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') {
    if (selectedTokenId) { selectedTokenId = null; requestRender(); return; }
    if (selectedStructureId) { selectedStructureId = null; requestRender(); return; }
    if (menuPopup && menuPopup.style.display === 'block') { menuPopup.style.display='none'; return; }
    if (measurement) { clearMeasurement(); return; }
    if (losActive || losSource) { clearLOS(); return; }
    const anyDock = dockA.classList.contains('show') || dockB.classList.contains('show');
    if (anyDock) { dockA.classList.remove('show'); dockB.classList.remove('show'); localStorage.setItem('hexmap_dockA_show','0'); localStorage.setItem('hexmap_dockB_show','0'); return; }
    if (helpPopup && !helpPopup.hidden) { helpPopup.hidden = true; return; }
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
  }
});

/* ===== Keyboard navigation + tokens ===== */
svg.addEventListener('keydown', (e) => {
  // Undo/Redo
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); redo(); return; }

  const step = (camera.w/camera.scale) * 0.06;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','0','f','F','s','S','d','D','h','H','l','L','n','N','[',']','+','-','=','q','Q','e','E','Enter','Backspace','Delete'].includes(e.key)) e.preventDefault();

  if (e.key === 'ArrowLeft') camera.pan(-step, 0);
  else if (e.key === 'ArrowRight') camera.pan(step, 0);
  else if (e.key === 'ArrowUp') camera.pan(0, -step);
  else if (e.key === 'ArrowDown') camera.pan(0, step);
  else if (e.key === '0') camera.reset();
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 's' || e.key === 'S') toggleDockA();
  else if (e.key === 'd' || e.key === 'D') toggleDockB();
  else if (e.key === 'h' || e.key === 'H') toggleMenu();
  else if (e.key === 'l' || e.key === 'L') { losActive = !losActive; setBtnToggleState(btnLOS, losActive); if (!losActive) clearLOS(); }

  // Tokens
  else if (e.key === 'n' || e.key === 'N') { addTokenAtViewCenter(); }
  else if (e.key === '[') { cycleTeam(-1); }
  else if (e.key === ']') { cycleTeam(1); }
  else if (e.key === '+' || e.key === '=') { resizeToken(1.10); }
  else if (e.key === '-') { resizeToken(1/1.10); }
  else if ((e.key === 'q' || e.key === 'Q') && selectedStructureId) { const s = structures.find(x=>x.id===selectedStructureId); if (s) { s.angle = ((s.angle||0) - 60 + 360) % 360; requestRender(); saveLocal(); } }
else if ((e.key === 'e' || e.key === 'E') && selectedStructureId) { const s = structures.find(x=>x.id===selectedStructureId); if (s) { s.angle = ((s.angle||0) + 60) % 360; requestRender(); saveLocal(); } }
  else if (e.key === 'Enter') { renameToken(); }
else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedStructureId) {
  deleteSelectedStructure();
}
else if (e.key === 'Backspace' || e.key === 'Delete') {
  deleteToken();
}
});

/* ---------- Controls ---------- */
function regen() {
  if (mapLocked) { alert('Map is locked. Unlock to regenerate.'); return; }
  cols = +elCols.value || 10;
  rows = +elRows.value || 10;
  hexSize = +elHex.value || 120;
  initTiles(); camera.inited=false; requestRender(); clearLOS(); clearMeasurement();
}
on('regen','click', regen);

elHex.addEventListener('change', () => {
  hexSize = +elHex.value || 120;
  camera.inited=false; requestRender(); if (losActive && losSource) recomputeLOS();
});

on('clear','click', () => {
  if (mapLocked) { alert('Map is locked. Unlock to clear.'); return; }
  beginStroke(); tiles.forEach(t => resetTile(t)); endStroke(); clearLOS(); clearMeasurement();
});

/* ===== Export JSON Modal ===== */
function showJsonModal(text){
  const wrap = document.createElement('div');
  wrap.className = 'json-modal';
  wrap.innerHTML = `
    <div class="json-modal__panel" role="dialog" aria-modal="true" aria-label="Export JSON">
      <header class="json-modal__head">
        <strong>Export Map JSON</strong>
        <button class="icon-btn json-modal__close" title="Close" aria-label="Close">✕</button>
      </header>
      <div class="json-modal__body">
  <div class="small muted" style="margin-bottom:8px;">
    <strong>COMSTAR UPLINK:</strong> Transmission file generated copy code or download file.
  </div>
  <textarea class="json-modal__ta" readonly></textarea>
</div>
      <footer class="json-modal__foot">
        <button class="btn sm" id="jsonCopyBtn">Copy</button>
        <button class="btn sm" id="jsonDownloadBtn">Download</button>
        <button class="btn sm" id="jsonCloseBtn">Close</button>
      </footer>
    </div>
  `;
  document.body.appendChild(wrap);

  const ta = wrap.querySelector('.json-modal__ta');
  ta.value = text;
  ta.focus();
  ta.select();

  const close = () => { wrap.remove(); };
  wrap.querySelector('.json-modal__close').addEventListener('click', close);
  wrap.querySelector('#jsonCloseBtn').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', function esc(ev){
    if (ev.key === 'Escape') { ev.preventDefault(); close(); document.removeEventListener('keydown', esc); }
  });

  // Copy
  wrap.querySelector('#jsonCopyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); }
    catch { /* if clipboard is blocked, text is selected for manual copy */ }
  });

  // Download
  wrap.querySelector('#jsonDownloadBtn').addEventListener('click', () => {
    const stamp = new Date().toISOString().replace(/[:T]/g,'-').slice(0,19); // YYYY-MM-DD-HH-MM-SS
    const filename = `Battletech-Map-${stamp}.json`;
    const blob = new Blob([ta.value], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  });
}
on('exportJson','click', () => { showJsonModal(serializeState()); });


/* ===== Import JSON Modal (BattleTech-flavored) ===== */
function showImportModal() {
  const wrap = document.createElement('div');
  wrap.className = 'json-modal';
  wrap.innerHTML = `
    <div class="json-modal__panel" role="dialog" aria-modal="true" aria-label="Import Map JSON">
      <header class="json-modal__head">
        <strong>Import Map JSON</strong>
        <button class="icon-btn json-modal__close" title="Close" aria-label="Close">✕</button>
      </header>

      <div class="json-modal__body">
        <div class="small muted" style="margin-bottom:8px;">
          <strong>COMSTAR UPLINK:</strong> Paste a transmission code here or import file.</code>
        </div>
        <textarea class="json-modal__ta" id="importTa" placeholder="{ ... }"></textarea>

        <div class="row gap" style="align-items:center; margin-top:10px;">
          <input type="file" id="importFileTemp" accept="application/json" hidden />
          <button class="btn sm" id="importChooseBtn">Choose File…</button>
          <span class="small muted" id="importFileName">No file selected</span>
        </div>
      </div>

      <footer class="json-modal__foot">
        <button class="btn sm" id="importLoadBtn">Load</button>
        <button class="btn sm" id="importCloseBtn">Close</button>
      </footer>
    </div>
  `;
  document.body.appendChild(wrap);

  // modal elements
  const ta         = wrap.querySelector('#importTa');
  const fileInput  = wrap.querySelector('#importFileTemp');
  const chooseBtn  = wrap.querySelector('#importChooseBtn');
  const fileLabel  = wrap.querySelector('#importFileName');
  const loadBtn    = wrap.querySelector('#importLoadBtn');

  // UX niceties
  ta.focus();
  document.documentElement.style.overflow = 'hidden';
  const close = () => { wrap.remove(); document.documentElement.style.overflow = ''; };

  wrap.querySelector('.json-modal__close').addEventListener('click', close);
  wrap.querySelector('#importCloseBtn').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', function esc(ev){
    if (ev.key === 'Escape') { ev.preventDefault(); close(); document.removeEventListener('keydown', esc); }
  });

  // trigger native picker
  chooseBtn.addEventListener('click', () => fileInput.click());

  // when file chosen, read it and populate textarea (so user can glance/edit)
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) { fileLabel.textContent = 'No file selected'; return; }
    fileLabel.textContent = f.name;
    const r = new FileReader();
    r.onload = () => { ta.value = String(r.result || ''); };
    r.onerror = () => { alert('Failed to read file.'); };
    r.readAsText(f);
  });

  // allow drag & drop onto the textarea
  ta.addEventListener('dragover', (e) => { e.preventDefault(); });
  ta.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/\.json$/i.test(f.name)) { alert('Drop a .json file.'); return; }
    fileLabel.textContent = f.name;
    const r = new FileReader();
    r.onload = () => { ta.value = String(r.result || ''); };
    r.readAsText(f);
  });

  // apply imported JSON when clicking Load
  loadBtn.addEventListener('click', () => {
    if (window.mapLocked) { alert('Map is locked. Unlock to import.'); return; }
    const raw = ta.value.trim();
    if (!raw) { alert('Paste JSON or choose a file.'); return; }
    try {
      const obj = JSON.parse(raw);
      applyState(obj);                // your existing unified importer
      // return focus to stage for immediate input
      const svg = document.getElementById('svg');
      if (svg && typeof svg.focus === 'function') svg.focus();
      close();
    } catch (err) {
      alert('Import failed: ' + (err?.message || err));
    }
  });
}

// Wire to top-bar Import button
on('importJsonBtn','click', () => { showImportModal(); });


/* ---------- Quick legend builder (kept for patterns) ---------- */
function renderLegendRadios(){
  if (!elLegend) return;
  elLegend.replaceChildren();
}
renderLegendRadios();

/* ---------- Menu quick controls ---------- */
function safeOn(id, handler){ const el=document.getElementById(id); if (el) el.addEventListener('click', ()=>{ handler(); svg.focus(); }); }
safeOn('qcExportPNG', exportPNG);

/* Export PNG of current view */
async function exportPNG(){
  try {
    const vb = svg.viewBox.baseVal;
    const w = svg.clientWidth || Math.ceil(vb.width);
    const h = svg.clientHeight || Math.ceil(vb.height);
    const clone = svg.cloneNode(true);
    clone.removeAttribute('tabindex');
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob)=>{
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'hexmap.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      }, 'image/png');
    };
    img.src = url;
  } catch (err) { alert('PNG export failed: ' + err.message); }
}

/* ---------- Token helpers ---------- */
function addTokenAtViewCenter(label='MECH', colorIndex=0){
  const vb = svg.viewBox.baseVal;
  const px = vb.x + (vb.width/2);
  const py = vb.y + (vb.height/2);
  const cell = pixelToCell(px, py);
  const id = String(Date.now()) + Math.random().toString(16).slice(2,6);
  const tok = { id, q: clamp(cell.q,0,cols-1), r: clamp(cell.r,0,rows-1), scale: 1, angle: 0, colorIndex, label };
  tokens.push(tok);
  selectedTokenId = id;
  requestRender(); saveLocal();
  return id;
}
function getSelected(){ return tokens.find(t => t.id === selectedTokenId) || null; }
function rotateToken(delta){ const t = getSelected(); if (!t) return; t.angle = ((t.angle||0) + delta) % 360; if (t.angle < 0) t.angle += 360; requestRender(); saveLocal(); }
function resizeToken(f){ const t = getSelected(); if (!t) return; t.scale = clamp((t.scale||1) * f, 0.4, 2.0); requestRender(); saveLocal(); }
function cycleTeam(dir){ const t = getSelected(); if (!t) return; const len = TEAMS.length; t.colorIndex = ((t.colorIndex||0) + dir + len) % len; requestRender(); saveLocal(); }
function renameToken(){ const t = getSelected(); if (!t) return; const name = prompt('Token label:', t.label || ''); if (name !== null) { t.label = name.trim().slice(0,24) || 'MECH'; requestRender(); saveLocal(); } }
function deleteToken(){ const t = getSelected(); if (!t) return; tokens = tokens.filter(x => x.id !== t.id); mechMeta.delete(t.id); selectedTokenId = null; renderMechList(); renderInit(); requestRender(); saveLocal(); }

/* ---------- Presets ----------
const TER = { GRASS:0, ROCK:1, WATER:2, SAND:3, ASPHALT:4, URBAN:5 };
const COV = { NONE:0, LIGHT:1, MED:2, HEAVY:3 };

function buildFlatData(c, r, ter = TER.GRASS){
  const arr = [];
  for (let rr=0; rr<r; rr++) for (let qq=0; qq<c; qq++)
    arr.push({ q:qq, r:rr, h:0, ter, cov:0 });
  return arr;
}
function idx(q,r,c){ return r*c+q; }

function addRiver(data, c, r, {meander=0.30, width=1} = {}){
  let x = Math.floor(c/2);
  for (let y=0; y<r; y++){
    for (let w=-Math.floor(width/2); w<=Math.floor(width/2); w++){
      const q = Math.max(0, Math.min(c-1, x+w));
      const i = idx(q,y,c);
      data[i].ter = TER.WATER; data[i].h = 0; data[i].cov = COV.NONE;
      for (const side of [-1, +1]){
        const x2 = Math.max(0, Math.min(c-1, q+side));
        const j  = idx(x2,y,c);
        if (data[j].ter !== TER.WATER) data[j].ter = TER.SAND;
      }
    }
    if (Math.random() < meander) x += (Math.random()<0.5?-1:1);
    x = Math.max(1, Math.min(c-2, x));
  }
}
function addLake(data, c, r, {cx, cy, rx=4, ry=3}){
  for (let y=0; y<r; y++){
    for (let x=0; x<c; x++){
      const nx = (x-cx)/rx, ny = (y-cy)/ry;
      if (nx*nx + ny*ny <= 1.0){
        const i = idx(x,y,c);
        data[i].ter = TER.WATER; data[i].h = 0; data[i].cov = COV.NONE;
      } else if (nx*nx + ny*ny <= 1.35){
        const i = idx(x,y,c);
        if (data[i].ter !== TER.WATER) data[i].ter = TER.SAND;
      }
    }
  }
}
function addRidge(data, c, r, {x0=3, x1, baseH=1, crownH=3}){
  x1 = x1 ?? (c-4);
  for (let y=0; y<r; y++){
    const t = y/(r-1);
    const x = Math.round(x0*(1-t) + x1*t);
    for (let dx=-1; dx<=1; dx++){
      const q = Math.max(0, Math.min(c-1, x+dx));
      const i = idx(q,y,c);
      data[i].ter = TER.ROCK;
      data[i].h = (dx===0 ? crownH : baseH);
      data[i].cov = (dx===0 ? COV.MED : COV.LIGHT);
    }
  }
}
function addCrater(data, c, r, {cx, cy, radius=3, ringH=2}){
  for (let y=0; y<r; y++){
    for (let x=0; x<c; x++){
      const d = Math.hypot(x-cx, y-cy);
      if (d <= radius){
        const i = idx(x,y,c);
        data[i].ter = TER.ROCK;
        const rim = Math.abs(d - (radius-0.8));
        data[i].h = (rim<0.9) ? ringH : -1;
        data[i].cov = COV.LIGHT;
      }
    }
  }
}
function addCityBlocks(data, c, r, {blockW=4, blockH=3, gap=1}){
  for (let y=0; y<r; y++){
    for (let x=0; x<c; x++){
      const inRoad = ((x % (blockW+gap)) >= blockW) || ((y % (blockH+gap)) >= blockH);
      const i = idx(x,y,c);
      if (inRoad){
        data[i].ter = TER.ASPHALT; data[i].h = 0; data[i].cov = COV.NONE;
      } else {
        data[i].ter = TER.URBAN;   data[i].h = 0; data[i].cov = COV.HEAVY;
      }
    }
  }
}
function sprinkleCover(data, c, r, {density=0.06, kind=COV.LIGHT}){
  const n = Math.floor(c*r*density);
  for (let k=0; k<n; k++){
    const x = Math.floor(Math.random()*c);
    const y = Math.floor(Math.random()*r);
    const i = idx(x,y,c);
    if (data[i].ter !== TER.WATER) data[i].cov = Math.max(data[i].cov, kind);
  }
}

const PRESETS = {
  neoprene_31x17:         { meta:{ cols:31, rows:17, hexSize:120 }, data:null, tokens:[] },
  paper_15x17:            { meta:{ cols:15, rows:17, hexSize:120 }, data:null, tokens:[] },
  double_neoprene_62x17:  { meta:{ cols:62, rows:17, hexSize:120 }, data:null, tokens:[] },
  four_paper_30x34:       { meta:{ cols:30, rows:34, hexSize:120 }, data:null, tokens:[] },

  neoprene_31x17_grasslands: {
    meta:{ cols:31, rows:17, hexSize:120 },
    data:(() => {
      const c=31, r=17; const d=buildFlatData(c,r,TER.GRASS);
      sprinkleCover(d,c,r,{ density:0.08, kind:COV.LIGHT });
      return d;
    })(),
    tokens:[]
  },

  neoprene_31x17_river_valley: {
    meta:{ cols:31, rows:17, hexSize:120 },
    data:(() => {
      const c=31, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addRiver(d,c,r,{ meander:0.35, width: Math.max(1, Math.round(c*0.03)) });
      sprinkleCover(d,c,r,{ density:0.05, kind:COV.LIGHT });
      return d;
    })(),
    tokens:[]
  },

  neoprene_31x17_crater_field: {
    meta:{ cols:31, rows:17, hexSize:120 },
    data:(() => {
      const c=31, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addCrater(d,c,r,{
        cx: Math.round(c*0.26), cy: Math.round(r*0.35),
        radius: Math.max(2, Math.round(Math.min(c,r)*0.14)), ringH:2
      });
      addCrater(d,c,r,{
        cx: Math.round(c*0.58), cy: Math.round(r*0.62),
        radius: Math.max(3, Math.round(Math.min(c,r)*0.20)), ringH:2
      });
      sprinkleCover(d,c,r,{ density:0.04, kind:COV.MED });
      return d;
    })(),
    tokens:[]
  },

  neoprene_31x17_ridge_and_stream: {
    meta:{ cols:31, rows:17, hexSize:120 },
    data:(() => {
      const c=31, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addRidge(d,c,r,{
        x0: Math.round(c*0.16),
        x1: Math.round(c*0.84),
        baseH:1, crownH:3
      });
      addRiver(d,c,r,{ meander:0.25, width:1 });
      sprinkleCover(d,c,r,{ density:0.05, kind:COV.LIGHT });
      return d;
    })(),
    tokens:[]
  },

  neoprene_31x17_city_block: {
    meta:{ cols:31, rows:17, hexSize:120 },
    data:(() => {
      const c=31, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addCityBlocks(d,c,r,{
        blockW: Math.max(3, Math.round(c*0.13)),
        blockH: Math.max(3, Math.round(r*0.18)),
        gap: 1
      });
      return d;
    })(),
    tokens:[]
  },

  paper_15x17_island_lake: {
    meta:{ cols:15, rows:17, hexSize:120 },
    data:(() => {
      const c=15, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addLake(d,c,r,{
        cx: Math.round(c*0.55),
        cy: Math.round(r*0.48),
        rx: Math.max(3, Math.round(c*0.33)),
        ry: Math.max(3, Math.round(r*0.24))
      });
      sprinkleCover(d,c,r,{ density:0.06, kind:COV.LIGHT });
      return d;
    })(),
    tokens:[]
  },

  paper_15x17_quarry: {
    meta:{ cols:15, rows:17, hexSize:120 },
    data:(() => {
      const c=15, r=17; const d=buildFlatData(c,r,TER.GRASS);
      addRidge(d,c,r,{
        x0: Math.max(1, Math.round(c*0.10)),
        x1: Math.min(c-2, Math.round(c*0.80)),
        baseH:0, crownH:2
      });
      addCrater(d,c,r,{
        cx: Math.round(c*0.70),
        cy: Math.round(r*0.70),
        radius: Math.max(3, Math.round(Math.min(c,r)*0.22)),
        ringH:2
      });
      for (let y = Math.round(r*0.60); y < r; y++){
        for (let x = Math.round(c*0.55); x < c; x++){
          const i = idx(x,y,c);
          d[i].ter = TER.ROCK;
          d[i].h = Math.max(d[i].h, 1);
        }
      }
      return d;
    })(),
    tokens:[]
  }
};
*/
/* ---------- Unified state applier (presets/import/local) ---------- */
function applyState(obj){
  try{
    const meta = obj.meta || {};
    cols    = Number.isFinite(meta.cols)    ? meta.cols    : cols;
    rows    = Number.isFinite(meta.rows)    ? meta.rows    : rows;
    hexSize = Number.isFinite(meta.hexSize) ? meta.hexSize : hexSize;

    elCols.value = cols;
    elRows.value = rows;
    elHex.value  = hexSize;

    // rebuild tile grid
    tiles.clear();
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++){
      tiles.set(key(q,r), { q, r, height:0, terrainIndex:0, coverIndex:0 });
    }

    // paint incoming data onto grid
    if (Array.isArray(obj.data)) {
      obj.data.forEach(d => {
        const k = key(d.q, d.r);
        const t = tiles.get(k);
        if (!t) return;
        t.height       = Number.isFinite(d.h)   ? d.h   : 0;
        t.terrainIndex = Number.isFinite(d.ter) ? d.ter : 0;
        t.coverIndex   = Number.isFinite(d.cov) ? d.cov : 0;
      });
    }

    // tokens
    tokens = Array.isArray(obj.tokens) ? obj.tokens.map(t => ({
      id: t.id || (String(Date.now()) + Math.random().toString(16).slice(2,6)),
      q: clamp(t.q ?? 0, 0, cols-1),
      r: clamp(t.r ?? 0, 0, rows-1),
      scale: clamp(t.scale ?? 1, 0.4, 2),
      angle: ((t.angle ?? 0) % 360 + 360) % 360,
      colorIndex: ((t.colorIndex ?? 0) % TEAMS.length + TEAMS.length) % TEAMS.length,
      label: (t.label || 'MECH').slice(0, 24)
    })) : [];

// structures
structures = Array.isArray(obj.structures) ? obj.structures.map(s => ({
  id: s.id || (String(Date.now()) + Math.random().toString(16).slice(2,6)),
  q: clamp(s.q ?? 0, 0, cols-1),
  r: clamp(s.r ?? 0, 0, rows-1),
  angle: ((s.angle ?? 0) % 360 + 360) % 360,
  scale: clamp(s.scale ?? 1, 0.2, 3),
  height: Number.isFinite(s.height) ? s.height : 0,
  type: String(s.type || ''),
  name: String(s.name || ''),
  fill: String(s.fill || ''),
  shapes: Array.isArray(s.shapes) ? s.shapes : []
})) : [];

    
    // mech meta
    mechMeta.clear();
    if (obj.mechMeta && typeof obj.mechMeta === 'object') {
      for (const [id, m] of Object.entries(obj.mechMeta)) mechMeta.set(id, m);
    }

    // initiative (flat fields)
    if (Array.isArray(obj.initOrder)) {
      initOrder = obj.initOrder.map(o => ({ id: o.id, roll: o.roll }));
    } else {
      initOrder = [];
    }
    initIndex = Number.isFinite(obj.initIndex) ? obj.initIndex : -1;

    // reset transient UI
    selectedTokenId = null;
    measurement = null;
    losSource = null;
    camera.inited = false;

    renderMechList();
    renderInit();
rebuildStructLOSCache();
requestRender();
if (losActive) recomputeLOS();
    
    // Apply incoming per-token sheets (push-to-talk)
    if (obj && obj.sheets && typeof obj.sheets === 'object'){
      const mapId = CURRENT_MAP_ID || 'local';
      const open = (window.MSS84_SHEET && typeof MSS84_SHEET.getIds === 'function') ? MSS84_SHEET.getIds() : null;
      for (const [tid, data] of Object.entries(obj.sheets)){
        try {
          localStorage.setItem(`mss84:sheet:${mapId}:${tid}`, JSON.stringify(data));
          if (open && open.mapId === mapId && open.tokenId === tid && typeof MSS84_SHEET.setIds === 'function'){
            MSS84_SHEET.setIds(mapId, tid);
          }
        } catch(e){ console.warn('Incoming sheet apply failed', tid, e); }
      }
    }
saveLocal();
  } catch (err){
    console.error('applyState failed', err);
    alert('Failed to load state/preset.');
  }
}
/* Hook the select to apply presets
if (elPresets) elPresets.addEventListener('change', (e)=>{
  const id = e.target.value;
  if (!id) return;
  const p = PRESETS[id];
  if (!p) return;
  const obj = p.data ? p : { meta: p.meta, data: buildFlatData(p.meta.cols, p.meta.rows), tokens: [] };
  applyState(obj);
});
*/

/* ---------- Dice (2d6) ---------- */
document.querySelectorAll('[data-dice="2d6"]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const d1 = Math.floor(Math.random()*6)+1;
    const d2 = Math.floor(Math.random()*6)+1;
    const sum = d1+d2;
    if (diceOut) diceOut.textContent = `🎲 2d6: ${d1} + ${d2} = ${sum}`;
  });
});

/* ---------- Mech panel logic ---------- */
function teamNameToColorIndex(teamName){
  const map = { 'Alpha': 1, 'Bravo': 0, 'Clan': 4, 'Merc': 3 };
  return map[teamName] ?? 0;
}
function shortLabel(name){ return (name||'MECH').slice(0, 18); }

async function addMechFromForm(){
  const rawInput = (mechName?.value || '').trim();
  const { tokenLabel, displayName, model } = resolveMech(rawInput);

  const pilot = (pilotName?.value || '').trim();
  const team  = (teamSelect?.value || 'Alpha');
  const colorIndex = teamNameToColorIndex(team);

  const id = addTokenAtViewCenter(tokenLabel, colorIndex);   // token shows short code
  mechMeta.set(id, { name: displayName, model, pilot, team });
// Map this token to a mech reference for the compiler (per map & token)
try {
  const mechRef = model || displayName || tokenLabel || '';
  if (mechRef) {
    localStorage.setItem(`mss84:token:${CURRENT_MAP_ID}:${id}:mechRef`, mechRef);
  }
} catch {}
  renderMechList();
  renderInit();
  // NEW: pre-seed this token's sheet from mech JSON (static fields)
await seedSheetFromManifestIfNeeded(CURRENT_MAP_ID, tok.id, {
  displayName: String(mechNameInput?.value || tok.label || ''),
  model:       String(mechListData?.selectedOptions?.[0]?.label || '')
});

// Re-render (also updates MV badges)
refreshMovementBadges();

  saveLocal();  // persist immediately

  if (mechName) mechName.value = '';
  if (pilotName) pilotName.value = '';
}
if (btnAddMech) btnAddMech.addEventListener('click', addMechFromForm);
// allow Enter key in mechName field
mechName?.addEventListener('keydown', e => { if (e.key === 'Enter') addMechFromForm(); });

function renderMechList(){
  if (!mechList) return;
  mechList.replaceChildren();
  tokens.forEach(t => {
    const meta = mechMeta.get(t.id) || { name: t.label, pilot:'', team:'Alpha' };
    const li = document.createElement('li');
    li.dataset.id = t.id;
    li.innerHTML = `
      <div class="row between">
        <div>
          <strong>${meta.name || t.label || 'MECH'}</strong>
          ${meta.pilot ? `<div class="small muted">Pilot: ${meta.pilot}</div>` : ''}
          <div class="small muted">Team: ${meta.team || '—'}</div>
        </div>
        <div class="mini-actions">
          <button class="btn sm" data-act="select" title="Select">◎</button>
          <button class="btn sm" data-act="center" title="Center">◉</button>
          <button class="btn sm" data-act="sheet"  title="Open Sheet">📄</button>
          <button class="btn sm" data-act="turnL">⟲</button>
          <button class="btn sm" data-act="turnR">⟳</button>
          <button class="btn sm" data-act="bigger">＋</button>
          <button class="btn sm" data-act="smaller">－</button>
          <button class="btn sm" data-act="delete">🗑</button>
        </div>
      </div>
    `;
    mechList.appendChild(li);
  });
}
if (mechList) mechList.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if (!btn) return;
  const li = e.target.closest('li'); if (!li) return;
  const id = li.dataset.id;
  const tok = tokens.find(t => t.id === id); if (!tok) return;

  switch (btn.dataset.act) {
    case 'select':
      selectedTokenId = id; requestRender(); break;
    case 'center': {
      const c = tileCenter(tok.q, tok.r);
      const vb = svg.viewBox.baseVal;
      camera.x = c.x - (vb.width/2);
      camera.y = c.y - (vb.height/2);
      camera.setViewBox();
      break;
    }
case 'sheet': {
  if (!window.MSS84_SHEET) break;

  // Ensure the compiler has a mechRef for this token before opening the sheet
  try {
    const meta = mechMeta.get(id) || {};
    const mechRef = meta.model || meta.name || tok.label || '';
    if (mechRef) {
      localStorage.setItem(`mss84:token:${CURRENT_MAP_ID}:${id}:mechRef`, mechRef);
    }
  } catch {}

  const cur = MSS84_SHEET.getIds?.() || {};
  const isSame = (cur.mapId === CURRENT_MAP_ID && cur.tokenId === id);

  if (isSame) {
    // If we’re already viewing this token’s sheet, toggle (close if open)
    MSS84_SHEET.toggle?.();
  } else {
    // Switch context to this token and open
    MSS84_SHEET.setIds(CURRENT_MAP_ID, id);
    MSS84_SHEET.refresh?.();   // hydrate in case mechRef just got set
    MSS84_SHEET.open?.();
  }
  break;
}
    case 'turnL': tok.angle = ((tok.angle||0) - 60 + 360) % 360; requestRender(); saveLocal(); break;
    case 'turnR': tok.angle = ((tok.angle||0) + 60) % 360; requestRender(); saveLocal(); break;
    case 'bigger': tok.scale = clamp((tok.scale||1) * 1.10, 0.4, 2.0); requestRender(); saveLocal(); break;
    case 'smaller': tok.scale = clamp((tok.scale||1) / 1.10, 0.4, 2.0); requestRender(); saveLocal(); break;
    case 'delete':
      tokens = tokens.filter(x => x.id !== id);
      mechMeta.delete(id);
      if (selectedTokenId === id) selectedTokenId = null;
      renderMechList(); renderInit(); requestRender(); saveLocal();
      break;
  }
});

/* ---------- Mech index (manifest-driven: uses items[]) ---------- */
let MANIFEST_INDEX = [];
const mechByModel     = new Map();   // "ARC-2K" -> "Archer ARC-2K"
const mechByName      = new Map();   // "archer arc-2k" -> "ARC-2K"
const movementByModel = new Map();   // "ARC-2K" -> {walk, jump}
const manifestByModel = new Map();   // "ARC-2K" -> full item

async function loadMechIndex(){
  try{
    // Try multiple locations so we don't have to rewrite the 2,600-line file:
    // 1) data/manifest.json (your current location)
    // 2) assets/manifest.json (older builds)
    // 3) manifest.json (root, if ever moved)
    async function tryFetch(paths){
      for (const p of paths){
        try {
          const r = await fetch(p, { cache: 'no-store' });
          if (r.ok) return r;
        } catch(_) {}
      }
      throw new Error('manifest.json not found in data/, assets/, or root');
    }

    const res = await tryFetch([
      'data/manifest.json',
      'assets/manifest.json',
      'manifest.json'
    ]);
    const root = await res.json(); // { generated, count, items: [...] }
    const list = Array.isArray(root) ? root : (Array.isArray(root?.items) ? root.items : []);
    MANIFEST_INDEX = list;

    mechByModel.clear();
    mechByName.clear();
    movementByModel.clear();
    manifestByModel.clear();

    const dl = document.getElementById('mechListData');
    if (dl) dl.replaceChildren();

    list.forEach(row => {
      const model   = String(row?.model || '').toUpperCase().trim();
      const display = String(row?.displayName || model || '').trim();
      if (!model || !display) return;

      mechByModel.set(model, display);
      mechByName.set(display.toLowerCase(), model);
      movementByModel.set(model, {
        walk: Number(row?.movement?.walk) || 0,
        jump: Number(row?.movement?.jump) || 0
      });
      manifestByModel.set(model, row);

      if (dl){
        const opt = document.createElement('option');
        opt.value = display;    // user sees "Archer ARC-2K"
        opt.label = model;      // shows ARC-2K hint
        dl.appendChild(opt);
      }
    });

    // repaint now that MV exists
    (typeof refreshMovementBadges === 'function') ? refreshMovementBadges() : requestRender?.();

  }catch(err){
    console.warn('[manifest] load failed', err);
  }
}
loadMechIndex();

// Seed per-token sheet from manifest/mech JSON (static fields only)
async function seedSheetFromManifestIfNeeded(mapId, tokenId, { displayName, model } = {}) {
  try {
    const mid = mapId || (typeof CURRENT_MAP_ID !== 'undefined' ? CURRENT_MAP_ID : 'local');
    const tid = tokenId;
    if (!tid) return;

    // If the sheet already exists locally, do nothing.
    const sheetKey = `mss84:sheet:${mid}:${tid}`;
    if (localStorage.getItem(sheetKey)) return;

    // Resolve manifest row by model (preferred) or by display name.
    let row = null;
    if (model && manifestByModel.has(model.toUpperCase())) {
      row = manifestByModel.get(model.toUpperCase());
    } else if (displayName && mechByName.has(displayName.toLowerCase())) {
      const m = mechByName.get(displayName.toLowerCase());
      row = manifestByModel.get(m);
    }
    if (!row) return;

    // Resolve path and apply data/ fallback
    let path = row?.path || row?.file || row?.url || '';
    if (!path) return;
    if (!path.startsWith('data/')) path = `data/${path}`;

    // Fetch mech json
    let mech = null;
    try { mech = await (await fetch(path, { cache: 'no-store' })).json(); } catch {}
    if (!mech) return;

    // Build an initial static sheet (dynamic fields start empty)
    const armorMax = mech?.armor || mech?.Armor || {};
    const mv = mech?.movement || mech?.Movement || {};
    const sinks = mech?.heatSinks ?? mech?.heat?.sinks ?? 0;

    function pick(...ks){ for (const k of ks){ if (mech && mech[k]!=null) return mech[k]; } return ''; }

    const seed = {
      v: 1,
      mech: {
        chassis: pick('chassis','Chassis'),
        variant: pick('variant','Variant'),
        tons: Number(pick('tonnage','Tonnage','tons')) || 0
      },
      movement: {
        stand: 0,
        walk: Number(mv.walk||0),
        run:  Number(mv.run||0),
        jump: Number(mv.jump||0)
      },
      heat: {
        current: 0,
        sinks: Number(sinks||0)
      },
      armor: {
        HD: { cur: Number(armorMax.HD||armorMax.Head||0), max: Number(armorMax.HD||armorMax.Head||0) },
        CT: { cur: Number(armorMax.CT||armorMax['Center Torso']||0), max: Number(armorMax.CT||armorMax['Center Torso']||0), rr: Number(armorMax.CTR||armorMax['CT_RR']||armorMax['CT Rear']||0) },
        LT: { cur: Number(armorMax.LT||armorMax['Left Torso']||0),   max: Number(armorMax.LT||armorMax['Left Torso']||0),   rr: Number(armorMax.LTR||armorMax['LT_RR']||armorMax['LT Rear']||0) },
        RT: { cur: Number(armorMax.RT||armorMax['Right Torso']||0),  max: Number(armorMax.RT||armorMax['Right Torso']||0),  rr: Number(armorMax.RTR||armorMax['RT_RR']||armorMax['RT Rear']||0) },
        LA: { cur: Number(armorMax.LA||armorMax['Left Arm']||0),     max: Number(armorMax.LA||armorMax['Left Arm']||0) },
        RA: { cur: Number(armorMax.RA||armorMax['Right Arm']||0),    max: Number(armorMax.RA||armorMax['Right Arm']||0) },
        LL: { cur: Number(armorMax.LL||armorMax['Left Leg']||0),     max: Number(armorMax.LL||armorMax['Left Leg']||0) },
        RL: { cur: Number(armorMax.RL||armorMax['Right Leg']||0),    max: Number(armorMax.RL||armorMax['Right Leg']||0) },
      },
      weapons: Array.isArray(mech.weapons || mech.Weapons) ? (mech.weapons || mech.Weapons).map(w => ({
        name: w.name || w.Name || '',
        type: w.type || w.Type || '',
        dmg:  Number(w.damage || w.Damage || 0),
        heat: Number(w.heat   || w.Heat   || 0),
        min:  Number(w.min    || w.Min    || 0),
        s:    Number(w.short  || w.Short  || 0),
        m:    Number(w.medium || w.Medium || 0),
        l:    Number(w.long   || w.Long   || 0),
        ammo: {
          max: Number(w?.ammo?.max || w.Ammo || 0),
          cur: Number(w?.ammo?.max || w.Ammo || 0)
        }
      })) : [],
      equipment: { boards: {} }, // leave crit boards empty; user fills via UI
      pilot: { name: '', callsign: '', gunnery: 4, piloting: 5, hits: [] },
      notes: ''
    };

    localStorage.setItem(sheetKey, JSON.stringify(seed));
    // Mark this token as dirty so first Transmit will carry dynamic edits (pilot, ammo, etc.)
    try {
      const k = `mss84:sheets:dirty:${mid}`;
      const cur = JSON.parse(localStorage.getItem(k) || '{}');
      cur[tid] = true;
      localStorage.setItem(k, JSON.stringify(cur));
    } catch {}
  } catch (e) {
    console.warn('seedSheetFromManifestIfNeeded skipped:', e);
  }
}


/* ---------- Helpers: resolve typed input -> model + display ---------- */
function resolveMech(input){
  const raw = (input||'').trim();
  if (!raw) return { tokenLabel:'MECH', displayName:'MECH', model:null };

  // exact displayName hit
  const byNameModel = mechByName.get(raw.toLowerCase());
  if (byNameModel) {
    return {
      tokenLabel: byNameModel,
      displayName: mechByModel.get(byNameModel) || raw,
      model: byNameModel
    };
  }

  // model-ish: "ARC2K" -> "ARC-2K"
  const up = raw.toUpperCase().replace(/\s+/g,'');
  const normalizedModel = up.replace(/^([A-Z]{2,5})-?(\d.*)$/, '$1-$2');
  if (mechByModel.has(normalizedModel)) {
    return {
      tokenLabel: normalizedModel,
      displayName: mechByModel.get(normalizedModel),
      model: normalizedModel
    };
  }

  // fallback
  return { tokenLabel: raw.slice(0,18).toUpperCase(), displayName: raw, model:null };
}

/* Initiative (2d6 simple) */
function renderInit(){
  if (!initList) return;
  initList.replaceChildren();
  if (!initOrder.length){
    // clear map and badges if no order
    initRolls.clear();
    refreshInitBadges();
    return;
  }

  // rebuild the id -> roll map from initOrder
  initRolls = new Map(initOrder.map(e => [e.id, e.roll]));

  initOrder.forEach((entry, idx) => {
    const tok = tokens.find(t => t.id === entry.id);
    if (!tok) return;
    const meta = mechMeta.get(entry.id) || { name: tok.label };
    const li = document.createElement('li');
    if (idx === initIndex) li.classList.add('current');
    li.innerHTML = `<strong>${meta.name || tok.label}</strong> — roll: <em>${entry.roll}</em>`;
    initList.appendChild(li);
  });

  // repaint badges after updating the list
  refreshInitBadges();
}

function roll2d6(){ return (Math.floor(Math.random()*6)+1) + (Math.floor(Math.random()*6)+1); }

if (btnRollInitAll) btnRollInitAll.addEventListener('click', ()=>{
  initOrder = tokens
    .map(t => ({ id: t.id, roll: roll2d6() }))
    .sort((a,b)=> b.roll - a.roll);
  initIndex = initOrder.length ? 0 : -1;
  renderInit(); // this rebuilds initRolls + badges
});

if (btnClearInit) btnClearInit.addEventListener('click', ()=>{
  initOrder = []; initIndex = -1;
  renderInit(); // clears map + badges
});

if (btnNextTurn) btnNextTurn.addEventListener('click', ()=>{
  if (!initOrder.length) return;
  initIndex = (initIndex + 1) % initOrder.length;
  renderInit(); // flips 'is-current' highlight
});

// --- Initiative badge renderer ---
// parentG: token's <g> (origin at token center)
// roll: number | null
// r: token radius (px)
function renderInitBadge(parentG, roll){
  const old = parentG.querySelector('.init-badge');
  if (old) old.remove();
  if (roll == null || roll === '' || Number.isNaN(+roll)) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const badge = document.createElementNS(svgNS, 'g');
  badge.setAttribute('class', 'init-badge');

  // place it center-bottom relative to token radius
  const r = Number(parentG.dataset.rtok) || 24;
  badge.setAttribute('transform', `translate(0,${r * 1.1})`);

  const c = document.createElementNS(svgNS, 'circle');
  c.setAttribute('r', 12);   // base size (CSS can scale up)
  badge.appendChild(c);

  const t = document.createElementNS(svgNS, 'text');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.textContent = String(roll);
  badge.appendChild(t);

  parentG.appendChild(badge);
}

// --- Movement lookup from manifest-driven meta ---
function getMovementForToken(id){
  const meta = mechMeta.get(id) || {};
  let model = meta?.model ? String(meta.model).toUpperCase() : '';

  // try to infer from token label or pretty name
  if (!model) {
    const tok = tokens.find(t => t.id === id);
    const labelGuess = tok?.label ? tok.label.toUpperCase().replace(/\s+/g,'').replace(/^([A-Z]{2,5})-?(\d.*)$/, '$1-$2') : '';
    const nameGuess  = meta?.name ? mechByName.get(String(meta.name).toLowerCase()) : '';

    model = (labelGuess && mechByModel.has(labelGuess)) ? labelGuess
          : (nameGuess || '');

    if (model) mechMeta.set(id, { ...meta, model }); // cache for next time
  }

  if (!model) return null;
  const mv = movementByModel.get(model);
  if (!mv) return null;

  const walk = Number(mv.walk) || 0;
  const jump = Number(mv.jump) || 0;
  const run  = Math.ceil(walk * 1.5);
  return { walk, run, jump };
}

// Choose: 'pill' (default) or 'triad'
const MOVE_BADGE_STYLE = 'pill';

// --- Safe refresher used after token add/import (prevents missing-fn crash) ---
function refreshMovementBadges() {
  try {
    // Re-render everything; the mv badges are drawn during token render
    requestRender?.();
  } catch (e) {
    console.warn('refreshMovementBadges: skipped', e);
  }
}

// --- Movement badge (TOP) ---
function renderMoveBadge(parentG, movement, rTok){
  const old = parentG.querySelector('.move-badge');
  if (old) old.remove();

  const svgNS = 'http://www.w3.org/2000/svg';
  const r = Number(rTok) || Number(parentG.dataset.rtok) || 24;

  const badge = document.createElementNS(svgNS, 'g');
  badge.setAttribute('class', 'move-badge pill');
  badge.setAttribute('transform', `translate(0,${-r * 1.12})`);

  const label = movement
    ? `${movement.walk}/${movement.run}/${movement.jump}`
    : '—/—/—';

  // Background rectangle (CSS controls its size)
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('class','mv-pill-bg');
  rect.setAttribute('x', -40);  // anchor centered (width/height from CSS)
  rect.setAttribute('y', -14);
  rect.setAttribute('width', 80);
  rect.setAttribute('height', 28);
  rect.setAttribute('rx', 14);
  rect.setAttribute('ry', 14);
  badge.appendChild(rect);

  // Text (CSS controls font)
  const t = document.createElementNS(svgNS,'text');
  t.setAttribute('class','mv-pill-text');
  t.setAttribute('text-anchor','middle');
  t.setAttribute('dominant-baseline','central');
  t.textContent = label;
  badge.appendChild(t);

  parentG.appendChild(badge);
}


// Holds the latest initiative roll per token id
let initRolls = new Map(); // id -> number

function getInitRollFor(id){
  return initRolls.get(id);
}

// Repaint all badges to match initOrder/initIndex
function refreshInitBadges(){
  if (!gTokens) return;
  const currentId = (initOrder && initOrder.length && initIndex >= 0)
    ? initOrder[initIndex].id : null;

  gTokens.querySelectorAll('g.token').forEach(g => {
    const id = g.dataset.id;
    const rTok = Number(g.dataset.rtok) || 24;
    const roll = initRolls.get(id);

    renderInitBadge(g, roll, rTok);

    // highlight the "current turn" token's badge
    const badge = g.querySelector(':scope > g.init-badge');
    if (badge) {
      if (id === currentId) badge.classList.add('is-current');
      else badge.classList.remove('is-current');
    }

    // preserve highlight through rotation / re-render
    if (id === currentId) g.classList.add('turn-active');
    else g.classList.remove('turn-active');
  });
}



/* Export/Import for mech roster only */
if (btnExportMechs) btnExportMechs.addEventListener('click', ()=>{
  const out = tokens.map(t => ({
    id: t.id, q:t.q, r:t.r, scale:t.scale, angle:t.angle, colorIndex:t.colorIndex,
    label: t.label, meta: mechMeta.get(t.id) || null
  }));
  const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mechs.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
});
if (btnImportMechs && importFile){
  btnImportMechs.addEventListener('click', ()=> importFile.click());
  importFile.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const arr = JSON.parse(r.result);
        if (!Array.isArray(arr)) throw new Error('Invalid file');
        arr.forEach(m=>{
          const id = (tokens.find(t=>t.id===m.id)) ? (String(Date.now())+Math.random().toString(16).slice(2,6)) : (m.id || (String(Date.now())+Math.random().toString(16).slice(2,6)));
          const tok = {
            id,
            q: clamp(m.q||0,0,cols-1),
            r: clamp(m.r||0,0,rows-1),
            scale: clamp(m.scale||1,0.4,2),
            angle: (m.angle||0)%360,
            colorIndex: (m.colorIndex||0)%TEAMS.length,
            label: (m.label || m.meta?.name || 'MECH').slice(0,24)
          };
          tokens.push(tok);
          if (m.meta) mechMeta.set(id, m.meta);
        });
        renderMechList(); requestRender(); saveLocal();
      } catch(err){ alert('Import failed: '+err.message); }
      importFile.value = '';
    };
    r.readAsText(f);
  });
}

/* ---------- Sidebar/Dock restore ---------- */
if (localStorage.getItem('hexmap_dockA_show') === '1') { dockA.classList.add('show'); if (frameA && !frameA.src) frameA.src = SHEETS_BASE; }
if (localStorage.getItem('hexmap_dockB_show') === '1') { dockB.classList.add('show'); if (frameB && !frameB.src) frameB.src = SHEETS_BASE; }
/* Flechs buttons in Mechs panel (optional) */
on('btnFlechsP1','click', () => {
  if (!dockA.classList.contains('show')) toggleDockA();
  if (frameA && !frameA.src) frameA.src = SHEETS_BASE;
  svg.focus();
});
on('btnFlechsP2','click', () => {
  if (!dockB.classList.contains('show')) toggleDockB();
  if (frameB && !frameB.src) frameB.src = SHEETS_BASE;
  svg.focus();
});

/* ---------- Boot overlay logic (always plays) ---------- */
(() => {
  const bootEl = document.getElementById('btBoot');
  if (!bootEl) return;

  const logEl  = document.getElementById('btLog');
  const barEl  = document.getElementById('btBar');
  const hintEl = document.getElementById('btHint');

  const LINES = [
    '[ROM]  BTRL-OS v2.8.9 • Chassis Interface Online',
    '[PWR]  Fusion Plant • Idle | Heatsinks: Nominal',
    '[I/O]  Neurohelmet Link • Green | PILOT ID: UNKNOWN',
    '[SNS]  Targeting & Tracking • CAL PASS',
    '[NAV]  Hex Grid Module • LOADED',
    '[MAP]  Terrain Textures • OK',
    '[TOK]  Token Subsystem • OK',
    '[LOS]  Line-of-Sight Solver • OK',
    '[MEM]  Local Save State • PRESENT',
    '[NET]  Sheets Dock • Ready',
    '[SYS]  All subsystems nominal.'
  ];

  let i = 0;
  function appendLine(line){
    if (!logEl) return;
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setProgress(p){
    if (!barEl) return;
    barEl.style.width = p + '%';
  }
  function nextLine(){
    if (i < LINES.length) {
      appendLine(LINES[i]);
      setProgress(Math.round(((i+1) / (LINES.length + 2)) * 100));
      i++;
      setTimeout(nextLine, 180 + Math.random()*120);
    } else {
      setTimeout(()=> setProgress(100), 200);
      if (hintEl) hintEl.textContent = 'PRESS ENTER TO DEPLOY • OR WAIT';
      enableDismiss();
      setTimeout(hideBoot, 650);
    }
  }
  function hideBoot(){ bootEl.classList.add('bt-hidden'); }
  function enableDismiss(){
    const off = (e)=>{ if (e.key === 'Enter') { hideBoot(); window.removeEventListener('keydown', off); } };
    window.addEventListener('keydown', off);
    bootEl.addEventListener('click', hideBoot, { once:true });
  }

  window.addEventListener('load', () => {
    if (logEl) logEl.textContent = '';
    if (barEl) barEl.style.width = '0%';
    nextLine();
  });
})();

/* ---------- Init ---------- */
if (!loadLocal()) { initTiles(); }
requestRender();
renderMechList();
svg && svg.focus();

/* ---------- Preset JSON (GH Pages) ---------- */

const APP_SCOPE = '/Battletech-Mobile-Skirmish/';            // repo path on github pages
const PRESET_BASE = `${APP_SCOPE}presets/`;
const PRESET_INDEX_URL = `${PRESET_BASE}index.json`;

async function loadPresetList() {
  try {
    const res = await fetch(PRESET_INDEX_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load presets index');
    const list = await res.json();

    const sel = document.getElementById('presets');
    if (!sel) return;

    // reset with placeholder
    sel.innerHTML = '<option value="">— Choose… —</option>';

    // add options from index.json
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.file;                  // filename (e.g., neoprene_31x17.json)
      opt.textContent = p.name || p.id;    // display label
      sel.appendChild(opt);
    }

    // change → fetch & apply
    sel.addEventListener('change', async (e) => {
      const file = e.target.value;
      if (!file) return;
      await applyPresetFromUrl(`${PRESET_BASE}${file}`);
      // return focus to stage for immediate input
      const svg = document.getElementById('svg');
      if (svg && typeof svg.focus === 'function') svg.focus();
    });

    // optional: auto-load via ?preset=id
    const qid = new URLSearchParams(location.search).get('preset');
    if (qid) {
      const hit = list.find(p => p.id === qid);
      if (hit) await applyPresetFromUrl(`${PRESET_BASE}${hit.file}`);
    }
  } catch (err) {
    console.error('[Presets] ', err);
  }
}

async function applyPresetFromUrl(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load preset ${url}`);
    const preset = await res.json();
    applyPreset(preset);
  } catch (err) {
    console.error('[Preset load] ', err);
    alert('Could not load preset.');
  }
}

/* ---------- Glue into your existing engine ---------- */
function applyPreset(preset) {
  if (!preset || typeof preset !== 'object') return;

  try {
    // 1) Normalize META exactly like export/import
    const g = preset.meta || preset.grid || {};
    const meta = {
      cols: Number.isFinite(+g.cols) ? +g.cols : +document.getElementById('cols')?.value || 0,
      rows: Number.isFinite(+g.rows) ? +g.rows : +document.getElementById('rows')?.value || 0,
      hexSize: Number.isFinite(+g.hexSize) ? +g.hexSize : +document.getElementById('hexSize')?.value || 0,
    };

    // 2) Normalize DATA to short keys [{q,r,h,ter,cov}]
    const raw = Array.isArray(preset.data)
      ? preset.data
      : (Array.isArray(preset.tiles) ? preset.tiles : []);

    const data = raw.map(t => ({
      q: +(t.q ?? t.c ?? t.col ?? t.x),
      r: +(t.r ?? t.row ?? t.y),
      h: +(t.h ?? t.height ?? t.elevation ?? 0),
      ter: +(t.ter ?? t.terrain ?? t.type ?? 0),
      cov: +(t.cov ?? t.cover ?? 0),
    })).filter(t => Number.isFinite(t.q) && Number.isFinite(t.r));

    // 3) Tokens / mechMeta pass-through
    const tokens = Array.isArray(preset.tokens) ? preset.tokens : [];
    const mechMeta = (preset.mechMeta && typeof preset.mechMeta === 'object') ? preset.mechMeta : {};

    // 4) Build state and try the same path as Import
    const state = { meta, data, tokens, mechMeta };

    // Debug preview (shows in DevTools if you need it)
    console.log('[Preset] normalized →', { meta, samples: data.slice(0, 3), tokens: tokens.length });

    if (typeof applyState === 'function') {
      applyState(state); // primary path (should match Import behavior exactly)
    } else {
      throw new Error('applyState not found');
    }

  } catch (errPrimary) {
    console.warn('[Preset] applyState failed, falling back to manual paint:', errPrimary);

    // ------ Fallback path: resize UI, regen, paint, redraw ------
    const g = preset.meta || preset.grid || {};
    const elCols = document.getElementById('cols');
    const elRows = document.getElementById('rows');
    const elHex  = document.getElementById('hexSize');

    if (g.cols && elCols) elCols.value = Number(g.cols);
    if (g.rows && elRows) elRows.value = Number(g.rows);
    if (g.hexSize && elHex) elHex.value = Number(g.hexSize);

    if (typeof regenerateGrid === 'function') regenerateGrid();
    else if (typeof window.regen === 'function') window.regen();

    const raw = Array.isArray(preset.data)
      ? preset.data
      : (Array.isArray(preset.tiles) ? preset.tiles : []);

    // Normalize to long keys for painter
    const tiles = raw.map(t => ({
      q: +(t.q ?? t.c ?? t.col ?? t.x),
      r: +(t.r ?? t.row ?? t.y),
      terrain: +(t.terrain ?? t.ter ?? t.type ?? 0),
      height: +(t.height ?? t.h ?? t.elevation ?? 0),
      cover: +(t.cover ?? t.cov ?? 0),
    })).filter(t => Number.isFinite(t.q) && Number.isFinite(t.r));

    // Write via engine API if available, and also patch backing store aliases
    for (const t of tiles) {
      if (typeof setHexProps === 'function') {
        setHexProps(t.q, t.r, { terrain: t.terrain, height: t.height, cover: t.cover });
      } else if (typeof paintHex === 'function') {
        paintHex(t.q, t.r, t.terrain, t.height, t.cover);
      }

      const k = (typeof key === 'function') ? key(t.q, t.r) : `${t.q},${t.r}`;
      const tile = (window.tiles?.get?.(k)) || window.grid?.[t.r]?.[t.q] || window.board?.at?.(t.r)?.[t.q];
      if (tile) {
        tile.terrain = tile.type = tile.ter = t.terrain;
        tile.height = tile.elevation = tile.h = tile.z = t.height;
        tile.cover = tile.cov = t.cover;
      }

      if (typeof updateHexVisual === 'function') updateHexVisual(t.q, t.r);
      if (typeof styleHex === 'function') styleHex(t.q, t.r);
    }

    // Tokens on fallback
    if (Array.isArray(preset.tokens) && preset.tokens.length) {
      if (typeof clearTokens === 'function') clearTokens();
      if (typeof importTokens === 'function') importTokens(preset.tokens);
    }

    // Visual toggles & redraw
    if (typeof setTexturesEnabled === 'function') setTexturesEnabled(true);
    if (typeof recalcShading === 'function') recalcShading();
    if (typeof recomputeLOS === 'function') recomputeLOS();
    if (typeof redrawWorld === 'function') redrawWorld();
    if (typeof redraw === 'function') redraw();
  }

  // 5) Optional overrides (keep as-is)
  if (preset.overrides && typeof preset.overrides === 'object') {
    const o = preset.overrides;
    if (typeof setShowCoords === 'function' && 'showCoords' in o) setShowCoords(!!o.showCoords);
    if (typeof setTexturesEnabled === 'function' && 'textures' in o) setTexturesEnabled(o.textures !== 'off');
    if (typeof setLabelsEnabled === 'function' && 'labels' in o) setLabelsEnabled(o.labels !== 'off');
  }

  // 6) Legacy blob ONLY if data is a string
  if (typeof preset.data === 'string' && typeof loadSerializedMap === 'function') {
    try { loadSerializedMap(preset.data); } catch (e) { console.warn('[Preset] Legacy blob failed', e); }
  }
}


// Kick off after DOM ready/boot
window.addEventListener('load', loadPresetList);

// Safe helper used by sheet.js to get a token's current label
window.getTokenLabelById = function(mapId, tokenId){
  try{
    const t = tokens?.get?.(tokenId) || tokens?.find?.(x => x.id === tokenId) || null;
    return t?.label || t?.name || '';
  }catch{ return ''; }
};


/* ===== ONLINE GLUE (full-state on demand) ===== */
(function () {
  // ----- Receive full-state snapshot from Firebase -----
  function wireReceive() {
    if (!window.Net) return;
    Net.onSnapshot = (stateObj) => {
      try {
        applyState(stateObj);
        if (typeof requestRender === 'function') requestRender();
      } catch (e) {
        console.warn(e);
      }
    };
  }

  // ----- Send full-state snapshot to Firebase via "Transmit" button -----
  function wireSend() {
    const btn = document.getElementById('btnSend');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      try {
        if (!window.Net || typeof Net.sendSnapshot !== 'function') {
          alert('Not online yet. Click Online and join a room first.');
          return;
        }

        const obj = JSON.parse(serializeState());
        const sheets = collectDirtySheetsForTransmit(CURRENT_MAP_ID);
        if (Object.keys(sheets).length) obj.sheets = sheets;

        // diff vs last transmit for the battle log
        const prev =
          window._lastSentSnapshot ||
          JSON.parse(sessionStorage.getItem('mss_last_tx') || 'null') ||
          {};
        const events = (window.BattleLog?.summarizeDiff(prev, obj)) || [];

        await Net.sendSnapshot(obj);

        if (window.BattleLog) {
          const title = events.length
            ? `Transmit: ${events.length} change${events.length === 1 ? '' : 's'}`
            : 'Transmit';
          BattleLog.postEvents(events, title);
        }

        window._lastSentSnapshot = obj;
        try {
          sessionStorage.setItem('mss_last_tx', JSON.stringify(obj));
        } catch {}

        alert('Sent.');
      } catch (e) {
        alert(e?.message || 'Send failed.');
      }
    });
  }

  // === Real-time sheet sync (per-token) ===========================
  // We are *not* auto-sending on every keystroke anymore (you turned that off),
  // but we still need to LISTEN for remote sheet updates.
  const sheetSendTimers = Object.create(null);

  function setupSheetRealtimeSync() {
    // Network → local: apply incoming sheet updates and reload if open
    window.addEventListener("mss84:sheetRemoteUpdate", (ev) => {
      const detail = ev.detail || {};
      const { mapId, tokenId, sheet } = detail;
      if (!mapId || !tokenId || !sheet) return;

      const storageKey = `mss84:sheet:${mapId}:${tokenId}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(sheet));
      } catch (e) {
        console.warn("[mss84:sheetRemoteUpdate] localStorage failed", e);
      }

      // If this sheet is currently open, re-hydrate it
      if (window.MSS84_SHEET &&
          typeof MSS84_SHEET.getIds === "function" &&
          typeof MSS84_SHEET.setIds === "function") {
        const open = MSS84_SHEET.getIds();
        if (open && open.mapId === mapId && open.tokenId === tokenId) {
          MSS84_SHEET.setIds(mapId, tokenId);
        }
      }
    });

    // Whenever we join a room, start the sheet listener
    window.addEventListener("net-room", () => {
      if (!window.Net || typeof Net.subscribeSheets !== "function") return;
      try { Net.subscribeSheets(); } catch (e) { console.warn(e); }
    });

    // If we're already online when this file loads, hook immediately
    if (window.Net && typeof Net.subscribeSheets === "function" && Net.roomId) {
      try { Net.subscribeSheets(); } catch (e) { console.warn(e); }
    }
  }

  // ----- Init this block -----
  setupSheetRealtimeSync();

  // hook up now + when networking announces readiness
  wireReceive();
  window.addEventListener('net-ready', wireReceive);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSend);
  } else {
    wireSend();
  }
})();


// Keep CSS --header-h synced to the real toolbar height (so drawers/stage align)
(() => {
  const root = document.documentElement;
  const header = document.querySelector('.ui-topbar');

  function syncHeaderH() {
    if (!header) return;
    const h = Math.ceil(header.getBoundingClientRect().height);
    root.style.setProperty('--header-h', h + 'px');
  }

  // Update on load, resize, and whenever the header wraps/resizes
  window.addEventListener('load', syncHeaderH);
  window.addEventListener('resize', syncHeaderH);
  if ('ResizeObserver' in window && header) {
    new ResizeObserver(syncHeaderH).observe(header);
  }

  syncHeaderH();
})();























