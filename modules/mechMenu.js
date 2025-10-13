// modules/mechMenu.js
// Custom element <mech-menu>
// Owns: Add Mech, Dice, Initiative, Roster, Flechs helpers, import/export
//
// ==== Expected Core surface ====
// Core: {
//   tokens: Array<{id,q,r,scale,angle,colorIndex,label}>,
//   mechMeta: Map<string, {name, pilot, team}>,
//   TEAMS: Array<{name,color}>,
//   addTokenAtViewCenter(label?:string, colorIndex?:number): string,
//   requestRender(), saveLocal(),
//   // initiative: we keep the data inside this module; Core renderer will query roll via:
//   //   Core.getInitRollFor = (id)=> number | undefined
//   // and we keep Core.onTokensChanged = ()=>void to refresh UI if tokens mutate outside us.
//   onTokensChanged?: ()=>void,
//   getInitRollFor?: (id:string)=>number|undefined,
//   // Optional helpers the engine may expose (used if present):
//   tileCenter?(q,r):{x,y},
//   serializeState?():string,
//   applyState?(obj:any):void
// }

export function registerMechMenu(Core) {
  class MechMenu extends HTMLElement {
    constructor(){
      super();
      this.attachShadow({ mode:'open' });
      this._initRolls = new Map();   // id -> number
      this._initOrder = [];          // [{id, roll}]
      this._initIndex = -1;
    }

    connectedCallback(){
      const css = /*css*/`
        :host{
          position:fixed; right:0;
          top:calc(var(--header-h,48px) + var(--app-top-offset, 0px));
          bottom:0; width:340px; z-index:20;
          transform:translateX(0);
        }
        .panel{ position:absolute; inset:0; background:var(--panel,#121826);
          border-top:1px solid var(--border,#1f2a3a); box-shadow:0 0 24px rgba(0,0,0,.35);
          display:flex; flex-direction:column; }
        header{ display:flex; align-items:center; justify-content:space-between;
          padding:10px; border-bottom:1px solid var(--border,#1f2a3a); background:#0f1722; }
        header h2{ margin:0; font-size:14px; letter-spacing:.06em }
        .body{ padding:10px; overflow:auto; display:flex; flex-direction:column; gap:12px; }

        .group{border:1px solid var(--border,#1f2a3a);border-radius:14px;padding:10px;background:#0f1522}
        .group h3{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#93a4b8)}
        .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .stack{display:flex;flex-direction:column;gap:4px;flex:1}
        .stack input,.stack select{
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

        ul{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
        li{ border:1px solid var(--border,#1f2a3a); border-radius:12px; background:#0c1220; padding:8px; }

        .mp-row{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
        .mp-actions{ display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:end; }
        .mini{ display:flex; gap:6px; }
      `;

      const html = /*html*/`
        <div class="panel" role="complementary" aria-label="Mechs & Utilities">
          <header>
            <h2>Mechs & Utilities</h2>
            <button class="btn sm" id="btnHide" title="Hide">✕</button>
          </header>
          <div class="body">

            <!-- Add Mech -->
            <section class="group">
              <h3>Add Mech</h3>
              <div class="mp-row">
                <label class="stack">
                  <span>Mech</span>
                  <input id="mechName" type="text" list="mechListData" placeholder="e.g., GRF-1N or Griffin 1N" />
                  <datalist id="mechListData"></datalist>
                </label>
                <label class="stack">
                  <span>Pilot</span>
                  <input id="pilotName" type="text" placeholder="Pilot (optional)" />
                </label>
              </div>
              <div class="mp-actions">
                <label class="stack">
                  <span>Team</span>
                  <select id="teamSelect">
                    <option value="Alpha">Alpha</option>
                    <option value="Bravo">Bravo</option>
                    <option value="Clan">Clan</option>
                    <option value="Merc">Merc</option>
                  </select>
                </label>
                <button class="btn" id="btnAdd">Add Mech</button>
              </div>
            </section>

            <!-- Initiative + Dice -->
            <div class="row gap">
              <section class="group" style="flex:1;">
                <div class="row" style="justify-content:space-between;">
                  <h3>Initiative</h3>
                  <div class="mini">
                    <button class="btn sm" id="btnRollAll">Roll All</button>
                    <button class="btn sm" id="btnClearInit">Clear</button>
                    <button class="btn sm" id="btnNextTurn">Next ▶</button>
                  </div>
                </div>
                <ul id="initList"></ul>
              </section>

              <section class="group" style="flex:1;">
                <h3>Dice Roller</h3>
                <div class="row gap"><button class="btn" id="btn2d6">2d6</button></div>
                <output id="diceOut" class="muted">—</output>
              </section>
            </div>

            <!-- Flechs -->
            <section class="group">
              <div class="row" style="justify-content:space-between;">
                <h3 class="row" style="gap:8px; align-items:center;">
                  <img src="https://sheets.flechs.net/img/favicon-32x32.png" alt="" width="16" height="16" style="border-radius:4px;" />
                  <span>Flechs Sheets</span>
                </h3>
                <div class="mini">
                  <button class="btn sm" id="btnFlechsP1">P1</button>
                  <button class="btn sm" id="btnFlechsP2">P2</button>
                </div>
              </div>
              <div class="muted">Opens the docks for live mech stats & damage tracking.</div>
            </section>

            <!-- Roster -->
            <section class="group">
              <div class="row" style="justify-content:space-between;">
                <h3>Mech Roster</h3>
                <div class="mini">
                  <button class="btn sm" id="btnExport">Export</button>
                  <button class="btn sm" id="btnImport">Import</button>
                  <input id="fileImport" type="file" accept="application/json" hidden />
                </div>
              </div>
              <ul id="mechList"></ul>
            </section>

          </div>
        </div>
      `;

      this.shadowRoot.innerHTML = `<style>${css}</style>${html}`;
      this._wire(Core);
      this._loadMechIndex();
      this._renderRoster(Core);
      this._renderInit(Core);

      // expose hooks to Core so the canvas can refresh this panel when tokens change elsewhere
      if (Core) {
        Core.onTokensChanged = ()=>{ this._renderRoster(Core); this._renderInit(Core); };
        Core.getInitRollFor  = (id)=> this._initRolls.get(id);
      }
    }

    _wire(Core){
      const $ = (s)=>this.shadowRoot.querySelector(s);

      $('#btnHide')?.addEventListener('click', ()=> this.style.transform = 'translateX(100%)');

      // Add mech
      $('#btnAdd')?.addEventListener('click', ()=> this._addMechFromForm(Core));
      $('#mechName')?.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') this._addMechFromForm(Core);
      });

      // Dice
      $('#btn2d6')?.addEventListener('click', ()=>{
        const d1 = Math.floor(Math.random()*6)+1;
        const d2 = Math.floor(Math.random()*6)+1;
        const sum = d1+d2;
        const out = this.shadowRoot.getElementById('diceOut');
        if (out) out.textContent = `🎲 2d6: ${d1} + ${d2} = ${sum}`;
      });

      // Initiative
      $('#btnRollAll')  ?.addEventListener('click', ()=> this._rollAll(Core));
      $('#btnClearInit')?.addEventListener('click', ()=> this._clearInit(Core));
      $('#btnNextTurn') ?.addEventListener('click', ()=> this._nextTurn(Core));

      // Flechs dock helpers (use your existing global toggles if present)
      $('#btnFlechsP1')?.addEventListener('click', ()=>{
        if (typeof window?.toggleDockA === 'function') window.toggleDockA();
      });
      $('#btnFlechsP2')?.addEventListener('click', ()=>{
        if (typeof window?.toggleDockB === 'function') window.toggleDockB();
      });

      // Import/Export roster
      $('#btnExport')?.addEventListener('click', ()=> this._exportRoster(Core));
      const file = $('#fileImport');
      $('#btnImport')?.addEventListener('click', ()=> file?.click());
      file?.addEventListener('change', (e)=> this._importRoster(e, Core));
    }

    _teamNameToColorIndex(team){
      const map = { 'Alpha': 1, 'Bravo': 0, 'Clan': 4, 'Merc': 3 };
      return map[team] ?? 0;
    }

    _shortLabel(name){ return (name||'MECH').slice(0, 18); }

    _resolveMech(input){
      const raw = (input||'').trim();
      if (!raw) return { tokenLabel:'MECH', displayName:'MECH' };

      const normalizeId = (str)=> (str||'')
        .toUpperCase()
        .replace(/\s+/g,'')
        .replace(/^([A-Z]{2,4})(\d)/, '$1-$2');

      const asId = normalizeId(raw);
      const hitById = this._mechById?.get(asId);
      if (hitById) return { tokenLabel: asId, displayName: hitById };

      const hitCode = this._mechByName?.get(raw.toLowerCase());
      if (hitCode)  return { tokenLabel: hitCode, displayName: raw };

      return { tokenLabel: this._shortLabel(raw.toUpperCase()), displayName: raw };
    }

    _addMechFromForm(Core){
      const $ = (s)=>this.shadowRoot.querySelector(s);
      const rawInput = ($('#mechName')?.value || '').trim();
      const { tokenLabel, displayName } = this._resolveMech(rawInput);
      const pilot = ($('#pilotName')?.value || '').trim();
      const team  = ($('#teamSelect')?.value || 'Alpha');
      const colorIndex = this._teamNameToColorIndex(team);

      const id = Core?.addTokenAtViewCenter ? Core.addTokenAtViewCenter(tokenLabel, colorIndex) : null;
      if (!id) return;

      Core?.mechMeta?.set?.(id, { name: displayName, pilot, team });
      this._renderRoster(Core);
      this._renderInit(Core);
      Core?.saveLocal?.();

      const mn = $('#mechName'), pn = $('#pilotName');
      if (mn) mn.value = ''; if (pn) pn.value = '';
    }

    _renderRoster(Core){
      const list = this.shadowRoot.getElementById('mechList');
      if (!list) return;
      list.innerHTML = '';

      const tokens = Core?.tokens || [];
      tokens.forEach(t=>{
        const meta = Core?.mechMeta?.get?.(t.id) || { name: t.label, pilot:'', team:'Alpha' };
        const li = document.createElement('li');
        li.dataset.id = t.id;
        li.innerHTML = `
          <div class="row" style="justify-content:space-between;">
            <div>
              <strong>${meta.name || t.label || 'MECH'}</strong>
              ${meta.pilot ? `<div class="muted">Pilot: ${meta.pilot}</div>` : ''}
              <div class="muted">Team: ${meta.team || '—'}</div>
            </div>
            <div class="mini">
              <button class="btn sm" data-act="select">Select</button>
              <button class="btn sm" data-act="center">Center</button>
              <button class="btn sm" data-act="turnL">⟲</button>
              <button class="btn sm" data-act="turnR">⟳</button>
              <button class="btn sm" data-act="bigger">＋</button>
              <button class="btn sm" data-act="smaller">－</button>
              <button class="btn sm" data-act="delete">🗑</button>
            </div>
          </div>
        `;
        list.appendChild(li);
      });

      list.addEventListener('click', (e)=>{
        const btn = e.target.closest('button'); if (!btn) return;
        const li = e.target.closest('li'); if (!li) return;
        const id = li.dataset.id;
        const tok = (Core?.tokens || []).find(t => t.id === id); if (!tok) return;

        switch (btn.dataset.act) {
          case 'select':
            // selecting a token is currently done with a global in your engine;
            // we can mimic by focusing and setting selectedTokenId if the engine exposes it.
            window.selectedTokenId = id;
            Core?.requestRender?.();
            break;
          case 'center': {
            const c = typeof Core?.tileCenter === 'function' ? Core.tileCenter(tok.q, tok.r) : null;
            if (c && window.svg && window.camera) {
              const vb = svg.viewBox.baseVal;
              window.camera.x = c.x - (vb.width/2);
              window.camera.y = c.y - (vb.height/2);
              window.camera.setViewBox();
            }
            break;
          }
          case 'turnL':
            tok.angle = ((tok.angle||0) - 60 + 360) % 360; Core?.requestRender?.(); Core?.saveLocal?.(); break;
          case 'turnR':
            tok.angle = ((tok.angle||0) + 60) % 360; Core?.requestRender?.(); Core?.saveLocal?.(); break;
          case 'bigger':
            tok.scale = Math.max(0.4, Math.min(2.0, (tok.scale||1) * 1.10)); Core?.requestRender?.(); Core?.saveLocal?.(); break;
          case 'smaller':
            tok.scale = Math.max(0.4, Math.min(2.0, (tok.scale||1) / 1.10)); Core?.requestRender?.(); Core?.saveLocal?.(); break;
          case 'delete':
            Core.tokens = (Core.tokens || []).filter(x => x.id !== id);
            Core?.mechMeta?.delete?.(id);
            if (window.selectedTokenId === id) window.selectedTokenId = null;
            // also drop from initiative
            this._initRolls.delete(id);
            this._initOrder = this._initOrder.filter(e => e.id !== id);
            if (this._initIndex >= this._initOrder.length) this._initIndex = this._initOrder.length - 1;
            this._renderRoster(Core); this._renderInit(Core); Core?.requestRender?.(); Core?.saveLocal?.();
            break;
        }
      }, { once: true }); // prevent stacking multiple handlers across re-renders
    }

    _renderInit(Core){
      const list = this.shadowRoot.getElementById('initList');
      if (!list) return;
      list.innerHTML = '';

      if (!this._initOrder.length) {
        // clear engine badges by forcing redraw; renderer will query getInitRollFor (empty)
        Core?.requestRender?.();
        return;
      }

      this._initRolls = new Map(this._initOrder.map(e => [e.id, e.roll]));
      this._initOrder.forEach((entry, idx) => {
        const tok = (Core?.tokens || []).find(t => t.id === entry.id);
        if (!tok) return;
        const meta = Core?.mechMeta?.get?.(entry.id) || { name: tok.label };
        const li = document.createElement('li');
        if (idx === this._initIndex) li.style.outline = '2px solid var(--bt-amber,#ffd06e)';
        li.innerHTML = `<strong>${meta.name || tok.label}</strong> — roll: <em>${entry.roll}</em>`;
        list.appendChild(li);
      });

      Core?.requestRender?.(); // re-render tokens so badges update
    }

    _roll2d6(){ return (Math.floor(Math.random()*6)+1) + (Math.floor(Math.random()*6)+1); }

    _rollAll(Core){
      const toks = Core?.tokens || [];
      this._initOrder = toks.map(t => ({ id:t.id, roll:this._roll2d6() })).sort((a,b)=> b.roll - a.roll);
      this._initIndex = this._initOrder.length ? 0 : -1;
      this._renderInit(Core);
    }

    _clearInit(Core){
      this._initOrder = []; this._initIndex = -1; this._initRolls.clear();
      this._renderInit(Core);
    }

    _nextTurn(Core){
      if (!this._initOrder.length) return;
      this._initIndex = (this._initIndex + 1) % this._initOrder.length;
      this._renderInit(Core);
    }

    _exportRoster(Core){
      try{
        const tokens = Core?.tokens || [];
        const out = tokens.map(t=>({
          id:t.id, q:t.q, r:t.r, scale:t.scale, angle:t.angle, colorIndex:t.colorIndex,
          label: t.label, meta: Core?.mechMeta?.get?.(t.id) || null
        }));
        const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mechs.json';
        document.body.appendChild(a); a.click();
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
      }catch(e){
        alert('Export failed.');
      }
    }

    _importRoster(e, Core){
      const f = e.target.files?.[0];
      e.target.value = ''; // reset
      if (!f) return;
      const r = new FileReader();
      r.onload = ()=>{
        try{
          const arr = JSON.parse(r.result);
          if (!Array.isArray(arr)) throw new Error('Invalid file');
          arr.forEach(m=>{
            const have = (Core?.tokens || []).some(t=>t.id===m.id);
            const id = have ? (String(Date.now())+Math.random().toString(16).slice(2,6)) : (m.id || (String(Date.now())+Math.random().toString(16).slice(2,6)));
            const tok = {
              id,
              q: Math.max(0, Math.min((Core?.grid?.cols||18)-1, +(m.q||0))),
              r: Math.max(0, Math.min((Core?.grid?.rows||14)-1, +(m.r||0))),
              scale: Math.max(0.4, Math.min(2.0, +(m.scale||1))),
              angle: ((+m.angle||0)%360+360)%360,
              colorIndex: ((+m.colorIndex||0)%((Core?.TEAMS||[]).length||6)+((Core?.TEAMS||[]).length||6))%((Core?.TEAMS||[]).length||6),
              label: (m.label || m.meta?.name || 'MECH').slice(0,24)
            };
            (Core?.tokens || []).push(tok);
            if (m.meta) Core?.mechMeta?.set?.(id, m.meta);
          });
          this._renderRoster(Core); Core?.requestRender?.(); Core?.saveLocal?.();
        }catch(err){ alert('Import failed: '+ (err?.message||err)); }
      };
      r.readAsText(f);
    }

    async _loadMechIndex(){
      // Populate datalist with assets/mechs.json if available
      try{
        const res = await fetch('assets/mechs.json', { cache:'no-store' });
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.mechs || []);
        this._mechById = new Map();
        this._mechByName = new Map();
        const dl = this.shadowRoot.getElementById('mechListData');
        dl.replaceChildren();
        list.forEach(({id,name})=>{
          if (!id || !name) return;
          const up = id.toUpperCase();
          this._mechById.set(up, name);
          this._mechByName.set(name.toLowerCase(), up);
          const opt = document.createElement('option');
          opt.value = name;
          opt.label = up;
          dl.appendChild(opt);
        });
      }catch(e){
        // silent fail; free text still works
        this._mechById = new Map();
        this._mechByName = new Map();
      }
    }
  }

  customElements.get('mech-menu') || customElements.define('mech-menu', MechMenu);
}
