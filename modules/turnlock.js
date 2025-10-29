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
    _names: { me: "You", opp: "Opponent" },

    init(opts = {}) {
      // Stage container (map) is required
      const stageSel = opts.stageSel || "#stage";
      this._stageEl = document.querySelector(stageSel);
      if (!this._stageEl) return; // fail silently if stage not present

      // Seed names if your Net exposes them (optional)
      const localName  = (window.Net && (Net.localName || Net.myName || Net.user)) || "You";
      const remoteName = (window.Net && (Net.remoteName || Net.peerName)) || "Opponent";
      this._names = { me: localName, opp: remoteName };

      // Build banner overlay (injected; no index.html change needed)
      this._bannerEl = document.createElement("div");
      this._bannerEl.id = "turnlock-banner";
      this._bannerEl.setAttribute("aria-live", "polite");
      this._bannerEl.style.cssText = [
        "position:absolute","inset:0","pointer-events:none",
        "display:none","align-items:center","justify-content:center",
        "backdrop-filter:blur(3px)","-webkit-backdrop-filter:blur(3px)",
        "background:rgba(8,8,10,0.15)","z-index:999"
      ].join(";");

      const msg = document.createElement("div");
      msg.className = "turnlock-msg";
      msg.style.cssText = [
        "pointer-events:none","padding:10px 14px","border-radius:12px",
        "background:rgba(18,18,22,0.72)","color:#f0b000","font-family:monospace",
        "font-size:14px","box-shadow:0 0 0 1px rgba(240,176,0,0.35) inset, 0 6px 18px rgba(0,0,0,0.35)"
      ].join("-");
      msg.textContent = "awaiting transmission…";
      this._bannerEl.appendChild(msg);

      // Ensure stage is positioning context and inject banner inside it
      const cs = getComputedStyle(this._stageEl);
      if (cs.position === "static") this._stageEl.style.position = "relative";
      this._stageEl.appendChild(this._bannerEl);

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

      // Update names if present (optional)
      if (meta.playerNames) {
        const me = meta.playerNames.me || meta.playerNames.host || this._names.me;
        const opp = meta.playerNames.opp || meta.playerNames.joiner || this._names.opp;
        this._names = { me, opp };
      }

      // Determine if WE sent the snapshot
      const localId = (localStorage.getItem("playerLabel"))
                   || (window.Net && (Net.user || Net.uid || Net.localName))
                   || this._names.me;
      const sender  = meta.sender;
      if (!sender) return;

      const iAmSender = (String(sender) === String(localId));

      // If we sent it, it's now their turn -> lock us.
      // If we received it, it's now our turn -> unlock us.
      this._setActive(!iAmSender);
    },

    // Called just before sending a state in Transmit
    onBeforeSend(metaObj) {
      if (!metaObj) return;
      // Keep names if you want them visible later (optional)
      metaObj.playerNames = metaObj.playerNames || { me: this._names.me, opp: this._names.opp };
      // Immediately lock locally after we transmit (walkie-talkie flow)
      this._setActive(false);
    },

    _setActive(isActive) {
      this._isActiveLocal = isActive;
      if (!this._stageEl) return;

      if (isActive) {
        this._stageEl.classList.remove("turnlock-locked");
        this._bannerEl && this._bannerEl.classList.remove("show");
      } else {
        this._stageEl.classList.add("turnlock-locked");
        if (this._bannerEl) {
          const oppName = this._names.opp;
          this._bannerEl.querySelector(".turnlock-msg").textContent =
            `awaiting (${oppName}) transmission.`;
          this._bannerEl.classList.add("show");
        }
      }
    }
  };

  window.MSS_TurnLock = MOD;
})();
