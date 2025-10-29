// modules/battlelog.js
// MSS:84 Battle Log — append on TRANSMIT only; diff snapshots to create events.
// Keeps last MAX entries (array in one Firestore document). Local buffer when offline.

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, runTransaction, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const MAX = 25;                     // set 50 if you want more
const TAB_ID = "tab-battlelog";
const BTN_ID = "btn-battlelog";

const BattleLog = {
  _db: null, _ref: null, _roomId: null,
  _local: [], _remote: [], _mounted: false, _els: {},

  // ---------- Styles & UI ----------
  _injectStyles() {
    if (document.getElementById('battlelog-styles')) return;
    const css = `
    /* ===== Battle Log ===== */
    #${TAB_ID} {
      display:none; max-height:40vh; overflow:auto;
      border:1px solid rgba(255,191,0,0.18); border-radius:12px;
      padding:8px 10px; backdrop-filter:blur(4px);
      background:rgba(16,16,16,0.35);
      box-shadow:0 0 0 1px rgba(255,191,0,0.08) inset, 0 8px 18px rgba(0,0,0,0.30);
      color:#eaeaea; font-size:12px; line-height:1.35;
    }
    #${TAB_ID}.active{display:block}
    .bl-item{ border-radius:10px; padding:6px 8px; margin:6px 0; background:rgba(255,191,0,0.06); }
    .bl-head{ display:flex; align-items:center; gap:8px; cursor:pointer; }
    .bl-time{ opacity:.8; font-variant-numeric:tabular-nums; }
    .bl-sender{ color:#ffd35a; }
    .bl-summary{ flex:1; }
    .bl-details{ display:none; margin-top:6px; padding-left:14px; }
    .bl-details.open{ display:block; }
    .bl-details li{ margin:2px 0; }
    .bl-tab-btn{
      appearance:none; cursor:pointer; border:0; border-radius:10px;
      padding:6px 10px; margin-left:6px;
      background:linear-gradient(180deg,#f0b000,#bb8500); color:#111; font-weight:700;
      box-shadow:0 2px 0 #754f00 inset, 0 4px 16px rgba(0,0,0,0.35);
    }
    .bl-tab-btn:active{ transform:translateY(1px); }
    `;
    const style = document.createElement('style');
    style.id = 'battlelog-styles';
    style.textContent = css;
    document.head.appendChild(style);
  },
  _findRightPanelRoot(){
    return document.querySelector('.right .panel, .right .panel-body, .right') || document.querySelector('.right');
  },
  _findRightPanelHeader(){
    return document.querySelector('.right .panel-head, .right .header, .right .tabs, .right .bar') || this._findRightPanelRoot();
  },
  _ensureUI(){
    if (this._mounted) return;
    this._injectStyles();

    const head = this._findRightPanelHeader();
    if (head && !document.getElementById(BTN_ID)){
      const btn = document.createElement('button');
      btn.id = BTN_ID; btn.className='bl-tab-btn'; btn.type='button';
      btn.textContent='Battle Log'; btn.title='Open Battle Log';
      btn.addEventListener('click', () => this.toggleTab());
      head.appendChild(btn);
      this._els.btn = btn;
    }

    const root = this._findRightPanelRoot();
    if (root && !document.getElementById(TAB_ID)){
      const panel = document.createElement('div');
      panel.id = TAB_ID; panel.setAttribute('role','region'); panel.setAttribute('aria-label','Battle Log');
      root.appendChild(panel);
      this._els.panel = panel;
    }

    this._mounted = true;
    this._render();
  },
  toggleTab(force){
    const panel = this._els.panel || document.getElementById(TAB_ID);
    if (!panel) return;
    const on = (typeof force === 'boolean') ? force : !panel.classList.contains('active');
    document.querySelectorAll('.right .tab, .right .tab-pane').forEach(el=>el.classList.remove('active'));
    panel.classList.toggle('active', on);
    if (on) panel.scrollTop = panel.scrollHeight;
  },
  _render(list){
    const panel = this._els.panel || document.getElementById(TAB_ID);
    if (!panel) return;
    const arr = Array.isArray(list) ? list : (this._roomId ? (this._remote||[]) : this._local);
    panel.innerHTML = (arr.length ? arr : []).map(it=>{
      const d = new Date(it.ts||Date.now());
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const time = `${hh}:${mm}`;
      const who = it.sender || 'System';
      const sum = (it.summary||'').toString();
      const details = Array.isArray(it.events) ? it.events : [];
      const id = `bl-${it.ts}-${Math.floor(Math.random()*1e6)}`;
      return `
        <div class="bl-item">
          <div class="bl-head" data-target="${id}">
            <span class="bl-time">${time}</span>
            <span class="bl-sender">${who}</span>
            <span class="bl-summary">${sum}</span>
          </div>
          <ul class="bl-details" id="${id}">
            ${details.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>`;
    }).join('') || `<div class="bl-item"><div class="bl-summary" style="opacity:.8">No entries yet.</div></div>`;

    // toggle expand/collapse
    panel.querySelectorAll('.bl-head').forEach(h=>{
      h.addEventListener('click', ()=>{
        const tgt = panel.querySelector(`#${h.dataset.target}`);
        if (tgt) tgt.classList.toggle('open');
      });
    });

    panel.scrollTop = panel.scrollHeight;
  },

  // ---------- Firestore ----------
  async _bindFirestore(roomId){
    try {
      const app = getApp();
      this._db = getFirestore(app);
      this._ref = doc(this._db, 'rooms', roomId, 'volatile', 'log');
      await setDoc(this._ref, { entries: [], updatedAt: serverTimestamp() }, { merge:true });
      onSnapshot(this._ref, (snap)=>{
        const data = snap.data()||{};
        this._remote = Array.isArray(data.entries) ? data.entries.slice(-MAX) : [];
        this._render(this._remote);
      });
    } catch(e){
      console.warn('[BattleLog] Firestore bind failed; local-only mode.', e);
      this._db = null; this._ref=null;
    }
  },

  async init(){
    this._ensureUI();
    this._roomId = window.Net?.roomId || null;
    if (this._roomId) await this._bindFirestore(this._roomId);
  },

  // ---------- Diff + Post ----------
  // Build an events[] list by comparing two snapshots (objects your app already sends)
  summarizeDiff(prev, next){
    const ev = [];

    // tokens array (best guess: state.tokens or state.data.tokens)
    const prevTok = getTokens(prev);
    const nextTok = getTokens(next);

    const byId = (arr)=> {
      const m = new Map();
      arr.forEach((t,i)=>{
        const id = t.id || t.uid || t.uuid || t.key || t.name || `#${i}`;
        m.set(id, t);
      });
      return m;
    };
    const pMap = byId(prevTok), nMap = byId(nextTok);

    // moved / rotated / unchanged
    nMap.forEach((n, id)=>{
      const p = pMap.get(id);
      const label = n.label || n.name || id;
      if (!p){
        ev.push(`${label} deployed at (${safe(n.q)},${safe(n.r)})`);
        return;
      }
      // movement
      if ((p.q !== n.q) || (p.r !== n.r)){
        ev.push(`${label} moved (${safe(p.q)},${safe(p.r)}) → (${safe(n.q)},${safe(n.r)})`);
      }
      // rotation: try .rot or .dir or .facing
      const pr = getRot(p), nr = getRot(n);
      if (pr !== null && nr !== null && pr !== nr){
        const delta = (((nr - pr) % 360) + 360) % 360;
        ev.push(`${label} rotated ${delta}°`);
      }
    });

    // removals
    pMap.forEach((p, id)=>{
      if (!nMap.has(id)){
        const label = p.label || p.name || id;
        ev.push(`${label} removed from (${safe(p.q)},${safe(p.r)})`);
      }
    });

    // sheet updates summary if present
    const sheets = next?.sheets || next?.mechSheets || null;
    if (sheets && typeof sheets === 'object'){
      const count = Object.keys(sheets).length;
      if (count) ev.push(`Sheet updates: ${count}`);
    }

    return ev;
  },

  // Append one entry containing a summary and its detail lines
  async postEvents(events, summary='Transmit'){
    const entry = {
      ts: Date.now(),
      sender: (localStorage.getItem('playerLabel') || 'Player').slice(0,48),
      summary: summary.slice(0,256),
      events: (Array.isArray(events) ? events : []).slice(0,100) // hard cap
    };

    if (this._ref && this._db && this._roomId){
      await runTransaction(this._db, async (tx)=>{
        const snap = await tx.get(this._ref);
        const prev = Array.isArray(snap.data()?.entries) ? snap.data().entries : [];
        const next = [...prev, entry].slice(-MAX);
        tx.set(this._ref, { entries: next, updatedAt: serverTimestamp() }, { merge:true });
      });
    } else {
      this._local = [...this._local, entry].slice(-MAX);
      this._render(this._local);
    }
  }
};

// ---------- helpers ----------
function getTokens(state){
  if (!state || typeof state !== 'object') return [];
  if (Array.isArray(state.tokens)) return state.tokens;
  if (Array.isArray(state.data?.tokens)) return state.data.tokens;
  if (Array.isArray(state.tok)) return state.tok;
  return [];
}
function getRot(t){
  if (typeof t?.rot === 'number') return t.rot;
  if (typeof t?.dir === 'number') return t.dir;
  if (typeof t?.facing === 'number') return t.facing;
  return null;
}
function safe(v){ return (v===undefined||v===null)?'—':v; }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- boot ----------
(function boot(){
  const tryInit = ()=>{
    const right = document.querySelector('.right');
    if (!right) return false;
    BattleLog.init();
    return true;
  };
  if (!tryInit()) setTimeout(tryInit, 200);
  window.addEventListener('net-room', ()=>BattleLog.init());
  window.BattleLog = BattleLog;
})();
