/* ===== MSS:84 Compiler (data resolver) =====
   Purpose: Given (mapId, tokenId), resolve the tagged mech, load manifest + mech + weapons + bv,
   and return a normalized view model for the sheet UI.

   Exposes: window.MSS84_COMPILER with:
     - resolveForToken(mapId, tokenId) -> Promise<NormalizedMech>
     - resolveFromRef(mechRef) -> Promise<NormalizedMech>  // mechRef can be key or direct URL
     - primeCaches() -> Promise<void>                       // preload manifest/weapons/bv
     - clearCaches()

   Notes:
   - Tries multiple ways to resolve the mech reference:
       1) window.MSS84_getMechRefForToken?.(mapId, tokenId)
       2) localStorage["mss84:token:<mapId>:<tokenId>:mechRef"]
       3) localStorage["mss84:token:<tokenId>:mechRef"] (legacy, no map scope)
       4) localStorage["mss84:sheet:mechPath"] (global, last-loaded)
   - Manifest supports common shapes:
       { "mechs": [{ id, key, path, url, name, variant, ... }, ...] }
       or { "<key>": "<path or url>", ... }
       or [ { id/key/name/path/url }, ... ]
   - Weapons and BV expected under /data/weapons.json and /data/bv.json relative to baseURI.
*/

