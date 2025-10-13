/* ui.terrainMenu.js
   Minimal module that owns:
   - Left panel buttons (select/height/terrain/cover/clear)
   - Fixed Paint selectors (terrain/height/cover + paint/clear)
   - Fill Terrain dropdown + button
   - Undo/Redo stacks for tile edits (height/terrain/cover)
   - Tool mode state + paint helpers (cycle/apply/reset)

   Integration:
   1) Call TerrainMenu.mount(core) with:
      {
        tiles, key, TERRAINS, COVERS,
        get mapLocked(){...}, requestRender(), saveLocal()
      }

   2) In your script.js pointer handlers, replace references:
      - toolMode            -> TerrainMenu.getToolMode()
      - setToolMode(x)      -> TerrainMenu.setToolMode(x)
      - beginStroke()       -> TerrainMenu.beginStroke()
      - recordEdit(q,r,p,n) -> TerrainMenu.recordEdit(q,r,p,n)
      - endStroke()         -> TerrainMenu.endStroke()
      - undo()/redo()       -> TerrainMenu.undo()/TerrainMenu.redo()
      - paintHex(tile)      -> TerrainMenu.paintHex(tile)
      - fixedPaint object   -> TerrainMenu.fixedPaint (read/write)

   3) Keep your render() as-is. This module only mutates tiles and asks for repaint.
*/
(function (global) {
  const svgNS = 'http://www.w3.org/2000/svg';

  const TerrainMenu = {
    // ---- wired in mount ----
    core: null,

    // ---- public state/API ----
    fixedPaint: { terrainIndex: 0, height: 0, coverIndex: 0 },
    getToolMode() { return toolMode; },
    setToolMode, beginStroke, recordEdit, endStroke, undo, redo, paintHex,

    // convenience for other code paths (e.g., a "Fill Map" button elsewhere)
    fillMapWithTerrain,

    // mount wires all left-panel controls (safe if some elements don’t exist)
    mount(core) {
      this.core = core;

      // cache DOM
      el.selPaintTerrain = document.getElementById('selPaintTerrain');
      el.selPaintHeight  = document.getElementById('selPaintHeight');
      el.selPaintCover   = document.getElementById('selPaintCover');
      el.btnPaintFixed   = document.getElementById('btnPaintFixed');
      el.btnClearFixed   = document.getElementById('btnClearFixed');

      el.btnSelect = document.getElementById('btnSelect');
      el.btnHeight = document.getElementById('btnHeight');
      el.btnTerrain= document.getElementById('btnTerrain');
      el.btnCover  = document.getElementById('btnCover');
      el.btnClear  = document.getElementById('btnClearTile');

      el.elFillTerrain  = document.getElementById('fillTerrain');
      el.btnFillTerrain = document.getElementById('btnFillTerrain');

      el.btnUndo = document.getElementById('btnUndo');
      el.btnRedo = document.getElementById('btnRedo');

      // init selectors & listeners
      initFixedPaintSelectors();
      wireSelectors();
      wireToolButtons();
      wireFillTerrain();
      wireUndoRedo();

      // default tool
      setToolMode('select');
    },
  };

  // ---------- private module state ----------
  const el = {};
  const UNDO_LIMIT = 50;
  const undoStack = [];
  const redoStack = [];

  let toolMode = 'select';     // 'select' | 'height' | 'terrain' | 'cover' | 'clear' | 'paintFixed'
  let brushMode = null;        // 'height' | 'terrain' | 'cover' | 'reset' | 'sample' | 'fixed'
  let sample = null;
  let paintedThisStroke = null;
  let currentStroke = null;

  // ---------- helpers ----------
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function on(elOrId, ev, fn) {
    const node = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (node) node.addEventListener(ev, fn);
    return node;
  }

  // ---------- UI wiring ----------
  function wireToolButtons() {
    // tool buttons may be missing in some layouts—guard each
    el.btnSelect && el.btnSelect.addEventListener('click', () => setToolMode('select'));
    el.btnHeight && el.btnHeight.addEventListener('click', () => setToolMode('height'));
    el.btnTerrain&& el.btnTerrain.addEventListener('click', () => setToolMode('terrain'));
    el.btnCover  && el.btnCover.addEventListener('click',  () => setToolMode('cover'));
    el.btnClear  && el.btnClear.addEventListener('click',  () => setToolMode('clear'));

    el.btnPaintFixed && el.btnPaintFixed.addEventListener('click', () => {
      setToolMode(toolMode === 'paintFixed' ? 'select' : 'paintFixed');
    });

    el.btnClearFixed && el.btnClearFixed.addEventListener('click', () => {
      if (el.selPaintTerrain) el.selPaintTerrain.value = 0;
      if (el.selPaintHeight)  el.selPaintHeight.value  = 0;
      if (el.selPaintCover)   el.selPaintCover.value   = 0;
      TerrainMenu.fixedPaint = { terrainIndex: 0, height: 0, coverIndex: 0 };
      setToolMode('paintFixed');
    });
  }

  function wireSelectors() {
    el.selPaintTerrain?.addEventListener('change', () => {
      TerrainMenu.fixedPaint.terrainIndex = +el.selPaintTerrain.value || 0;
    });
    el.selPaintHeight?.addEventListener('change', () => {
      TerrainMenu.fixedPaint.height = +el.selPaintHeight.value || 0;
    });
    el.selPaintCover?.addEventListener('change', () => {
      TerrainMenu.fixedPaint.coverIndex = +el.selPaintCover.value || 0;
    });
  }

  function wireFillTerrain() {
    const core = TerrainMenu.core;
    // populate dropdown from core.TERRAINS if present
    if (el.elFillTerrain && core && Array.isArray(core.TERRAINS)) {
      el.elFillTerrain.replaceChildren();
      core.TERRAINS.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = t.name;
        el.elFillTerrain.appendChild(opt);
      });
    }
    el.btnFillTerrain && el.btnFillTerrain.addEventListener('click', () => {
      const idx = +el.elFillTerrain.value;
      if (!Number.isFinite(idx)) { el.elFillTerrain?.focus(); return; }
      fillMapWithTerrain(idx);
      el.elFillTerrain.value = '';
    });
    el.elFillTerrain && el.elFillTerrain.addEventListener('change', () => {
      const idx = +el.elFillTerrain.value;
      if (Number.isFinite(idx)) {
        fillMapWithTerrain(idx);
        el.elFillTerrain.value = '';
      }
    });
  }

  function wireUndoRedo() {
    el.btnUndo && el.btnUndo.addEventListener('click', () => { undo(); });
    el.btnRedo && el.btnRedo.addEventListener('click', () => { redo(); });
  }

  function initFixedPaintSelectors() {
    const core = TerrainMenu.core;
    // Terrain
    if (el.selPaintTerrain && core && Array.isArray(core.TERRAINS)) {
      el.selPaintTerrain.replaceChildren();
      core.TERRAINS.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = t.name;
        el.selPaintTerrain.appendChild(opt);
      });
      el.selPaintTerrain.value = String(TerrainMenu.fixedPaint.terrainIndex);
    }
    // Cover
    if (el.selPaintCover && core && Array.isArray(core.COVERS)) {
      el.selPaintCover.replaceChildren();
      core.COVERS.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = c;
        el.selPaintCover.appendChild(opt);
      });
      el.selPaintCover.value = String(TerrainMenu.fixedPaint.coverIndex);
    }
    // Height
    if (el.selPaintHeight) {
      el.selPaintHeight.replaceChildren();
      for (let h = -3; h <= 5; h++) {
        const opt = document.createElement('option');
        opt.value = String(h);
        opt.textContent = String(h);
        el.selPaintHeight.appendChild(opt);
      }
      el.selPaintHeight.value = String(TerrainMenu.fixedPaint.height);
    }
  }

  // ---------- Tool mode ----------
  function setToolMode(mode) {
    toolMode = mode;
    // toggle button aria/active classes if they exist
    const map = {
      select: el.btnSelect,
      height: el.btnHeight,
      terrain: el.btnTerrain,
      cover: el.btnCover,
      clear: el.btnClear,
    };
    Object.entries(map).forEach(([k, btn]) => {
      if (!btn) return;
      const on = (k === mode);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('active', on);
    });
    if (el.btnPaintFixed) {
      const onFixed = (mode === 'paintFixed');
      el.btnPaintFixed.setAttribute('aria-pressed', onFixed ? 'true' : 'false');
      el.btnPaintFixed.classList.toggle('active', onFixed);
    }
    brushMode = null; sample = null; paintedThisStroke = null;
  }

  // ---------- Stroke / Undo ----------
  function pushUndo(action) {
    undoStack.push(action);
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  function beginStroke() {
    currentStroke = { type: 'batch', edits: [] };
  }
  function recordEdit(q, r, prev, next) {
    if (!currentStroke) beginStroke();
    // skip no-ops
    if (prev.h === next.h && prev.ter === next.ter && prev.cov === next.cov) return;
    currentStroke.edits.push({ q, r, prev, next });
  }
  function endStroke() {
    if (currentStroke && currentStroke.edits.length) pushUndo(currentStroke);
    currentStroke = null;
    TerrainMenu.core?.requestRender?.();
    TerrainMenu.core?.saveLocal?.();
  }
  function applyEdits(edits, usePrev) {
    const core = TerrainMenu.core;
    if (!core) return;
    for (const e of edits) {
      const t = core.tiles.get(core.key(e.q, e.r));
      if (!t) continue;
      const src = usePrev ? e.prev : e.next;
      t.height = src.h; t.terrainIndex = src.ter; t.coverIndex = src.cov;
    }
    core.requestRender?.();
  }
  function undo() {
    const core = TerrainMenu.core;
    if (!core || core.mapLocked) return;
    const a = undoStack.pop(); if (!a) return;
    if (a.type === 'batch') applyEdits([...a.edits].reverse(), true);
    redoStack.push(a);
    core.saveLocal?.();
  }
  function redo() {
    const core = TerrainMenu.core;
    if (!core || core.mapLocked) return;
    const a = redoStack.pop(); if (!a) return;
    if (a.type === 'batch') applyEdits(a.edits, false);
    undoStack.push(a);
    core.saveLocal?.();
  }

  // ---------- Tile mutators ----------
  function cycleHeight(t) {
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    t.height = (t.height >= 5) ? -3 : t.height + 1;
    const next = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    recordEdit(t.q, t.r, prev, next);
  }
  function cycleTerrain(t) {
    const core = TerrainMenu.core;
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    const n = (core?.TERRAINS?.length || 1);
    t.terrainIndex = (t.terrainIndex + 1) % n;
    const next = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    recordEdit(t.q, t.r, prev, next);
  }
  function cycleCover(t) {
    const core = TerrainMenu.core;
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    const n = (core?.COVERS?.length || 1);
    t.coverIndex = (t.coverIndex + 1) % n;
    const next = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    recordEdit(t.q, t.r, prev, next);
  }
  function resetTile(t) {
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    t.height = 0; t.terrainIndex = 0; t.coverIndex = 0;
    const next = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    recordEdit(t.q, t.r, prev, next);
  }
  function applySampleTo(t, sam) {
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    t.height = sam.h; t.terrainIndex = sam.ter; t.coverIndex = sam.cov;
    const next = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    recordEdit(t.q, t.r, prev, next);
  }
  function applyFixedToTile(t) {
    const fp = TerrainMenu.fixedPaint;
    const prev = { h: t.height, ter: t.terrainIndex, cov: t.coverIndex };
    const next = { h: fp.height, ter: fp.terrainIndex, cov: fp.coverIndex };
    if (prev.h === next.h && prev.ter === next.ter && prev.cov === next.cov) return;
    t.height = next.h; t.terrainIndex = next.ter; t.coverIndex = next.cov;
    recordEdit(t.q, t.r, prev, next);
  }

  // ---------- Paint entry point (used by your SVG pointer code) ----------
  // Expects a tile object: {q,r,height,terrainIndex,coverIndex}
  function paintHex(t) {
    const core = TerrainMenu.core;
    if (!core || !t) return;
    const k = core.key(t.q, t.r);
    if (paintedThisStroke && paintedThisStroke.has(k)) return;

    switch (brushMode) {
      case 'height':  cycleHeight(t); break;
      case 'terrain': cycleTerrain(t); break;
      case 'cover':   cycleCover(t); break;
      case 'reset':   resetTile(t); break;
      case 'sample':  if (sample) applySampleTo(t, sample); break;
      case 'fixed':   applyFixedToTile(t); break;
      default: return;
    }
    paintedThisStroke && paintedThisStroke.add(k);
    core.requestRender?.();
  }

  // ---------- Public utility: fill map with a terrain index ----------
  function fillMapWithTerrain(terrainIndex) {
    const core = TerrainMenu.core;
    if (!core) return;
    if (core.mapLocked) { alert('Map is locked. Unlock to edit terrain.'); return; }
    if (terrainIndex == null || Number.isNaN(+terrainIndex)) return;

    beginStroke();
    core.tiles.forEach(tile => {
      const prev = { h: tile.height, ter: tile.terrainIndex, cov: tile.coverIndex };
      tile.terrainIndex = +terrainIndex;
      const next = { h: tile.height, ter: tile.terrainIndex, cov: tile.coverIndex };
      recordEdit(tile.q, tile.r, prev, next);
    });
    endStroke();
  }

  // ---------- expose & attach ----------
  // small helpers so your pointerdown handler can set brushMode/sample in one place
  TerrainMenu._internal = {
    setBrushFromTool({ altEyedropper = false, tileForSample = null }) {
      // Called by your pointerdown when starting a paint stroke
      if (altEyedropper) {
        if (toolMode === 'paintFixed') {
          // copy tile into fixedPaint if present
          if (tileForSample) {
            TerrainMenu.fixedPaint.height       = tileForSample.height;
            TerrainMenu.fixedPaint.terrainIndex = tileForSample.terrainIndex;
            TerrainMenu.fixedPaint.coverIndex   = tileForSample.coverIndex;
            if (el.selPaintHeight)  el.selPaintHeight.value  = TerrainMenu.fixedPaint.height;
            if (el.selPaintTerrain) el.selPaintTerrain.value = TerrainMenu.fixedPaint.terrainIndex;
            if (el.selPaintCover)   el.selPaintCover.value   = TerrainMenu.fixedPaint.coverIndex;
          }
          brushMode = 'fixed';
        } else {
          sample = tileForSample
            ? { h: tileForSample.height, ter: tileForSample.terrainIndex, cov: tileForSample.coverIndex }
            : null;
          brushMode = 'sample';
        }
      } else {
        brushMode =
          toolMode === 'height'     ? 'height'  :
          toolMode === 'terrain'    ? 'terrain' :
          toolMode === 'cover'      ? 'cover'   :
          toolMode === 'clear'      ? 'reset'   :
          toolMode === 'paintFixed' ? 'fixed'   : null;
      }
      return brushMode;
    },
    startPaintStroke() {
      paintedThisStroke = new Set();
      beginStroke();
    },
    endPaintStroke() {
      brushMode = null; sample = null; paintedThisStroke = null;
      endStroke();
    }
  };

  // publish
  global.TerrainMenu = TerrainMenu;

})(window);
