// modules/terrainMenu.js
// Custom element <terrain-menu>
// Owns: Terrain/paint tools, Fixed Paint, Fill Terrain, Presets, Grid settings
//
// ==== Expected Core surface (final step when you replace script.js) ====
// Core: {
//   // state
//   tiles: Map<key, {q,r,height,terrainIndex,coverIndex}>,
//   TERRAINS: Array<{name, fill, pat, opacity}>,
//   COVERS: string[],
//   grid: { get():{cols,rows,hexSize}, set({cols,rows,hexSize}) },
//   // editing
//   beginStroke(), recordEdit(q,r, prev, next), endStroke(),
//   requestRender(), saveLocal(),
//   // tool modes
//   setToolMode(mode:'select'|'height'|'terrain'|'cover'|'clear'|'paintFixed'),
//   // bulk helpers (optional but used if present)
//   fillMapWithTerrain?(terrainIndex:number): void,
//   applyPresetFromUrl?(url:string): Promise<void>,
//   // misc
//   undo(), redo()
// }
//
// If some methods don’t exist yet, the UI disables the relevant button(s) and logs a warning.

export function registerTerrainMenu(Core) {
  class TerrainMenu extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
      const css = /*css*/`
        :host{
          position:fixed; left:0;
          top:calc(var(--header-h,48px) + var(--app-top-offset, 0px));
          bottom:0; width:340px; z-index:20;
          transform:translateX(0);
        }
        .panel{
          position:absolute; inset:0;
          background:var(--panel,#121826);
          border-top:1px solid var(--border,#1f2a3a);
          box-shadow:0 0 24px rgba(0,0,0,.35);
          display:flex; flex-direction:column;
        }
        header{
          display:flex; align-items:center; justify-content:space-between;
          padding:10px; border-bottom:1px solid var(--border,#1f2a3a);
          background:#0f1722;
        }
        header h2{ margin:0; font-size:14px; letter-spacing:.06em }
        .body{ padding:10px; overflow:auto; display:flex; flex-direction:column; gap:12px; }

        .group{border:1px solid var(--border,#1f2a3a);border-radius:14px;padding:10px;background:#0f1522}
        .group h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#93a4b8)}
        .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .stack{display:flex;flex-direction:column;gap:4px;flex:1}
        .stack input,.stack select,textarea{
          background:#0c1220;border:1px solid var(--border,#1f2a3a);border-radius:10px;padding:8px;color:var(--ink,#e8eef6)
        }
        .btn{
          background:#1a2333;border:1px solid var(--border,#1f2a3a);border-radius:10px;padding:8px 10px;cursor:pointer;
          transition:filter .15s ease, transform .05s ease; color:var(--ink,#e8eef6);
        }
        .btn:hover{filter:brightness(1.06)} .btn:active{transform:translateY(1px)}
        .sm{padding:5px 8px;border-radius:8px;font-size:12px}
        .muted{color:var(--muted,#93a4b8);font-size:12px}
        .gap{gap:10px}
        .seg{display:flex;gap:8px;flex-wrap:wrap}
        .seg .btn[aria-pressed="true"]{ color:var(--bt-amber,#ffd06e); }
        .close{ background:#0f1722; border:1px solid var(--border,#1f2a3a); width:36px; height:36px; border-radius:10px; }
      `;

      const html = /*html*/`
        <div class="panel" role="complementary" aria-label="Terrain / Grid / Tools">
          <header>
            <h2>Terrain Tools</h2>
            <button class="close" id="btnHide" title="Hide">✕</button>
          </header>
          <div class="body">

            <!-- Quick Tools -->
            <section class="group">
              <h3>Quick Tools</h3>
              <div class="seg">
                <button class="btn" id="toolSelect"  aria-pressed="true">Select/Move</button>
                <button class="btn" id="toolHeight">Height</button>
                <button class="btn" id="toolTerrain">Terrain</button>
                <button class="btn" id="toolCover">Cover</button>
                <button class="btn" id="toolClear">Clear</button>
              </div>
              <div class="muted">Hotkeys: Left=Height · Right=Terrain · Ctrl+Left=Cover · Ctrl+Right=Clear · Alt+Click eyedrops</div>
            </section>

            <!-- Fixed Paint -->
            <section class="group">
              <h3>Quick Paint</h3>
              <div class="row gap">
                <label class="stack"><span>Terrain</span><select id="selTerrain"></select></label>
                <label class="stack"><span>Height</span><select id="selHeight"></select></label>
                <label class="stack"><span>Cover</span><select id="selCover"></select></label>
              </div>
              <div class="row gap">
                <button class="btn" id="btnPaintToggle" aria-pressed="false">Paint</button>
                <button class="btn" id="btnFixedClear">Clear</button>
              </div>
              <div class="muted">Pick values, then click/drag on the map. Alt+Click eyedrops current hex.</div>
            </section>

            <!-- Fill Terrain -->
            <section class="group">
              <h3>Fill Terrain</h3>
              <div class="row">
                <label class="stack" style="min-width:220px;">
                  <span>Fill map with</span>
                  <select id="selFill"></select>
                </label>
                <button class="btn sm" id="btnFill">Apply</button>
              </div>
              <div class="muted">Only changes terrain; keeps height & cover. Undo with Ctrl+Z.</div>
            </section>

            <!-- Presets -->
            <section class="group">
              <h3>Preset maps</h3>
              <label class="stack">
                <span class="muted">Choose</span>
                <select id="selPreset">
                  <option value="">— Loading… —</option>
                </select>
              </label>
            </section>

            <!-- Grid settings -->
            <section class="group">
              <h3>Grid Settings</h3>
              <div class="row">
                <label class="stack"><span>Columns</span><input id="inCols" type="number" min="1" max="80" /></label>
                <label class="stack"><span>Rows</  span><input id="inRows" type="number" min="1" max="80" /></label>
              </div>
              <label class="stack">
                <span>Hex size (px) <span class="muted">1.25" ≈ 120 px @ 96 DPI</span></span>
                <input id="inHex" type="number" min="20" max="240" />
              </label>
              <div class="row">
                <button class="btn" id="btnRegen">Regenerate Grid</button>
                <button class="btn" id="btnClearMap">Clear Map</button>
              </div>
            </section>

          </div>
        </div>
      `;

      this.shadowRoot.innerHTML = `<style>${css}</style>${html}`;
      this._wire(Core);
      this._populate(Core);
      this._loadPresets(Core);
    }

    _wire(Core){
      const $ = (s)=>this.shadowRoot.querySelector(s);

      // hide (for now just slide offscreen by toggling attribute)
      $('#btnHide')?.addEventListener('click', ()=> this.style.transform = 'translateX(-100%)');

      // tool mode buttons
      const buttons = {
        select:  $('#toolSelect'),
        height:  $('#toolHeight'),
        terrain: $('#toolTerrain'),
        cover:   $('#toolCover'),
        clear:   $('#toolClear'),
      };
      const setPressed = (which)=>{
        Object.entries(buttons).forEach(([k,btn])=>{
          if (!btn) return;
          const on = (k===which);
          btn.setAttribute('aria-pressed', on?'true':'false');
        });
      };
      const call = (m)=> typeof Core?.setToolMode === 'function'
        ? Core.setToolMode(m)
        : console.warn('[TerrainMenu] Core.setToolMode missing');

      buttons.select?.addEventListener('click', ()=>{ call('select');  setPressed('select'); });
      buttons.height?.addEventListener('click', ()=>{ call('height');  setPressed('height'); });
      buttons.terrain?.addEventListener('click',()=>{ call('terrain'); setPressed('terrain'); });
      buttons.cover?.addEventListener('click',  ()=>{ call('cover');   setPressed('cover'); });
      buttons.clear?.addEventListener('click',  ()=>{ call('clear');   setPressed('clear'); });

      // Fixed paint toggle simply asks Core to enter paintFixed mode;
      // engine already handles Alt+Click eyedrop + actual painting logic.
      $('#btnPaintToggle')?.addEventListener('click', ()=>{
        if (typeof Core?.setToolMode !== 'function') return;
        const btn = $('#btnPaintToggle');
        const on = btn.getAttribute('aria-pressed') !== 'true';
        Core.setToolMode(on ? 'paintFixed' : 'select');
        btn.setAttribute('aria-pressed', on?'true':'false');
      });

      // Fill terrain
      $('#btnFill')?.addEventListener('click', ()=>{
        const sel = $('#selFill');
        const idx = +sel?.value;
        if (Number.isNaN(idx)) return;
        if (typeof Core?.fillMapWithTerrain === 'function') {
          Core.fillMapWithTerrain(idx);
        } else {
          // fallback: manual batch if Core helper not provided
          const tiles = Core?.tiles;
          if (!tiles) return;
          Core?.beginStroke?.();
          tiles.forEach(t=>{
            const prev = { h:t.height, ter:t.terrainIndex, cov:t.coverIndex };
            t.terrainIndex = idx;
            const next = { h:t.height, ter:t.terrainIndex, cov:t.coverIndex };
            Core?.recordEdit?.(t.q, t.r, prev, next);
          });
          Core?.endStroke?.();
          Core?.requestRender?.();
        }
      });

      // Grid settings
      $('#btnRegen')?.addEventListener('click', ()=>{
        const cols = +$('#inCols').value || 10;
        const rows = +$('#inRows').value || 10;
        const hex  = +$('#inHex').value  || 120;
        if ('grid' in Core) {
          Core.grid = { cols, rows, hexSize: hex };
        }
        if (typeof window?.regen === 'function') {
          // If your current engine still uses regen(), allow it
          window.regen();
        } else {
          // Otherwise rely on Core.requestRender to rebuild on next pass
          Core?.requestRender?.();
        }
      });

      $('#btnClearMap')?.addEventListener('click', ()=>{
        if (typeof window?.clear === 'function') {
          // legacy button in engine that clears via current DOM
          document.getElementById('clear')?.click();
        } else {
          // manual clear (fallback)
          const tiles = Core?.tiles;
          if (!tiles) return;
          Core?.beginStroke?.();
          tiles.forEach(t=>{
            const prev = { h:t.height, ter:t.terrainIndex, cov:t.coverIndex };
            t.height = 0; t.terrainIndex = 0; t.coverIndex = 0;
            Core?.recordEdit?.(t.q, t.r, prev, { h:0, ter:0, cov:0 });
          });
          Core?.endStroke?.();
          Core?.requestRender?.();
        }
      });

      // Fixed paint selectors → engine already listens to internal selection
      // but in this encapsulated version we mirror values via synthetic events:
      const syncFixed = ()=>{
        // Try to find engine-side setters if exposed later; for now we rely on
        // setToolMode('paintFixed') and the engine’s on-hex paint using its own fixedPaint.
        // If you expose Core.setFixedPaint({terrainIndex,height,coverIndex}) we’ll call it here.
        if (typeof Core?.setFixedPaint === 'function') {
          const t = +$('#selTerrain').value || 0;
          const h = +$('#selHeight').value  || 0;
          const c = +$('#selCover').value   || 0;
          Core.setFixedPaint({ terrainIndex:t, height:h, coverIndex:c });
        }
      };
      $('#selTerrain')?.addEventListener('change', syncFixed);
      $('#selHeight') ?.addEventListener('change', syncFixed);
      $('#selCover')  ?.addEventListener('change', syncFixed);

      $('#btnFixedClear')?.addEventListener('click', ()=>{
        $('#selTerrain').value = 0;
        $('#selHeight').value  = 0;
        $('#selCover').value   = 0;
        if (typeof Core?.setFixedPaint === 'function') {
          Core.setFixedPaint({ terrainIndex:0, height:0, coverIndex:0 });
        }
      });
    }

    _populate(Core){
      const $ = (s)=>this.shadowRoot.querySelector(s);

      // terrains for both Fill and Fixed Paint
      const terrains = Core?.TERRAINS || [];
      const fillSel = $('#selFill');   fillSel.replaceChildren();
      const fpTer   = $('#selTerrain'); fpTer.replaceChildren();
      terrains.forEach((t, i) => {
        const a = document.createElement('option'); a.value = i; a.textContent = t.name; fillSel.appendChild(a);
        const b = document.createElement('option'); b.value = i; b.textContent = t.name; fpTer.appendChild(b);
      });

      // heights -3..5
      const fpH = $('#selHeight'); fpH.replaceChildren();
      for (let h = -3; h <= 5; h++){
        const opt = document.createElement('option');
        opt.value = h; opt.textContent = String(h);
        fpH.appendChild(opt);
      }

      // covers
      const covers = Core?.COVERS || ['None','Light','Medium','Heavy'];
      const fpC = $('#selCover'); fpC.replaceChildren();
      covers.forEach((c,i)=>{
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = c;
        fpC.appendChild(opt);
      });

      // grid fields
      const g = Core?.grid || { cols:18, rows:14, hexSize:120 };
      $('#inCols').value = g.cols;
      $('#inRows').value = g.rows;
      $('#inHex').value  = g.hexSize;
    }

    async _loadPresets(Core){
      const $ = (s)=>this.shadowRoot.querySelector(s);
      const sel = $('#selPreset');
      sel.innerHTML = `<option value="">— Choose… —</option>`;

      // Use the same GitHub Pages base your engine uses
      const APP_SCOPE = '/Battletech-Mobile-Skirmish/';
      const PRESET_BASE  = `${APP_SCOPE}presets/`;
      const PRESET_INDEX = `${PRESET_BASE}index.json`;

      try{
        const res = await fetch(PRESET_INDEX, { cache: 'no-store' });
        if (!res.ok) throw new Error('Index not found');
        const list = await res.json();
        list.forEach(p => {
          const opt = document.createElement('option');
          opt.value = PRESET_BASE + p.file;
          opt.textContent = p.name || p.id || p.file;
          sel.appendChild(opt);
        });

        sel.addEventListener('change', async (e)=>{
          const url = e.target.value;
          if (!url) return;
          if (typeof Core?.applyPresetFromUrl === 'function') {
            await Core.applyPresetFromUrl(url);
          } else {
            // local loader (fallback)
            const r = await fetch(url, { cache:'no-store' });
            const preset = await r.json();
            if (typeof Core?.applyState === 'function') {
              // normalize minimal: {meta,data,tokens,mechMeta}
              const meta = preset.meta || preset.grid || {};
              const raw  = Array.isArray(preset.data) ? preset.data : (preset.tiles || []);
              const data = raw.map(t => ({
                q:+(t.q ?? t.c ?? t.col ?? t.x),
                r:+(t.r ?? t.row ?? t.y),
                h:+(t.h ?? t.height ?? t.elevation ?? 0),
                ter:+(t.ter ?? t.terrain ?? t.type ?? 0),
                cov:+(t.cov ?? t.cover ?? 0)
              })).filter(t => Number.isFinite(t.q) && Number.isFinite(t.r));
              Core.applyState({
                meta:{ cols:+meta.cols||18, rows:+meta.rows||14, hexSize:+meta.hexSize||120 },
                data,
                tokens: Array.isArray(preset.tokens) ? preset.tokens : [],
                mechMeta: (preset.mechMeta && typeof preset.mechMeta==='object') ? preset.mechMeta : {}
              });
            }
          }
          Core?.requestRender?.();
        });
      }catch(err){
        sel.innerHTML = `<option value="">(presets unavailable)</option>`;
        console.warn('[TerrainMenu] Preset index error:', err?.message||err);
      }
    }
  }

  customElements.get('terrain-menu') || customElements.define('terrain-menu', TerrainMenu);
}
