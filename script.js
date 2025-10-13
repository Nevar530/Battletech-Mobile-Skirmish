/* ===== Hex Map Maker — Core (modules mounted: TerrainMenu, MechMenu) ===== */

/* ---------- Constants & Config ---------- */
const COVER_DARKEN = { None: 0, Light: -5, Medium: -10, Heavy: -15 };
const SHEETS_BASE = 'https://sheets.flechs.net/';
const svgNS = 'http://www.w3.org/2000/svg';

// Token size baseline
const TOKEN_BASE_SCALE = 0.80;

// LOS physics
const EYE_Z = 0.9;
const COVER_BLOCK_HEIGHT = [0, 0.4, 0.9, 1.4];
const LOS_EPS = 1e-4;

function getHexHeight(q, r) {
  const t = tiles.get(key(q, r));
  const h = (t && Number.isFinite(t.height)) ? t.height : 0;
  return Number.isFinite(h) ? h : 0; // preserves negatives
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

const COVERS = ['None','Light','Medium','Heavy'];
const COVER_ABBR = { None:'', Light:'| L1', Medium:'| M2', Heavy:'| H3' };

// Where to load mech indices from
const INDEX_BASE = 'assets/';

/* ---------- DOM ---------- */
const svg = document.getElementById('svg');
const defs = document.getElementById('tex-defs');
const frameBorder = document.getElementById('frameBorder');
const gPolys   = document.getElementById('world-polys');
const gTex     = document.getElementById('world-textures');
const gOver    = document.getElementById('world-overlays');
const gLabels  = document.getElementById('world-labels');
const gTokens  = document.getElementById('world-tokens');
const gMeasure = document.getElementById('measure-group');
const gLosRays = document.getElementById('los-rays');
const gLos     = document.getElementById('los-group');
const io = document.getElementById('io');

// Sidebar inputs
const elCols = document.getElementById('cols');
const elRows = document.getElementById('rows');
const elHex  = document.getElementById('hexSize');
const elLegend = document.getElementById('legendRadio');
const elPresets = document.getElementById('presets');

// Drawers (kept, but menu internals moved to modules)
const leftPanel  = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const toggleLeft = document.getElementById('toggleLeft');
const toggleRight= document.getElementById('toggleRight');
const closeLeft  = document.getElementById('closeLeft');
const closeRight = document.getElementById('closeRight');

// Top bar toggles + help
const btnLOS = document.getElementById('btnLOS') || document.getElementById('btnToggleLOS');
const btnMeasure = document.getElementById('btnMeasure') || document.getElementById('btnToggleMeasure');
const btnHelp = document.getElementById('btnHelp');
const helpPopup = document.getElementById('helpPopup');

// Optional hamburger + dice
const menuBtn   = document.getElementById('menuBtn');
const menuPopup = document.getElementById('menuPopup');
const diceOut = document.getElementById('diceOut');

// Docks
const dockA = document.getElementById('dockA');
const dockB = document.getElementById('dockB');
const frameA = document.getElementById('frameA');
const frameB = document.getElementById('frameB');
const btnDockL = document.getElementById('btnDockL');
const btnDockR = document.getElementById('btnDockR');

btnDockL && btnDockL.addEventListener('click', toggleDockA);
btnDockR && btnDockR.addEventListener('click', toggleDockB);

// Right-docked token controls (kept)
const tokenControls = document.getElementById('tokenControls');
const btnTurnLeft   = document.getElementById('btnTurnLeft');
const btnTurnRight  = document.getElementById('btnTurnRight');

btnTurnLeft && btnTurnLeft.addEventListener('click', () => rotateToken(-60));
btnTurnRight && btnTurnRight.addEventListener('click', () => rotateToken(+60));

/* ---------- State ---------- */
let cols = +elCols.value;
let rows = +elRows.value;
let hexSize = +elHex.value;

let tiles = new Map(); // key-> {q,r,height,terrainIndex,coverIndex}
const key = (q,r)=>`${q},${r}`;

let tokens = []; // {id,q,r,scale,angle,colorIndex,label}
let selectedTokenId = null;
let tokenDragId = null;

/* Mech metadata (right panel) */
const mechMeta = new Map(); // id -> {name, pilot, team, mv?, dataPath?}

/* Range / LOS / Measure */
let measurement = null; // {from:{q,r}, to:{q,r}, dist}
let losActive = false;
let losSource = null;
let measureMode = false;
let measureAnchor = null;

/* Map Lock */
let mapLocked = localStorage.getItem('hexmap_map_locked') === '1';

/* ---------- Helpers ---------- */
const clamp = (v,min,max)=> Math.max(min, Math.min(max,v));
function on(id, ev, fn){ const el = typeof id==='string' ? document.getElementById(id) : id; if (el) el.addEventListener(ev, fn); return el; }
function toSvgPoint(clientX, clientY){ const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }

/* ---------- Geometry ---------- */
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

/* ---------- Autosave ---------- */
function serializeState(){
  const meta = { cols, rows, hexSize };
  const data = [...tiles.values()].map(t => ({ q:t.q, r:t.r, h:t.height, ter:t.terrainIndex, cov:t.coverIndex }));
  const tok = tokens.map(t => ({ id:t.id, q:t.q, r:t.r, scale:t.scale, angle:t.angle, colorIndex:t.colorIndex, label:t.label }));
  const metaMap = {}; mechMeta.forEach((v, k) => { metaMap[k] = v; });

  // initiative fields removed from core (MechMenu manages UX)

  return JSON.stringify({ meta, data, tokens: tok, mechMeta: metaMap });
}
function saveLocal(){ try { localStorage.setItem('hexmap_autosave', serializeState()); } catch {} }
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

/* ---------- Patterns (kept) ---------- */
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

  // (same pattern builders as before) ...
  pat('pat-grass', u, u, (p)=>{ /* ... */ const g1=document.createElementNS(svgNS,'path'); g1.setAttribute('d',`M0 ${u*0.8} L ${u*0.8} 0`); g1.setAttribute('stroke', ink); g1.setAttribute('stroke-width', sw2); g1.setAttribute('fill','none'); const g2=document.createElementNS(svgNS,'path'); g2.setAttribute('d',`M${u*0.2} ${u} L ${u} ${u*0.2}`); g2.setAttribute('stroke', ink); g2.setAttribute('stroke-width', sw2); g2.setAttribute('fill','none'); p.append(g1,g2); });
  pat('pat-rock', u, u, (p)=>{ const a=document.createElementNS(svgNS,'path'); a.setAttribute('d',`M0 0 L ${u} ${u}`); a.setAttribute('stroke', inkBold); a.setAttribute('stroke-width', sw); a.setAttribute('fill','none'); const b=document.createElementNS(svgNS,'path'); b.setAttribute('d',`M${u} 0 L 0 ${u}`); b.setAttribute('stroke', ink); b.setAttribute('stroke-width', sw2); b.setAttribute('fill','none'); p.append(a,b); });
  pat('pat-water', u, u*0.6, (p)=>{ const y=(u*0.6)/2; const path=document.createElementNS(svgNS,'path'); path.setAttribute('d',`M0 ${y} C ${u*0.25} ${y-0.35*u}, ${u*0.75} ${y+0.35*u}, ${u} ${y}`); path.setAttribute('stroke', inkBold); path.setAttribute('stroke-width', sw2); path.setAttribute('fill','none'); p.append(path); });
  pat('pat-sand', u, u, (p)=>{ const mk=(cx,cy,r,op)=>{ const c=document.createElementNS(svgNS,'circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',Math.max(0.7,r)); c.setAttribute('fill','#00000028'); c.setAttribute('opacity',op); return c; }; p.append(mk(u*0.2,u*0.3, sw2*0.45, 1), mk(u*0.6,u*0.2, sw2*0.45, .9), mk(u*0.8,u*0.7, sw2*0.5, .7), mk(u*0.35,u*0.8, sw2*0.4, .8)); });
  pat('pat-asphalt', u, u, (p)=>{ const mk=(cx,cy,op)=>{ const c=document.createElementNS(svgNS,'circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',Math.max(0.5,u*0.05)); c.setAttribute('fill','#00000033'); c.setAttribute('opacity',op); return c; }; p.append(mk(u*0.25,u*0.30,.6), mk(u*0.65,u*0.20,.5), mk(u*0.75,u*0.70,.45), mk(u*0.35,u*0.75,.55)); const dash=document.createElementNS(svgNS,'path'); dash.setAttribute('d',`M ${-u*0.1} ${u*1.1} L ${u*1.1} ${-u*0.1}`); dash.setAttribute('stroke','#ffd24a66'); dash.setAttribute('stroke-width',Math.max(1,u*0.06)); dash.setAttribute('stroke-dasharray',`${(u*0.25).toFixed(2)}, ${(u*0.18).toFixed(2)}`); dash.setAttribute('fill','none'); p.append(dash); });
  pat('pat-urban', u, u, (p)=>{ const g1=document.createElementNS(svgNS,'path'); g1.setAttribute('d',`M 0 ${u*0.5} H ${u} M ${u*0.5} 0 V ${u}`); g1.setAttribute('stroke','#0000003a'); g1.setAttribute('stroke-width',Math.max(1,u*0.05)); g1.setAttribute('fill','none'); const g2=document.createElementNS(svgNS,'path'); g2.setAttribute('d',`M 0 ${u*0.25} H ${u} M ${u*0.25} 0 V ${u}`); g2.setAttribute('stroke','#00000022'); g2.setAttribute('stroke-width',Math.max(1,u*0.035)); g2.setAttribute('fill','none'); p.append(g1,g2); });
  pat('pat-snow', u, u, (p)=>{ const a=document.createElementNS(svgNS,'path'); a.setAttribute('d',`M0 ${u} L ${u} 0`); a.setAttribute('stroke','#bfc9d6'); a.setAttribute('stroke-width',sw2); a.setAttribute('opacity',0.4); a.setAttribute('fill','none'); const b=document.createElementNS(svgNS,'path'); b.setAttribute('d',`M0 0 L ${u} ${u}`); b.setAttribute('stroke','#d4dbe6'); b.setAttribute('stroke-width',sw2); b.setAttribute('opacity',0.3); b.setAttribute('fill','none'); p.append(a,b); });
  pat('pat-lava', u, u, (p)=>{ const crack=document.createElementNS(svgNS,'path'); crack.setAttribute('d',`M0 ${u*0.6} Q ${u*0.3} ${u*0.3}, ${u*0.6} ${u*0.7} T ${u} ${u*0.4}`); crack.setAttribute('stroke','#ff4500'); crack.setAttribute('stroke-width',sw2*1.4); crack.setAttribute('opacity',0.9); crack.setAttribute('fill','none'); const glow=document.createElementNS(svgNS,'path'); glow.setAttribute('d',`M0 ${u*0.8} Q ${u*0.4} ${u*0.5}, ${u*0.8} ${u*0.9}`); glow.setAttribute('stroke','#ffd54a'); glow.setAttribute('stroke-width',sw2); glow.setAttribute('opacity',0.7); glow.setAttribute('fill','none'); p.append(crack,glow); });
  pat('pat-moon', u, u, (p)=>{ function crater(cx,cy,r,op){ const c=document.createElementNS(svgNS,'circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r); c.setAttribute('fill','#888'); c.setAttribute('opacity',op); return c; } p.append(crater(u*0.25,u*0.25, sw*0.6, 0.6), crater(u*0.7,u*0.35, sw*0.8, 0.5), crater(u*0.5,u*0.75, sw*0.7, 0.4)); });
  pat('pat-ice', u, u, (p)=>{ const crack1=document.createElementNS(svgNS,'path'); crack1.setAttribute('d',`M0 ${u*0.3} L ${u} ${u*0.1}`); crack1.setAttribute('stroke','#7fcde8'); crack1.setAttribute('stroke-width',sw2); crack1.setAttribute('opacity',0.5); crack1.setAttribute('fill','none'); const crack2=document.createElementNS(svgNS,'path'); crack2.setAttribute('d',`M${u*0.2} ${u} L ${u*0.8} 0`); crack2.setAttribute('stroke','#a4dff2'); crack2.setAttribute('stroke-width',sw2*0.9); crack2.setAttribute('opacity',0.4); crack2.setAttribute('fill','none'); p.append(crack1,crack2); });
  pat('pat-volcanic', u, u, (p)=>{ function fleck(cx,cy,r,color,op){ const c=document.createElementNS(svgNS,'circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r); c.setAttribute('fill',color); c.setAttribute('opacity',op); return c; } p.append(fleck(u*0.2,u*0.3, sw*0.5, '#555', 0.6), fleck(u*0.7,u*0.4, sw*0.4, '#777', 0.5), fleck(u*0.4,u*0.7, sw*0.6, '#333', 0.7), fleck(u*0.8,u*0.2, sw*0.5, '#c33', 0.7)); });
  pat('pat-holo', u, u, (p) => { const vline=document.createElementNS(svgNS,'rect'); vline.setAttribute('x',0); vline.setAttribute('y',0); vline.setAttribute('width',u*0.15); vline.setAttribute('height',u); vline.setAttribute('fill','#00ff80'); vline.setAttribute('opacity',0.15); const diag=document.createElementNS(svgNS,'path'); diag.setAttribute('d',`M0,${u} L${u},0`); diag.setAttribute('stroke','#00ff80'); diag.setAttribute('stroke-width',u*0.05); diag.setAttribute('opacity',0.25); p.append(vline, diag); });
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

/* ===== Zoom buttons ===== */
on('btnZoomIn',  'click', () => zoomAtViewportCenter(1/1.15));
on('btnZoomOut', 'click', () => zoomAtViewportCenter(1.15));
function zoomAtViewportCenter(factor){
  const vb = svg.viewBox.baseVal;
  const cx = vb.x + vb.width  / 2;
  const cy = vb.y + vb.height / 2;
  camera.zoomAt({ x: cx, y: cy }, factor);
}

/* ---------- Drawer Toggles (panels only) ---------- */
if (toggleLeft)  toggleLeft.addEventListener('click', () => leftPanel.classList.toggle('collapsed'));
if (closeLeft)   closeLeft.addEventListener('click', () => leftPanel.classList.add('collapsed'));
if (toggleRight) toggleRight.addEventListener('click', () => rightPanel.classList.toggle('collapsed'));
if (closeRight)  closeRight.addEventListener('click', () => rightPanel.classList.add('collapsed'));

/* ---------- Help popup ---------- */
if (helpPopup) helpPopup.hidden = true;
if (btnHelp) btnHelp.addEventListener('click', () => { if (!helpPopup) return; helpPopup.hidden = !helpPopup.hidden; });

/* ---------- Top-bar LOS / Measure toggles ---------- */
function setBtnToggleState(btn, on){
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('active', !!on);
}
if (btnLOS) {
  btnLOS.addEventListener('click', () => {
    losActive = !losActive;
    setBtnToggleState(btnLOS, losActive);
    if (!losActive) clearLOS();
  });
}
if (btnMeasure) {
  btnMeasure.addEventListener('click', () => {
    measureMode = !measureMode;
    setBtnToggleState(btnMeasure, measureMode);
    if (!measureMode) { measureAnchor = null; clearMeasurement(); }
  });
}

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
window.requestRender = requestRender; // expose to modules

function render() {
  ensurePatterns();

  // clear layers
  gPolys.replaceChildren();
  gTex.replaceChildren();
  gOver.replaceChildren();
  gLabels.replaceChildren();
  gTokens.replaceChildren();
  gMeasure.replaceChildren();

  const size = hexSize;
  const geom = new Map();
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;

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

    // darken by |height| (no drop shadows anymore)
    const SCALE = 8;
    const MAX_OFFSET = 50;
    let brightnessOffset = -Math.min(MAX_OFFSET, Math.abs(t.height) * SCALE);
    const fillColor = adjustLightness(terrain.fill, brightnessOffset);
    const strokeW = Math.max(1, size * 0.03);

    poly.setAttribute('points', geom.get(key(t.q,t.r)).ptsStr);
    poly.setAttribute('class','hex');
    poly.setAttribute('fill', fillColor);
    poly.setAttribute('stroke', '#00000066');
    poly.setAttribute('stroke-width', strokeW);
    poly.dataset.q = t.q; poly.dataset.r = t.r;
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
    const r = (n>>16)&255, g = (n>>8)&255, b = (n)&255;
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

    // Optional init badge (if MechMenu exposed a getter)
    const roll = (typeof getInitRollFor === 'function') ? getInitRollFor(tok.id) : undefined;
    renderInitBadge(g, roll, rTok);

    // MV badge from mechMeta
    const meta = mechMeta.get(tok.id);
    renderMvBadge(g, meta?.mv || null, rTok);

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
}

/* ---------- Mv/Init badge helpers (core-side) ---------- */
function renderInitBadge(parentG, roll){
  const old = parentG.querySelector('.init-badge');
  if (old) old.remove();
  if (roll == null || roll === '' || Number.isNaN(+roll)) return;

  const badge = document.createElementNS(svgNS, 'g');
  badge.setAttribute('class', 'init-badge');

  const r = Number(parentG.dataset.rtok) || 24;
  badge.setAttribute('transform', `translate(0,${r * 1.1})`);

  const c = document.createElementNS(svgNS, 'circle');
  c.setAttribute('r', 12);
  badge.appendChild(c);

  const t = document.createElementNS(svgNS, 'text');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.textContent = String(roll);
  badge.appendChild(t);

  parentG.appendChild(badge);
}
function mvLabel(mv){
  if (!mv) return null;
  const walk = +(mv.walk ?? 0);
  const run  = +(mv.run  ?? Math.ceil(walk * 1.5));
  const jump = +(mv.jump ?? 0);
  return `${walk}/${run}/${jump}`;
}
function renderMvBadge(parentG, mv, rTok){
  const old = parentG.querySelector('.mv-badge');
  if (old) old.remove();
  const label = mvLabel(mv);
  if (!label) return;

  const badge = document.createElementNS(svgNS, 'g');
  badge.setAttribute('class', 'mv-badge');
  const r = Number(parentG.dataset.rtok) || (rTok || 24);
  badge.setAttribute('transform', `translate(${r * 0.95},${-r * 0.95})`);

  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('x', -18); rect.setAttribute('y', -10);
  rect.setAttribute('rx', 4);  rect.setAttribute('ry', 4);
  rect.setAttribute('width', 36); rect.setAttribute('height', 20);
  rect.setAttribute('class', 'mv-bg');
  badge.appendChild(rect);

  const t = document.createElementNS(svgNS, 'text');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('font-size', 10);
  t.textContent = label;
  badge.appendChild(t);

  parentG.appendChild(badge);
}

/* ---------- Token controls ---------- */
function updateTokenControls() {
  if (!tokenControls) return;
  const sel = getSelected();
  if (!sel) { tokenControls.style.display = 'none'; return; }
  const center = offsetToPixel(sel.q, sel.r, hexSize);
  const pt = svg.createSVGPoint();
  pt.x = center.x; pt.y = center.y;
  const screenPt = pt.matrixTransform(svg.getScreenCTM());

  tokenControls.style.left = (screenPt.x - 30) + 'px';
  tokenControls.style.top  = (screenPt.y - 30) + 'px';
  tokenControls.style.display = 'block';
}

/* ---------- Hex math ---------- */
function offsetToCube(q,r){ const x=q; const z = r - ((q - (q&1))>>1); const y = -x - z; return {x,y,z}; }
function cubeDistance(a,b){ return (Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z))/2; }
function cubeLerp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }; }
function cubeRound(frac){ let rx=Math.round(frac.x), ry=Math.round(frac.y), rz=Math.round(frac.z); const xdiff=Math.abs(rx-frac.x), ydiff=Math.abs(ry-frac.y), zdiff=Math.abs(rz-frac.z); if (xdiff>ydiff && xdiff>zdiff) rx=-ry-rz; else if (ydiff>zdiff) ry=-rx-rz; else rz=-rx-ry; return {x:rx,y:ry,z:rz}; }
function cubeLine(a,b){ const N=Math.max(1,cubeDistance(a,b)); const out=[]; for(let i=0;i<=N;i++){ const t=(1/N)*i+1e-6*i; out.push(cubeRound(cubeLerp(a,b,t))); } return out; }
function cubeToOffset(c){ const q=c.x; const r=c.z + ((c.x - (c.x&1))>>1); return {q,r}; }
function tileCenter(q,r){ const p=offsetToPixel(q,r,hexSize); return {x:p.x, y:p.y}; }

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

  const z0 = getHexHeight(losSource.q, losSource.r) + EYE_Z;

  tiles.forEach(t => {
    if (t.q === losSource.q && t.r === losSource.r) return;

    const tgtCube = offsetToCube(t.q, t.r);
    const line    = cubeLine(srcCube, tgtCube);

    const z1 = getHexHeight(t.q, t.r) + EYE_Z;
    let blocked = false;

    if (line.length > 2) {
      for (let i = 1; i < line.length - 1; i++) {
        const midOff = cubeToOffset(line[i]);
        const midT   = tiles.get(key(midOff.q, midOff.r));
        const ground = getHexHeight(midOff.q, midOff.r);
        const covIdx   = midT?.coverIndex ?? 0;
        const blockTop = ground + (COVER_BLOCK_HEIGHT[covIdx] || 0);
        const tParam = i / (line.length - 1);
        const zRay   = z0 + (z1 - z0) * tParam;
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

/* ---------- Painting / Interaction (integrated with TerrainMenu) ---------- */
let isSpaceHeld=false, isPanning=false, panLast=null;
let tokenDragActive=false;

function setCursor(){ if (isPanning) svg.style.cursor='grabbing'; else if (isSpaceHeld) svg.style.cursor='grab'; else svg.style.cursor='default'; }

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

  // Token selection/drag (only when not painting)
  if (tokElHit && e.button===0 && (TerrainMenu?.getToolMode?.() === 'select')) {
    e.preventDefault();
    selectedTokenId = tokElHit.dataset.id;
    tokenDragActive = true;
    tokenDragId = selectedTokenId;
    svg.setPointerCapture(e.pointerId);
    requestRender();
    return;
  }

  // Deselect if clicking empty space in select mode
  if (TerrainMenu?.getToolMode?.() === 'select' && !tokElHit && e.button===0) {
    selectedTokenId = null;
    requestRender();
  }

  // RANGE: selected token + right-click ⇒ range to target
  if (TerrainMenu?.getToolMode?.() === 'select' && e.button===2 && selectedTokenId) {
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

  // LOS click sets source (left)
  if (losActive && e.button===0 && !e.ctrlKey && hexElHit) {
    const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
    losSource = {q,r};
    recomputeLOS();
    return;
  }

  // --- LOCK: block mouse-driven tile edits while locked ---
  if (mapLocked) { e.preventDefault(); return; }

  // If in SELECT mode, never paint
  if (TerrainMenu?.getToolMode?.() === 'select') return;

  // Painting — defer to TerrainMenu to choose brush + stroke
  if (!hexElHit) return;
  e.preventDefault();
  const q = +hexElHit.dataset.q, r = +hexElHit.dataset.r;
  const t = tiles.get(key(q,r));

  TerrainMenu?._internal?.startPaintStroke();
  const alt = !!e.altKey;
  TerrainMenu?._internal?.setBrushFromTool({ altEyedropper: alt, tileForSample: t });
  TerrainMenu?.paintHex?.(t);
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', (e) => {
  const cur = toSvgPoint(e.clientX, e.clientY);

  if (isPanning) {
    camera.pan(panLast.x - cur.x, panLast.y - cur.y);
    panLast = cur;
    return;
  }

  if (tokenDragActive && tokenDragId) {
    const sel = tokens.find(t => t.id === tokenDragId);
    if (sel) {
      const cell = pixelToCell(cur.x, cur.y);
      sel.q = clamp(cell.q, 0, cols-1);
      sel.r = clamp(cell.r, 0, rows-1);
      requestRender();
    }
    return;
  }

  if (mapLocked) return;

  // live-paint hover
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const hexEl = target && target.closest ? target.closest('.hex') : null;
  if (!hexEl) return;
  const q = +hexEl.dataset.q, r = +hexEl.dataset.r;
  const t = tiles.get(key(q,r));
  TerrainMenu?.paintHex?.(t);
});

function endPointer(e){
  if (isPanning) {
    isPanning=false; panLast=null; setCursor();
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
  if (tokenDragActive) {
    tokenDragActive = false; tokenDragId = null;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    saveLocal();
    return;
  }
  TerrainMenu?._internal?.endPaintStroke?.();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('lostpointercapture', endPointer);
svg.addEventListener('contextmenu', (e)=> e.preventDefault());

/* ===== Touch pinch/pan + wheel zoom ===== */
const pointers = new Map();
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
  if (pointers.size < 2) { pinchStartDist = null; pinchStartScale = null; pinchCenterSvg = null; }
}
svg.addEventListener('pointerup', endTouch, { passive: true });
svg.addEventListener('pointercancel', endTouch, { passive: true });

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1/1.15 : 1.15;
  const pt = toSvgPoint(e.clientX, e.clientY);
  camera.zoomAt(pt, factor);
}, { passive:false });

/* ===== Recenter + Space pan ===== */
on('btnRecenter', 'click', () => { camera.reset(); svg.focus(); });
document.addEventListener('keydown', (e)=>{ if (e.code === 'Space') { isSpaceHeld=true; setCursor(); } });
document.addEventListener('keyup',   (e)=>{ if (e.code === 'Space') { isSpaceHeld=false; setCursor(); } });

/* ---------- View + docks ---------- */
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
  // Undo/Redo moved to TerrainMenu (its own buttons); keep camera keys here
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
  else if (e.key === 'q' || e.key === 'Q') { rotateToken(-60); }
  else if (e.key === 'e' || e.key === 'E') { rotateToken(+60); }
  else if (e.key === 'Enter') { renameToken(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { deleteToken(); }
});

/* ---------- Controls that remain in core ---------- */
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
  // Use TerrainMenu stroke helpers to keep undo consistent
  TerrainMenu?.beginStroke?.();
  tiles.forEach(t => {
    const prev={h:t.height,ter:t.terrainIndex,cov:t.coverIndex};
    t.height=0; t.terrainIndex=0; t.coverIndex=0;
    const next={h:t.height,ter:t.terrainIndex,cov:t.coverIndex};
    TerrainMenu?.recordEdit?.(t.q,t.r,prev,next);
  });
  TerrainMenu?.endStroke?.();
  clearLOS(); clearMeasurement();
});

/* ===== Export PNG of current view ===== */
on('qcExportPNG', exportPNG);
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
function deleteToken(){ const t = getSelected(); if (!t) return; tokens = tokens.filter(x => x.id !== t.id); mechMeta.delete(t.id); selectedTokenId = null; requestRender(); saveLocal(); }

/* ---------- Legend (kept minimal) ---------- */
function renderLegendRadios(){ if (!elLegend) return; elLegend.replaceChildren(); }
renderLegendRadios();

/* ---------- Unified state applier ---------- */
function applyState(obj){
  try{
    const meta = obj.meta || {};
    cols    = Number.isFinite(meta.cols)    ? meta.cols    : cols;
    rows    = Number.isFinite(meta.rows)    ? meta.rows    : rows;
    hexSize = Number.isFinite(meta.hexSize) ? meta.hexSize : hexSize;

    elCols.value = cols; elRows.value = rows; elHex.value  = hexSize;

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

    // mech meta
    mechMeta.clear();
    if (obj.mechMeta && typeof obj.mechMeta === 'object') {
      for (const [id, m] of Object.entries(obj.mechMeta)) mechMeta.set(id, m);
    }

    // reset transient UI
    selectedTokenId = null;
    measurement = null;
    losSource = null;
    camera.inited = false;

    // let MechMenu rebuild its side UI if present
    if (window.MechMenu && typeof MechMenu.onStateApplied === 'function') {
      MechMenu.onStateApplied();
    }

    requestRender();
    if (losActive) recomputeLOS();
    saveLocal();
  } catch (err){
    console.error('applyState failed', err);
    alert('Failed to load state/preset.');
  }
}

/* ---------- Dice (2d6) ---------- */
document.querySelectorAll('[data-dice="2d6"]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const d1 = Math.floor(Math.random()*6)+1;
    const d2 = Math.floor(Math.random()*6)+1;
    const sum = d1+d2;
    if (diceOut) diceOut.textContent = `🎲 2d6: ${d1} + ${d2} = ${sum}`;
  });
});

/* ---------- Presets loader (same behavior) ---------- */
const APP_SCOPE = '/Battletech-Mobile-Skirmish/';
const PRESET_BASE = `${APP_SCOPE}presets/`;
const PRESET_INDEX_URL = `${PRESET_BASE}index.json`;

async function loadPresetList() {
  try {
    const res = await fetch(PRESET_INDEX_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load presets index');
    const list = await res.json();

    const sel = document.getElementById('presets');
    if (!sel) return;

    sel.innerHTML = '<option value="">— Choose… —</option>';
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.file;
      opt.textContent = p.name || p.id;
      sel.appendChild(opt);
    }

    sel.addEventListener('change', async (e) => {
      const file = e.target.value;
      if (!file) return;
      await applyPresetFromUrl(`${PRESET_BASE}${file}`);
      svg?.focus?.();
    });

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

function applyPreset(preset) {
  if (!preset || typeof preset !== 'object') return;
  try {
    const g = preset.meta || preset.grid || {};
    const meta = {
      cols: Number.isFinite(+g.cols) ? +g.cols : +document.getElementById('cols')?.value || 0,
      rows: Number.isFinite(+g.rows) ? +g.rows : +document.getElementById('rows')?.value || 0,
      hexSize: Number.isFinite(+g.hexSize) ? +g.hexSize : +document.getElementById('hexSize')?.value || 0,
    };

    const raw = Array.isArray(preset.data) ? preset.data : (Array.isArray(preset.tiles) ? preset.tiles : []);
    const data = raw.map(t => ({
      q: +(t.q ?? t.c ?? t.col ?? t.x),
      r: +(t.r ?? t.row ?? t.y),
      h: +(t.h ?? t.height ?? t.elevation ?? 0),
      ter: +(t.ter ?? t.terrain ?? t.type ?? 0),
      cov: +(t.cov ?? t.cover ?? 0),
    })).filter(t => Number.isFinite(t.q) && Number.isFinite(t.r));

    const tokens = Array.isArray(preset.tokens) ? preset.tokens : [];
    const mechMeta = (preset.mechMeta && typeof preset.mechMeta === 'object') ? preset.mechMeta : {};

    const state = { meta, data, tokens, mechMeta };
    applyState(state);
  } catch (errPrimary) {
    console.warn('[Preset] applyState failed:', errPrimary);
  }
}

// Boot overlay (unchanged), network glue (unchanged) ...
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
  function appendLine(line){ if (!logEl) return; logEl.textContent += line + '\n'; logEl.scrollTop = logEl.scrollHeight; }
  function setProgress(p){ if (!barEl) return; barEl.style.width = p + '%'; }
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

// Mount modules (after DOM ready)
window.addEventListener('DOMContentLoaded', () => {
  // Terrain menu
  window.TerrainMenu?.mount({
    tiles, key, TERRAINS, COVERS,
    get mapLocked(){ return mapLocked; },
    requestRender,
    saveLocal,
  });

  // Mech menu
  window.MechMenu?.mount({
    tokens,
    mechMeta,
    addTokenAtViewCenter,
    requestRender,
    saveLocal,
    selectToken: (id) => { selectedTokenId = id; },
    centerOnToken: (tok) => {
      const c = tileCenter(tok.q, tok.r);
      const vb = svg.viewBox.baseVal;
      camera.x = c.x - (vb.width/2);
      camera.y = c.y - (vb.height/2);
      camera.setViewBox();
    },
    INDEX_BASE
  });

  svg && svg.focus();
});

// Presets
window.addEventListener('load', loadPresetList);

/* ---------- Dock restore + Flechs shortcuts ---------- */
if (localStorage.getItem('hexmap_dockA_show') === '1') { dockA.classList.add('show'); if (frameA && !frameA.src) frameA.src = SHEETS_BASE; }
if (localStorage.getItem('hexmap_dockB_show') === '1') { dockB.classList.add('show'); if (frameB && !frameB.src) frameB.src = SHEETS_BASE; }
on('btnFlechsP1','click', () => { if (!dockA.classList.contains('show')) toggleDockA(); if (frameA && !frameA.src) frameA.src = SHEETS_BASE; svg.focus(); });
on('btnFlechsP2','click', () => { if (!dockB.classList.contains('show')) toggleDockB(); if (frameB && !frameB.src) frameB.src = SHEETS_BASE; svg.focus(); });

/* ---------- Keep CSS --header-h synced ---------- */
(() => {
  const root = document.documentElement;
  const header = document.querySelector('.ui-topbar');
  function syncHeaderH() {
    if (!header) return;
    const h = Math.ceil(header.getBoundingClientRect().height);
    root.style.setProperty('--header-h', h + 'px');
  }
  window.addEventListener('load', syncHeaderH);
  window.addEventListener('resize', syncHeaderH);
  setTimeout(syncHeaderH, 50);
})();
