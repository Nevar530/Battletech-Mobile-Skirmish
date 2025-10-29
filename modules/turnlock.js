/* =========================================================
   MSS:84 — Turn Lock (Soft-Blur Stage for Inactive Player)
   File: /modules/turnlock.js
   Public API: window.MSS_TurnLock
   ========================================================= */
(function () {
  const MOD = {
    _stageEl: null,
    _bannerEl: null,
    _isActiveLocal: true,
    _myRole: "host",        // "host" or "joiner" (best-effort guess if unknown)
    _names: { host:"Host", joiner:"Joiner" },

    init(opts = {}) {
      // Stage container (map) is required
      const stageSel = opts.stageSel || "#stage";
      this._stageEl = document.querySelector(stageSel);
      if (!this._stageEl) return; // fail silently if stage not present

      // Best-effort role/name seeds (if your Net exposes them)
      this._myRole = (window.Net && (Net.role || Net.isHost && "host" || "joiner")) || "host";
      const localName  = (window.Net && (Net.localName || Net.myName)) || "You";
      const remoteName = (window.Net && (Net.remoteName || Net.peerName)) || "Opponent";
      if (this._myRole === "host") {
        this._names = { host: localName, joiner: remoteName };
      } else {
        this._names = { host: remoteName, joiner: localName };
      }

      // Build banner overlay (injected; no index.html change needed)
      this._bannerEl = document.createElement("div");
      this._bannerEl.id = "turnlock-banner";
      this._bannerEl.setAttribute("aria-live", "polite");
      this._bannerEl.style.cssText = [
        "position:absolute","inset:0","pointer-events:none",
        "display:none","align-items:center","justify-content:center",
        "backdrop-filter:blur(3px)","-webkit-backdrop-filter:blur(3px)",
        "background:rgba(8,8,10,0.15)","z-index:35"
      ].join(";");

      const msg = document.createElement("div");
      msg.className = "turnlock-msg";
      msg.style.cssText = [
        "pointer-events:auto","padding:10px 14px","border-radius:12px",
        "background:rgba(18,18,22,0.72)","color:#f0b000","font-family:monospace",
        "font-size:14px","box-shadow:0 0 0 1px rgba(240,176,0,0.35) inset, 0 6px 18px rgba(0,0,0,0.35)"
      ].join(";");
      msg.textContent = "awaiting transmission…";
      this._bannerEl.appendChild(msg);

      // Wrap the stage with a positioning context and inject
      const stageWrapper = document.createElement("div");
      stageWrapper.className = "turnlock-wrap";
      stageWrapper.style.cssText = "position:relative; width:100%; height:100%;";
      this._stageEl.parentNode.insertBefore(stageWrapper, this._stageEl);
      stageWrapper.appendChild(this._stageEl);
      stageWrapper.appendChild(this._bannerEl);

      // Add a CSS class we can toggle to block input on stage only
      this._stageEl.classList.add("turnlock-target");
      // Minimal inline style to prevent map interactions when locked
      const style = document.createElement("style");
      style.textContent = `
        .turnlock-target.turnlock-locked { filter: blur(2px); pointer-events: none; }
        #turnlock-banner.show { display:flex; animation: tlkFade .25s ease-out both; }
        @keyframes tlkFade { from { opacity: 0 } to { opacity: 1 } }
      `;
      document.head.appendChild(style);
    },

    // Called in Receive path with the full state object
    onSnapshot(stateObj) {
      if (!stateObj || !stateObj.meta) return;
      const meta = stateObj.meta;

      // Optional names if present in meta
      if (meta.playerNames && (meta.playerNames.host || meta.playerNames.joiner)) {
        this._names.host   = meta.playerNames.host   || this._names.host;
        this._names.joiner = meta.playerNames.joiner || this._names.joiner;
      }

      const active = meta.activePlayer || "host"; // default host active on first connect
      const iAmActive = (active === this._myRole);
      this._setActive(iAmActive, active);
    },

    // Called just before sending a state in Transmit (host or joiner)
    onBeforeSend(metaObj) {
      if (!metaObj) return;

      // Ensure meta has active flag + optional names once
      metaObj.activePlayer = metaObj.activePlayer || "host";
      metaObj.playerNames = metaObj.playerNames || {
        host:  this._names.host,
        joiner:this._names.joiner
      };

      // Flip control to the *other* side when the active player transmits (end of phase)
      // This preserves your walkie-talkie authority model.
      if (this._amActiveLocal(metaObj.activePlayer)) {
        metaObj.activePlayer = (metaObj.activePlayer === "host") ? "joiner" : "host";
      }
    },

    _amActiveLocal(activeStr) {
      return (activeStr === this._myRole);
    },

    _setActive(isActive, activeStr) {
      this._isActiveLocal = isActive;

      // Toggle map-only lock
      if (this._stageEl) {
        if (isActive) {
          this._stageEl.classList.remove("turnlock-locked");
          this._bannerEl && this._bannerEl.classList.remove("show");
        } else {
          this._stageEl.classList.add("turnlock-locked");
          if (this._bannerEl) {
            const oppName = (activeStr === "host") ? this._names.host : this._names.joiner;
            this._bannerEl.querySelector(".turnlock-msg").textContent =
              `awaiting (${oppName}) transmission.`;
            this._bannerEl.classList.add("show");
          }
        }
      }
    }
  };

  window.MSS_TurnLock = MOD;
})();