(() => {
  const API = {};
  const BASE = new URL(".", document.baseURI);

  // Caches
  let MANIFEST = null;  // raw manifest JSON
  let WEAPONS  = null;  // Array
  let BVDB     = null;  // Array or Map-like

  // Helpers
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const asNum = (v, d=0) => (Number.isFinite(+v) ? +v : d);
  const normKey = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[\s._\-\/]+/g, " ")  // spaces, dot, underscore, hyphen, slash
    .trim();


  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch ${url} -> ${res.status}`);
    return res.json();
  }

  function dataURL(rel) {
    // Ensure we point to /data/... from current base
    return new URL(rel, BASE).href;
  }

  async function ensureManifest() {
    if (MANIFEST) return MANIFEST;
    try {
      MANIFEST = await fetchJSON(dataURL("data/manifest.json"));
    } catch (e) {
      console.warn("[MSS84_COMPILER] manifest.json load failed", e);
      MANIFEST = {};
    }
    return MANIFEST;
  }

  async function ensureWeapons() {
    if (WEAPONS) return WEAPONS;
    try {
      WEAPONS = await fetchJSON(dataURL("data/weapons.json"));
    } catch (e) {
      console.warn("[MSS84_COMPILER] weapons.json load failed", e);
      WEAPONS = [];
    }
    return WEAPONS;
  }

  async function ensureBV() {
    if (BVDB) return BVDB;
    try {
      BVDB = await fetchJSON(dataURL("data/bv.json"));
    } catch (e) {
      console.warn("[MSS84_COMPILER] bv.json load failed", e);
      BVDB = [];
    }
    return BVDB;
  }

  function manifestFind(mechRef, manifest) {
    if (!mechRef) return null;
    const key = normKey(mechRef);

    // Case 1: object with "mechs" array
    if (manifest && Array.isArray(manifest.mechs)) {
      for (const m of manifest.mechs) {
        const id  = normKey(m.id || m.key || m.name || "");
        if (id && id === key) return m;
      }
    }
    // Case 2: flat object map { key: path }
    if (manifest && !Array.isArray(manifest)) {
      for (const k of Object.keys(manifest)) {
        if (normKey(k) === key) return { id: k, path: manifest[k], ...((typeof manifest[k] === "object") ? manifest[k] : {}) };
      }
    }
    // Case 3: array of entries
    if (Array.isArray(manifest)) {
      for (const m of manifest) {
        const id = normKey(m.id || m.key || m.name || "");
        if (id && id === key) return m;
      }
    }
    return null;
  }

  function mechPathFromManifestEntry(entry) {
    if (!entry) return null;
    // Prefer explicit url, then path; both may be relative to /data/
    if (entry.url)  return String(entry.url);
    if (entry.path) return String(entry.path);
    // Some manifests may store folder + filename parts
    if (entry.folder && entry.file) return `${entry.folder.replace(/\/$/,"")}/${entry.file}`;
    return null;
  }

  async function loadMechByRef(mechRef) {
    if (!mechRef) throw new Error("No mechRef");
    // If mechRef looks like a URL or ends with .json, load directly
if (/^(?:https?:\/\/|\/\/)/i.test(mechRef) || /\.json$/i.test(mechRef)) {
  const url = new URL(mechRef, BASE).href;
  return fetchJSON(url);
}
    const manifest = await ensureManifest();
    const entry = manifestFind(mechRef, manifest);
    if (!entry) throw new Error(`Manifest could not resolve "${mechRef}"`);
    const rel = mechPathFromManifestEntry(entry);
    if (!rel) throw new Error(`Manifest entry for "${mechRef}" missing path/url`);
    const url = new URL(rel, BASE).href;
    return fetchJSON(url);
  }

  function enrichWeapons(mechWeaps, catalog) {
    const byKey = new Map();
    for (const w of catalog || []) {
      if (!w) continue;
      const keys = new Set([w.id, w.name, ...(w.aliases || [])].map(normKey));
      keys.forEach(k => k && !byKey.has(k) && byKey.set(k, w));
    }
    const out = [];
    for (const w of mechWeaps || []) {
      const key = normKey(w.name || w.type || w.id || "");
      const rec = (key && byKey.get(key)) || null;
      const rng = rec?.range || {};
      out.push({
        id: w.id || rec?.id || key || null,
        name: w.name || rec?.name || w.type || "—",
        type: rec?.type || w.type || "",
        damage: asNum(rec?.damage ?? w.damage ?? "", ""),
        heat: asNum(rec?.heat ?? w.heat ?? "", ""),
        range: {
          min: asNum(rng.min ?? w?.range?.min ?? "", ""),
          short: asNum(rng.short ?? w?.range?.short ?? "", ""),
          medium: asNum(rng.medium ?? w?.range?.medium ?? "", ""),
          long: asNum(rng.long ?? w?.range?.long ?? "", ""),
        },
        ammoMax: rec?.ammo ?? null,
        ammoPerShot: asNum(rec?.ammoPerShot ?? 1, 1),
        enabledDefault: true,
      });
    }
    return out;
  }

  function deriveMelee(tonnage) {
    const t = asNum(tonnage, 0);
    const punch  = Math.ceil(t / 10);
    const kick   = Math.ceil(t / 5);
    const charge = Math.ceil(t / 10);
    const dfa    = Math.ceil(kick * 1.5);
    return [
      { name: "Punch",  type:"Melee", damage: punch,  heat:0 },
      { name: "Kick",   type:"Melee", damage: kick,   heat:0 },
      { name: "Charge", type:"Melee", damage: charge, heat:0 },
      { name: "DFA",    type:"Melee", damage: dfa,    heat:0 },
    ];
  }

  function normalizeLocations(mech) {
    // Accept different source shapes; produce predictable armor/internals/equipment maps.
    const ABL = mech.armorByLocation || mech.armor || {};
    const IBL = mech.internalByLocation || mech.internals || mech.internal || {};
    const EQL = mech.equipmentByLocation || mech.locations || {};

    function pullArmor(code, fallback) {
      const obj = ABL[code] ?? fallback ?? null;
      if (obj && typeof obj === "object") {
        return { f: +obj.a ?? +obj.front ?? +obj.value ?? 0, r: +obj.r ?? +obj.rear ?? 0 };
      }
      // allow single number for front
      const n = asNum(obj, 0);
      return { f: n, r: 0 };
    }
    function pullInternals(code, fallback) {
      const obj = IBL[code] ?? fallback ?? null;
      if (obj && typeof obj === "object") return +obj.s ?? +obj.value ?? 0;
      return asNum(obj, 0);
    }
    const map = {LA:"leftArm",LL:"leftLeg",LT:"leftTorso",CT:"centerTorso",HD:"head",RT:"rightTorso",RL:"rightLeg",RA:"rightArm"};
    const eqBy = {};
    for (const k of Object.keys(map)) {
      const arr = EQL[k] || EQL[map[k]] || [];
      eqBy[k] = Array.isArray(arr) ? arr.slice() : [];
    }

    return {
      armorMax: {
        HD: pullArmor("HD", ABL.head),
        CT: pullArmor("CT", ABL.centerTorso),
        RT: pullArmor("RT", ABL.rightTorso),
        LT: pullArmor("LT", ABL.leftTorso),
        RA: pullArmor("RA", ABL.rightArm),
        LA: pullArmor("LA", ABL.leftArm),
        RL: pullArmor("RL", ABL.rightLeg),
        LL: pullArmor("LL", ABL.leftLeg),
      },
      internals: {
        HD: pullInternals("HD"),
        CT: pullInternals("CT"),
        RT: pullInternals("RT"),
        LT: pullInternals("LT"),
        RA: pullInternals("RA"),
        LA: pullInternals("LA"),
        RL: pullInternals("RL"),
        LL: pullInternals("LL"),
      },
      equipmentByLocation: eqBy,
    };
  }

  function attachBV(mech, bvdb) {
    // Try to find a matching BV based on id/name/variant.
    const list = Array.isArray(bvdb) ? bvdb : [];
    const candKey = normKey(`${mech.name} ${mech.variant || ""}`);
    let found = null;
    for (const r of list) {
      const k = normKey(`${r.name || r.chassis || ""} ${r.variant || ""}`);
      if (k && k === candKey) { found = r; break; }
    }
    return found?.bv ?? mech.bv ?? mech.BV ?? null;
  }

  async function compile(mech) {
    const [wep, bvdb] = await Promise.all([ensureWeapons(), ensureBV()]);
    const weapons = enrichWeapons(mech.weapons || mech.Arms || mech.armament || [], wep);
    const melee = deriveMelee(mech.tonnage ?? mech.Tonnage ?? mech.mass ?? 0);
    const locs = normalizeLocations(mech);
    const mv = mech.movement || mech.move || mech._mv || {};
    const walk = mv.walk ?? mv.Walk ?? mv.w ?? null;
    const run  = mv.run  ?? mv.Run  ?? mv.r ?? (walk!=null ? Math.ceil(Number(walk)*1.5) : null);
    const jump = mv.jump ?? mv.Jump ?? mv.j ?? null;
    const tech = mech.techBase || mech.tech || null;

    const out = {
      id: mech.id || mech.key || null,
      name: mech.displayName || mech.name || "—",
      variant: mech.model || mech.variant || null,
      techBase: tech,
      tonnage: mech.tonnage ?? mech.Tonnage ?? mech.mass ?? null,
      bv: attachBV(mech, bvdb),
      movement: { walk, run, jump },

      ...locs,
      weapons,
      melee,
    };
    return out;
  }

  function getStoredMechRef(mapId, tokenId) {
    // Try callback first
    try {
      if (typeof window.MSS84_getMechRefForToken === "function") {
        const v = window.MSS84_getMechRefForToken(mapId, tokenId);
        if (v) return v;
      }
    } catch {}

    const ls = localStorage;
    const v1 = ls.getItem(`mss84:token:${mapId}:${tokenId}:mechRef`);
    if (v1) return v1;
    const v2 = ls.getItem(`mss84:token:${tokenId}:mechRef`);
    if (v2) return v2;
    const v3 = ls.getItem(`mss84:sheet:mechPath`);
    if (v3) return v3;
    return null;
  }

  // ===== Public API =====
  API.resolveForToken = async (mapId, tokenId) => {
    const mechRef = getStoredMechRef(mapId, tokenId);
    if (!mechRef) throw new Error("No mech reference for token");
    const raw = await loadMechByRef(mechRef);
    return compile(raw);
  };

  API.resolveFromRef = async (mechRef) => {
    const raw = await loadMechByRef(mechRef);
    return compile(raw);
  };

  API.primeCaches = async () => { await Promise.all([ensureManifest(), ensureWeapons(), ensureBV()]); };
  API.clearCaches = () => { MANIFEST = null; WEAPONS = null; BVDB = null; };

  window.MSS84_COMPILER = API;
})();
