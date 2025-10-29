/* =========================================================
   MSS:84 — Turn Lock (SVG-only overlay + backdrop blur)
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
    _resizeObs: null,

    init(opts = {}) {
      const stageSel   = opts.stageSel   || "main.stage";
      const excludeSel = opts.excludeSel || ""; // e.g. "#mss-chat-wrap, #leftPanel, #rightPanel, header.ui-topbar"
      const overlayZ   = (opts.overlayZ ?? 40);

      this._stageEl = document.querySelector(stageSel);
      if (!this._stageEl) return;

      // Capture excludes (chat/panels). If they're in the stage, we'll bump z-index.
      this._excludeNodes = excludeSel ? Array.from(document.querySelectorAll(excludeSel)) : [];

      // Names (best-effort)
      const localName  = (window.Net && (Net.localName || Net.myName || Net.user)) || "You";
      const remoteName = (window.Net && (Net.remoteName || Net.peerName)) || "Opponent";
      this._names = { me: localName, opp: remoteName };

      // Ensure the stage can anchor absolute children
      const cs = getComputedStyle(this._stageEl);
      if (cs.position === "static") this._stageEl.style.position = "relative";

      // ----- Styles (note: no inset:0 to avoid fighting inline sizing) -----
      const style = document.createElement("style");
      style.textContent = `
        /* Overlay blocks input + blurs only what's behind within its rect */
        #turnlock-blocker {
          position: absolute;
          display: none;               /* shown via .show */
          pointer-events: none;        /* set to auto when locked */
          background: rgba(8,8,10,0.10);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
        }
        /* Centered banner message */
        #turnlock-banner {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          pointer-events: none;
        }
        #turnlock-banner .turnlock-msg {
          pointer-events: none;
          padding: 10px 14px;
          border-radius: 12px;
          background: rgba(18,18,22,0.72);
          color: #f0b000;
          font-family: monospace;
          font-size: 14px;
          box-shadow: 0 0 0 1px rgba(240,176,0,0.35) inset, 0 6px 18px rgba(0,0,0,0.35);
        }
        /* show/hide */
        #turnlock-blocker.show { display: block; animation: tlkFade .2s ease-out both; }
        @keyframes tlkFade { from { opacity: 0 } to { opacity: 1 } }
      `;
      document.head.appendChild(style);

      // ----- Build blocker + banner (we’ll size it exactly over the SVG) -----
      this._blockerEl = document.createElement("div");
      this._blockerEl.id = "turnlock-blocker";
      this._blockerEl.style.zIndex = String(overlayZ); // above map, below chat/panels

      this._bannerEl = document.createElement("div");
      this._bannerEl.id = "turnlock-banner";

      const msg = document.createElement("div");
      msg.className = "turnlock-msg";
      msg.textContent = "awaiting transmission…";
      this._bannerEl.appendChild(msg);
      this._blockerEl.appendChild(this._bannerEl);

      // Insert as first child so it overlays the SVG cleanly
      if (this._stageEl.firstChild) {
        this._stageEl.insertBefore(this._blockerEl, this._stageEl.firstChild);
      } else {
        this._stageEl.appendChild(this._blockerEl);
      }

      // Excluded nodes: ensure they float above overlay if they are inside the stage
      this._excludeNodes.forEach(node => {
        const cs2 = getComputedStyle(node);
        if (cs2.position === "static") node.style.position = "relative";
        if (!cs2.zIndex || cs2.zIndex === "auto") node.style.zIndex = "1000";
      });

      // Sizing logic targets ONLY the SVG map
      const recalcBlocker = () => {
        const svg = this._stageEl.querySelector("svg#svg");
        if (!svg) return;
        Object.assign(this._blockerEl.style, {
          position: "absolute",
          left: svg.offsetLeft + "px",
          top:  svg.offsetTop  + "px",
          width:  svg.clientWidth  + "px",
          height: svg.clientHeight + "px",
          right: "auto",  // IMPORTANT: avoid any inherited inset:0 rules
          bottom:"auto"
        });
      };
      this._recalc = recalcBlocker;

      // Initial calc, then keep sized if the SVG/grid changes
      recalcBlocker();
      window.addEventListener("resize", recalcBlocker);

      // Use ResizeObserver if available (SVG size can change on regen/zoom container changes)
      try {
        const svg = this._stageEl.querySelector("svg#svg");
        if (svg && "ResizeObserver" in window) {
          this._resizeObs = new ResizeObserver(() => recalcBlocker());
          this._resizeObs.observe(svg);
        }
      } catch {}

      // If SVG gets re-mounted, re-calc after a tick when we lock
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
      // If we sent it, we wait → lock. If we received it, it's our turn → unlock.
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
        // Ensure we’re perfectly aligned to SVG right before showing
        try { this._recalc?.(); } catch {}
        const oppName = this._names.opp;
        const msgEl = this._bannerEl && this._bannerEl.querySelector(".turnlock-msg");
        if (msgEl) msgEl.textContent = `awaiting (${oppName}) transmission.`;
        this._blockerEl.classList.add("show");
        this._blockerEl.style.pointerEvents = "auto";
      }
    }
  };

  window.MSS_TurnLock = MOD;
})();
