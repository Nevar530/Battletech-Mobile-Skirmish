/* =========================================================
   MSS:84 — Turn Lock (Overlay + Backdrop Blur, Stage-Only Block)
   File: /modules/turnlock.js
   Public API: window.MSS_TurnLock
   ========================================================= */
(function () {
  const MOD = {
    _stageEl: null,
    _blockerEl: null,
    _bannerEl: null,
    _isActiveLocal: true,
    _names: { me: "You", opp: "Opponent" },
    _excludeNodes: [],

    init(opts = {}) {
      const stageSel   = opts.stageSel   || "#stage";
      const excludeSel = opts.excludeSel || ""; // e.g. "#chat, .chat-panel"
      this._stageEl = document.querySelector(stageSel);
      if (!this._stageEl) return;

      // Capture excludes (chat, etc.)
      this._excludeNodes = excludeSel
        ? Array.from(document.querySelectorAll(excludeSel))
        : [];

      // Names (optional; best-effort)
      const localName  = (window.Net && (Net.localName || Net.myName || Net.user)) || "You";
      const remoteName = (window.Net && (Net.remoteName || Net.peerName)) || "Opponent";
      this._names = { me: localName, opp: remoteName };

      // Ensure the stage is a positioning context
      const cs = getComputedStyle(this._stageEl);
      if (cs.position === "static") this._stageEl.style.position = "relative";

      // Style block
      const style = document.createElement("style");
      style.textContent = `
        /* The overlay that blocks input & blurs what's behind it */
        #turnlock-blocker {
          position: absolute;
          inset: 0;
          display: none;
          pointer-events: none; /* flipped to auto when locked */
          background: rgba(8,8,10,0.10);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          z-index: 900; /* sits under chat (we'll bump chat above this) */
        }
        /* Message container centered within blocker */
        #turnlock-banner {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none; /* banner itself doesn't catch clicks */
        }
        #turnlock-banner .turnlock-msg {
          pointer-events: none;
          padding: 10px 14px;
          border-radius: 12px;
          background: rgba(18,18,22,0.72);
          color: #f0b000;
          font-family: monospace;
          font-size: 14px;
          box-shadow:
            0 0 0 1px rgba(240,176,0,0.35) inset,
            0 6px 18px rgba(0,0,0,0.35);
        }
        /* show/hide */
        #turnlock-blocker.show { display: block; animation: tlkFade .2s ease-out both; }
        @keyframes tlkFade { from { opacity: 0 } to { opacity: 1 } }
      `;
      document.head.appendChild(style);

      // Build blocker + banner
this._blockerEl = document.createElement("div");
this._blockerEl.id = "turnlock-blocker";
/* Ensure overlay sits BELOW side panels but ABOVE map content */
this._blockerEl.style.zIndex = String(opts.overlayZ ?? 40);


      this._bannerEl = document.createElement("div");
      this._bannerEl.id = "turnlock-banner";

      const msg = document.createElement("div");
      msg.className = "turnlock-msg";
      msg.textContent = "awaiting transmission…";
      this._bannerEl.appendChild(msg);

      this._blockerEl.appendChild(this._bannerEl);

      // Insert blocker as the **first** child so higher z-index panels (chat) can sit above it.
      if (this._stageEl.firstChild) {
        this._stageEl.insertBefore(this._blockerEl, this._stageEl.firstChild);
      } else {
        this._stageEl.appendChild(this._blockerEl);
      }

      // Ensure excluded nodes sit **above** the blocker
      this._excludeNodes.forEach(node => {
        const cs2 = getComputedStyle(node);
        if (cs2.position === "static") node.style.position = "relative";
        // Make sure they are above blocker (z=900). Use 1000 by default.
        if (!cs2.zIndex || cs2.zIndex === "auto") node.style.zIndex = 1000;
        // Keep them clickable even when blocker is shown
        // (blocker will use pointer-events:auto; but excludes are above it)
      });
    },

    // Called on receive with the full state object
    onSnapshot(stateObj) {
      if (!stateObj || !stateObj.meta) return;
      const meta = stateObj.meta;

      if (meta.playerNames) {
        const me  = meta.playerNames.me  || meta.playerNames.host || this._names.me;
        const opp = meta.playerNames.opp || meta.playerNames.joiner || this._names.opp;
        this._names = { me, opp };
      }

      const localId = (localStorage.getItem("playerLabel"))
                   || (window.Net && (Net.user || Net.uid || Net.localName))
                   || this._names.me;
      const sender  = meta.sender;
      if (!sender) return;

      const iAmSender = (String(sender) === String(localId));
      // If we sent it, we wait -> lock. If we received it, it's our turn -> unlock.
      this._setActive(!iAmSender);
    },

    // Called right before transmit
    onBeforeSend(metaObj) {
      if (!metaObj) return;
      metaObj.playerNames = metaObj.playerNames || { me: this._names.me, opp: this._names.opp };
      // Immediately lock locally after we transmit
      this._setActive(false);
    },

    _setActive(isActive) {
      this._isActiveLocal = isActive;
      if (!this._blockerEl) return;

      if (isActive) {
        this._blockerEl.classList.remove("show");
        this._blockerEl.style.pointerEvents = "none";
      } else {
        const oppName = this._names.opp;
        const msgEl = this._bannerEl && this._bannerEl.querySelector(".turnlock-msg");
        if (msgEl) msgEl.textContent = `awaiting (${oppName}) transmission.`;
        this._blockerEl.classList.add("show");
        // Block the map (stage), but excludes are above this overlay and remain interactive.
        this._blockerEl.style.pointerEvents = "auto";
      }
    }
  };

  window.MSS_TurnLock = MOD;
})();
