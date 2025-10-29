// modules/chat.js
// MSS:84 Floating HUD Chat (rolling last N messages, no local saves)
// Adds a right-side collapse handle; auto-expands on any new message.

import { getApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, runTransaction, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const MAX = 5;               // keep last N messages
const BOTTOM_OFFSET_PX = 48; // floats above map footer

// --- Inject minimal CSS (amber HUD look + rank fades + collapse styles) ---
(function injectCSS(){
  if (document.getElementById('mss-chat-styles')) return;
  const css = `
  /* ===== MSS:84 HUD Chat ===== */
  #mss-chat-wrap {
    position: absolute;
    left: 16px; right: 16px;
    bottom: ${BOTTOM_OFFSET_PX}px;
    z-index: 1200;           /* <-- sits above TurnLock overlay */
    pointer-events: none; /* map stays interactive */
    font-family: ui-sans-serif, system-ui, Segoe UI, Roboto, Arial, sans-serif;
  }
  .mss-chat {
    max-width: 780px; margin: 0 auto;
    display: grid; gap: 6px;
    pointer-events: auto; /* allow clicks in header/input */
  }

  /* Header (always visible; holds collapse button) */
  .mss-chat-top {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 12px;
    background: rgba(16,16,16,0.35);
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 191, 0, 0.20);
    box-shadow: 0 0 0 1px rgba(255,191,0,0.08) inset, 0 8px 18px rgba(0,0,0,0.30);
  }
  .mss-chat-top .label {
    font-size: 12px; letter-spacing: 0.02em; color: #e8e8e8;
    opacity: 0.85;
  }
  .mss-chat-toggle {
    appearance: none; cursor: pointer;
    border: 0; border-radius: 10px;
    padding: 6px 10px;
    background: linear-gradient(180deg, #f0b000, #bb8500);
    color: #111; font-weight: 700;
    box-shadow: 0 2px 0 #754f00 inset, 0 4px 16px rgba(0,0,0,0.35);
  }
  .mss-chat-toggle:active { transform: translateY(1px); }

  /* Panel (messages) */
  .mss-chat-panel {
    display: grid; gap: 6px;
  }
  .mss-chat-lines {
    display: grid; gap: 2px;
    border: 1px solid rgba(255, 191, 0, 0.2);
    border-radius: 12px;
    padding: 8px 10px;
    backdrop-filter: blur(4px);
    background: rgba(16,16,16,0.35);
    box-shadow: 0 0 0 1px rgba(255, 191, 0, 0.08) inset, 0 10px 24px rgba(0,0,0,0.35);
  }
  .mss-chat-line {
    position: relative;
    font-size: 12px; line-height: 1.25;
    color: #eee;
    padding: 4px 8px;
    border-radius: 8px;
    transition: opacity 400ms ease, background-color 400ms ease, filter 400ms ease;
    white-space: pre-wrap; word-break: break-word;
  }
  /* Per-rank text opacity (0=newest, 4=oldest) */
  .mss-chat-line[data-rank="0"] { opacity: 1.00; }
  .mss-chat-line[data-rank="1"] { opacity: 0.80; }
  .mss-chat-line[data-rank="2"] { opacity: 0.60; }
  .mss-chat-line[data-rank="3"] { opacity: 0.40; }
  .mss-chat-line[data-rank="4"] { opacity: 0.20; }
  /* Per-rank background alpha */
  .mss-chat-line[data-rank="0"] { background: rgba(255, 191, 0, 0.18); }
  .mss-chat-line[data-rank="1"] { background: rgba(255, 191, 0, 0.12); }
  .mss-chat-line[data-rank="2"] { background: rgba(255, 191, 0, 0.08); }
  .mss-chat-line[data-rank="3"] { background: rgba(255, 191, 0, 0.04); }
  .mss-chat-line[data-rank="4"] { background: rgba(255, 191, 0, 0.00); }

  /* New message pulse */
  .mss-chat-line.pulse { animation: mssPulse 300ms ease; filter: drop-shadow(0 0 6px rgba(255,191,0,0.55)); }
  @keyframes mssPulse { from { filter: none; } to { filter: drop-shadow(0 0 6px rgba(255,191,0,0.55)); } }

  /* Input row */
  .mss-chat-input {
    display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center;
  }
  .mss-chat-input input[type="text"]{
    background: rgba(20,20,20,0.88);
    color: #f8f8f8;
    border: 1px solid rgba(255, 191, 0, 0.28);
    border-radius: 10px; padding: 8px 10px; outline: none;
  }
  .mss-chat-input button{
    background: linear-gradient(180deg, #f0b000, #bb8500);
    color: #111; border: 0; border-radius: 10px; padding: 8px 12px; font-weight: 700;
    cursor: pointer; box-shadow: 0 2px 0 #754f00 inset, 0 4px 16px rgba(0,0,0,0.35);
  }
  .mss-chat-input button:active{ transform: translateY(1px); }

  /* Collapsed state: hide panel, keep header */
  .mss-chat.collapsed .mss-chat-panel { display: none; }
  `;
  const style = document.createElement('style');
  style.id = 'mss-chat-styles';
  style.textContent = css;
  document.head.appendChild(style);
})();

// --- Core module ---
const Chat = {
  _mounted: false,
  _roomId: null,
  _user: null,
  _db: null,
  _ref: null,
  _cache: [],
  _collapsed: false,
  _lastSeenTs: 0,

  _ensureUI() {
    if (document.getElementById('mss-chat-wrap')) return;

    const host = document.querySelector('.stage') || document.body;

    const wrap = document.createElement('div');
    wrap.id = 'mss-chat-wrap';
    wrap.innerHTML = `
      <div class="mss-chat" id="mssChatRoot" role="region" aria-label="Chat">
        <div class="mss-chat-top">
          <span class="label">Comms</span>
          <button id="mssChatToggle" class="mss-chat-toggle" aria-expanded="true" title="Collapse chat">Hide</button>
        </div>
        <div class="mss-chat-panel">
          <div class="mss-chat-lines" id="mssChatLines" aria-live="polite"></div>
          <div class="mss-chat-input">
            <input id="mssChatInput" type="text" maxlength="240" placeholder="Type message…" />
            <button id="mssChatSend" type="button">Send</button>
          </div>
        </div>
      </div>
    `;
    host.appendChild(wrap);

    const $root   = wrap.querySelector('#mssChatRoot');
    const $send   = wrap.querySelector('#mssChatSend');
    const $input  = wrap.querySelector('#mssChatInput');
    const $toggle = wrap.querySelector('#mssChatToggle');

    $send.addEventListener('click', () => this.send($input));
    $input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.send($input); });

    $toggle.addEventListener('click', () => {
      this.setCollapsed(!this._collapsed);
    });

    // Expose small helpers for custom UI if needed
    this._els = { $root, $input, $toggle };
  },

  setCollapsed(flag) {
    this._collapsed = !!flag;
    const { $root, $toggle } = this._els || {};
    if (!$root || !$toggle) return;
    if (this._collapsed) {
      $root.classList.add('collapsed');
      $toggle.textContent = 'Show';
      $toggle.setAttribute('aria-expanded', 'false');
    } else {
      $root.classList.remove('collapsed');
      $toggle.textContent = 'Hide';
      $toggle.setAttribute('aria-expanded', 'true');
    }
  },

  _render() {
    const $lines = document.getElementById('mssChatLines');
    if (!$lines) return;

    const view = [...this._cache].slice(-MAX);
    const html = view
      .map((m, idx) => {
        const rank = (view.length - 1) - idx; // 0=newest(bottom)
        const who  = (m.user || '—');
        const text = (m.text || '').toString();
        return `<div class="mss-chat-line" data-rank="${rank}"><b>${who}:</b> ${text}</div>`;
      })
      .join('');
    $lines.innerHTML = html;

    // Subtle pulse on newest
    const last = $lines.lastElementChild;
    if (last) { last.classList.add('pulse'); setTimeout(() => last.classList.remove('pulse'), 320); }
  },

  async _subscribe() {
    const app = getApp();
    this._db = getFirestore(app);

    this._ref = doc(this._db, 'rooms', this._roomId, 'volatile', 'chat');
    try { await setDoc(this._ref, { messages: [], updatedAt: serverTimestamp() }, { merge: true }); } catch {}

    onSnapshot(this._ref, (snap) => {
      const arr = Array.isArray(snap.data()?.messages) ? snap.data().messages : [];
      // Detect "newer than last seen" to auto-expand if collapsed
      const newestTs = arr.length ? arr[arr.length - 1].ts || 0 : 0;
      const isNew = newestTs > this._lastSeenTs;

      this._cache = arr.slice(-MAX);
      this._render();

      if (isNew) {
        this._lastSeenTs = newestTs;
        if (this._collapsed) this.setCollapsed(false); // auto-open on new message
      }
    });
  },

  async init(roomId, userLabel) {
    if (!roomId) return console.warn('[Chat] Missing room id');
    this._roomId = roomId;
    this._user = (userLabel || localStorage.getItem('playerLabel') || 'Player').slice(0, 48);

    this._ensureUI();
    await this._subscribe();
    this._mounted = true;
  },

  async send(inputElOrString) {
    const text = (typeof inputElOrString === 'string'
      ? inputElOrString
      : (inputElOrString?.value || '')
    ).trim();

    if (!text || !this._ref) return;

    const user = this._user || localStorage.getItem('playerLabel') || 'Player';
    const now = Date.now();

    await runTransaction(this._db, async (tx) => {
      const docSnap = await tx.get(this._ref);
      const prev = Array.isArray(docSnap.data()?.messages) ? docSnap.data().messages : [];
      const next = [...prev, { text, user, ts: now }].slice(-MAX);
      tx.set(this._ref, { messages: next, updatedAt: serverTimestamp() }, { merge: true });
    });

    if (typeof inputElOrString !== 'string' && inputElOrString) inputElOrString.value = '';

    // Sending also ensures it's open
    if (this._collapsed) this.setCollapsed(false);
  }
};

// --- Auto-wire: wait for Net + room, then init chat ---
(function autoMount(){
  const tryStart = () => {
    const roomId = window.Net?.roomId;
    if (roomId) {
      const user = localStorage.getItem('playerLabel') || 'Player';
      Chat.init(roomId, user);
      return true;
    }
    return false;
  };
  if (!tryStart()) {
    window.addEventListener('net-room', (e) => {
      const room = e?.detail?.roomId;
      const user = localStorage.getItem('playerLabel') || 'Player';
      if (room) Chat.init(room, user);
    });
  }
})();
