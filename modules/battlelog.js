// modules/battlelog.js
// MSS:84 Battle Log (room-scoped, low-bandwidth, append-on-transmit only)
// - Keeps last MAX entries (25 default; change to 50 if you want)
// - Shared across players when in a room (Firestore single doc)
// - Local-only buffer when offline or no room
// - Self-injects a "Battle Log" tab into the right mech panel

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, runTransaction, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const MAX = 25;           // keep last N entries. Change to 50 if preferred
const TAB_ID = "tab-battlelog";
const BTN_ID = "btn-battlelog";

const BattleLog = {
  _db: null,
  _ref: null,
  _roomId: null,
  _local: [],         // fallback when no room/Firestore
  _mounted: false,
  _els: {},

  // --- DOM helpers (tab + panel in right mech panel) ---
  _injectStyles() {
    if (document.getElementById('battlelog-styles')) return;
    const css = `
    /* ===== Battle Log (self-contained) ===== */
    #${TAB_ID} {
      display: none;
      max-height: 40vh;
      overflow: auto;
      border: 1px solid rgba(255,191,0,0.18);
      border-radius: 12px;
      padding: 8px 10px;
      backdrop-filter: blur(4px);
      background: rgba(16,16,16,0.35);
      box-shadow: 0 0 0 1px rgba(255,191,0,0.08) inset, 0 8px 18px rgba(0,0,0,0.30);
      color: #eaeaea;
      font-size: 12px;
      line-height: 1.35;
    }
    #${TAB_ID}.active { display: block; }
    .bl-row { padding: 4px 6px; border-radius: 8px; }
    .bl-row:nth-child(odd){ background: rgba(255,191,0,0.06); }
    .bl-time { opacity: 0.8; margin-right: 6px; font-variant-numeric: tabular-nums; }
    .bl-who  { color: #ffd35a; margin-right: 6px; }
    .bl-text { color: #eaeaea; }
    /* header button looks like your amber UI */
    .bl-tab-btn {
      appearance: none; cursor: pointer; border: 0; border-radius: 10px;
      padding: 6px 10px; margin-left: 6px;
      background: linear-gradient(180deg, #f0b000, #bb8500); color: #111; font-weight: 700;
      box-shadow: 0 2px 0 #754f00 inset, 0 4px 16px rgba(0,0,0,0.35);
    }
    .bl-tab-btn:active { transform: translateY(1px); }
    `;
    const style = document.createElement('style');
    style.id = 'battlelog-styles';
    style.textContent = css;
    document.head.appendChild(style);
  },

  _findRightPanelRoot() {
    // Try common anchors in your app; fall back to '.right'
    return document.querySelector('.right .panel, .right .panel-body, .right') || document.querySelector('.right');
  },

  _findRightPanelHeader() {
    // Where "Add Mech" and other buttons live; try a few likely spots
    return document.querySelector('.right .panel-head, .right .header, .right .tabs, .right .bar') || this._findRightPanelRoot();
  },

  _ensureUI() {
    if (this._mounted) return;

    this._injectStyles();

    // 1) Insert the tab button into the right-panel header bar
    const head = this._findRightPanelHeader();
    if (head && !document.getElementById(BTN_ID)) {
      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.className = 'bl-tab-btn';
      btn.type = 'button';
      btn.textContent = 'Battle Log';
      btn.title = 'Open Battle Log';
      head.appendChild(btn);
      btn.addEventListener('click', () => this.toggleTab());
      this._els.btn = btn;
    }

    // 2) Insert the panel container into the right-panel body
    const root = this._findRightPanelRoot();
    if (root && !document.getElementById(TAB_ID)) {
      const panel = document.createElement('div');
      panel.id = TAB_ID;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Battle Log');
      root.appendChild(panel);
      this._els.panel = panel;
    }

    this._mounted = true;
    this._render(); // initial empty render
  },

  toggleTab(forceState) {
    const panel = this._els.panel || document.getElementById(TAB_ID);
    if (!panel) return;
    const on = (typeof forceState === 'boolean') ? forceState : !panel.classList.contains('active');

    // hide any sibling tab content if your app uses single-tab display
    // (lightweight: just collapse any other known tab panes)
    document.querySelectorAll('.right .tab, .right .tab-pane').forEach(el => el.classList.remove('active'));

    panel.classList.toggle('active', on);
    if (on && panel.scrollHeight) panel.scrollTop = panel.scrollHeight; // scroll to newest
  },

  _render(list) {
    const panel = this._els.panel || document.getElementById(TAB_ID);
    if (!panel) return;
    const arr = Array.isArray(list) ? list : (this._roomId ? (this._remote || []) : this._local);
    const html = arr.map(it => {
      const d = new Date(it.ts || Date.now());
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const time = `${hh}:${mm}`;
      const who  = it.sender || 'System';
      const msg  = (it.summary || '').toString();
      return `<div class="bl-row"><span class="bl-time">${time}</span><span class="bl-who">${who}</span><span class="bl-text">${msg}</span></div>`;
    }).join('');
    panel.innerHTML = html || `<div class="bl-row"><span class="bl-text" style="opacity:.8">No entries yet.</span></div>`;
    // keep scroll pinned to bottom
    panel.scrollTop = panel.scrollHeight;
  },

  // --- Firestore wiring (single document with an array) ---
  async _bindFirestore(roomId) {
    try {
      const app = getApp();
      this._db = getFirestore(app);
      this._ref = doc(this._db, 'rooms', roomId, 'volatile', 'log');

      // Ensure doc exists without overwriting
      await setDoc(this._ref, { entries: [], updatedAt: serverTimestamp() }, { merge: true });

      // Lightweight listener so all players see the same log.
      // This triggers only when someone presses TRANSMIT (append-once).
      onSnapshot(this._ref, (snap) => {
        const data = snap.data() || {};
        const arr = Array.isArray(data.entries) ? data.entries : [];
        this._remote = arr.slice(-MAX);
        this._render(this._remote);
      });
    } catch (e) {
      console.warn('[BattleLog] Firestore bind failed (local-only mode):', e);
      this._db = null;
      this._ref = null;
    }
  },

  // --- Public API ---
  async init() {
    this._ensureUI();

    const roomId = window.Net?.roomId || null;
    this._roomId = roomId;

    if (roomId) {
      await this._bindFirestore(roomId);
    }
  },

  // Append a compact summary line; called on TRANSMIT only (or wherever you choose)
  async post(summary, extra = {}) {
    const entry = {
      ts: Date.now(),
      sender: (localStorage.getItem('playerLabel') || 'Player').slice(0, 48),
      summary: (summary || '').toString().slice(0, 256),
      ...extra
    };

    // If in a room with Firestore available → append to the doc (trim)
    if (this._ref && this._db && this._roomId) {
      await runTransaction(this._db, async (tx) => {
        const snap = await tx.get(this._ref);
        const prev = Array.isArray(snap.data()?.entries) ? snap.data().entries : [];
        const next = [...prev, entry].slice(-MAX);
        tx.set(this._ref, { entries: next, updatedAt: serverTimestamp() }, { merge: true });
      });
    } else {
      // Local-only buffer (no network); trim
      this._local = [...this._local, entry].slice(-MAX);
      this._render(this._local);
    }
  }
};

// --- Auto-mount when UI & Net are ready ---
(function boot() {
  const tryInit = () => {
    // Wait for right panel to exist
    const right = document.querySelector('.right');
    if (!right) return false;

    BattleLog.init();
    return true;
  };

  // Start if already available; else retry briefly and also hook into room join
  if (!tryInit()) setTimeout(tryInit, 200);
  window.addEventListener('net-room', () => BattleLog.init());

  // Expose globally so script.js can call BattleLog.post(...) on TRANSMIT
  window.BattleLog = BattleLog;
})();
