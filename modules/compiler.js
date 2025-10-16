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

  // Normalize incoming ref (e.g., "AWS-8R", "Archer AWS-8R", id, key, url-like, etc.)
  const refKey = normKey(mechRef);                    // "aws 8r"
  const looksLikeVariantOnly = /^[A-Za-z]{2,4}\s?\-?\s?\d+[A-Za-z]?$/.test(mechRef);

  // ---- helper to produce candidate keys for a manifest entry
  const entryKeys = (m) => {
    const name    = normKey(m.name    || m.chassis || "");
    const variant = normKey(m.variant || m.model   || "");
    const idk     = normKey(m.id || m.key || "");
    const simple  = new Set();

    // Common ids
    if (idk)     simple.add(idk);
    if (name)    simple.add(name);
    if (variant) simple.add(variant);           // <-- enables matching "AWS-8R" directly
    if (name && variant) {
      simple.add(`${name} ${variant}`);         // "archer aws 8r"
      simple.add(`${variant} ${name}`);         // tolerate flipped inputs
    }
    // Some manifests store path-y keys; include raw if present
    if (m.path) simple.add(normKey(String(m.path)));
    if (m.url)  simple.add(normKey(String(m.url)));

    return simple;
  };

  // ---- Case 1: object with "mechs" array
  if (manifest && Array.isArray(manifest.mechs)) {
    // Exact key match first
    for (const m of manifest.mechs) {
      const keys = entryKeys(m);
      if (keys.has(refKey)) return m;
    }
    // If the ref "looks like" a variant (e.g., "AWS-8R"), match by variant alone
    if (looksLikeVariantOnly) {
      for (const m of manifest.mechs) {
        const v = normKey(m.variant || m.model || "");
        if (v && v === refKey) return m;
      }
    }
  }

  // ---- Case 2: flat object map { key: pathOrEntry }
  if (manifest && !Array.isArray(manifest) && !Array.isArray(manifest.mechs)) {
    // direct key hit
    for (const k of Object.keys(manifest)) {
      if (normKey(k) === refKey) {
        const v = manifest[k];
        // Normalize to an entry with id + path/url
        if (v && typeof v === "object") return { id: k, ...v };
        return { id: k, path: v };
      }
    }
    // if values are entry-like objects, scan them for variant-only match
    if (looksLikeVariantOnly) {
      for (const k of Object.keys(manifest)) {
        const v = manifest[k];
        if (v && typeof v === "object") {
          const vkey = normKey(v.variant || v.model || "");
          if (vkey && vkey === refKey) return { id: k, ...v };
        }
      }
    }
  }

  // ---- Case 3: array of entries
  if (Array.isArray(manifest)) {
    for (const m of manifest) {
      const keys = entryKeys(m || {});
      if (keys.has(refKey)) return m;
    }
    if (looksLikeVariantOnly) {
      for (const m of manifest) {
        const v = normKey(m?.variant || m?.model || "");
        if (v && v === refKey) return m;
      }
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

// --- NEW: flatten any manifest shape into a simple entries array -------------
function flattenManifestEntries(manifest) {
  const out = [];

  const pushEntry = (maybe, idKey) => {
    if (!maybe) return;
    // normalize common shapes into a single entry object
    if (typeof maybe === 'string') {
      out.push({ id: idKey || null, path: maybe });
      return;
    }
    if (typeof maybe === 'object') {
      const e = { ...maybe };
      if (idKey && !e.id && !e.key) e.id = idKey;
      out.push(e);
    }
  };

  const walk = (node, keyHint) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(it => walk(it, null));
      return;
    }
    if (typeof node === 'object') {
      // entry-like (has any of name/variant/path/url/chassis/model)
      const looksEntry =
        ('name' in node) || ('variant' in node) || ('path' in node) ||
        ('url' in node)  || ('chassis' in node) || ('model' in node) ||
        ('file' in node) || ('folder' in node);
      if (looksEntry) {
        pushEntry(node, keyHint);
        return;
      }
      // container/object map – walk children
      for (const k of Object.keys(node)) {
        const v = node[k];
        // if value is a string or entry-like object, push immediately
        if (typeof v === 'string') {
          pushEntry(v, k);
        } else if (v && typeof v === 'object' && (
          'name' in v || 'variant' in v || 'path' in v || 'url' in v ||
          'chassis' in v || 'model' in v || 'file' in v || 'folder' in v
        )) {
          pushEntry(v, k);
        } else {
          walk(v, k);
        }
      }
      return;
    }
    // primitives ignored
  };

  // top-level common keys
  if (manifest && typeof manifest === 'object' && Array.isArray(manifest.mechs)) {
    manifest.mechs.forEach(m => pushEntry(m, null));
  } else {
    walk(manifest, null);
  }

  return out;
}

   
async function loadMechByRef(mechRef) {
  if (!mechRef) throw new Error("No mechRef");

  // Direct URL or explicit JSON file path → fetch immediately
  if (/^(?:https?:\/\/|\/\/)/i.test(mechRef) || /\.json$/i.test(mechRef)) {
    const url = new URL(mechRef, BASE).href;
    return fetchJSON(url);
  }

  const manifest = await ensureManifest();
  // First, try the fast path (existing matcher).
  let entry = manifestFind(mechRef, manifest);

  if (!entry) {
    // Fallback: flatten ANY manifest shape (bucketed/nested maps/arrays)
    const flat = flattenManifestEntries(manifest);
    const want = normKey(mechRef);                 // e.g. "aws 8r"
    const isVariantLike =
      /^[a-z]{2,4}\s?\d{1,3}[a-z]?$/i.test(want) || /^[a-z]{2,4}\s?\-\s?\d{1,3}[a-z]?$/i.test(mechRef);

    // Try strict key hits across common fields
    entry = flat.find(e => {
      const name    = normKey(e.name    || e.chassis || "");
      const variant = normKey(e.variant || e.model   || "");
      const idk     = normKey(e.id || e.key || "");
      const path    = normKey(String(e.path || e.url || ""));
      return (
        idk === want ||
        path === want ||
        name === want ||
        variant === want ||
        (name && variant && (`${name} ${variant}` === want || `${variant} ${name}` === want))
      );
    });

    // If the ref is variant-only like "AWS-8R", allow variant-only match as a last resort
    if (!entry && isVariantLike) {
      entry = flat.find(e => normKey(e.variant || e.model || "") === want);
    }
  }

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
    // Accept richer shapes from the host app
    const ref = getStoredMechRef(mapId, tokenId);

    // 1) If the host gave us the mech JSON directly
    if (ref && typeof ref === 'object' && !Array.isArray(ref) && ref.json) {
      const raw = ref.json;
      return compile(raw);
    }

    // 2) If the host gave us a direct url/path
    if (ref && typeof ref === 'object' && (ref.url || ref.mechPath)) {
      try {
        const url = new URL(ref.url || ref.mechPath, BASE).href;
        const raw = await fetchJSON(url);
        return compile(raw);
      } catch (e) {
        console.warn('[MSS84_COMPILER] direct url/path resolve failed', e);
        return null;
      }
    }

    // 3) If the host gave us a key-ish field (mechRef/mechKey/mechId/name)
    if (ref && typeof ref === 'object') {
      const keyish =
        ref.mechRef || ref.mechKey || ref.mechId || ref.key || ref.id || ref.name || null;
      if (keyish) {
        try {
          const raw = await loadMechByRef(String(keyish));
          return compile(raw);
        } catch (e) {
          console.warn('[MSS84_COMPILER] key resolve failed', e);
          return null;
        }
      }
    }

    // 4) If the host returned a plain string (key or url)
    if (typeof ref === 'string' && ref.trim()) {
      try {
        const raw = await loadMechByRef(ref.trim());
        return compile(raw);
      } catch (e) {
        console.warn('[MSS84_COMPILER] string resolve failed', e);
        return null;
      }
    }

    // Nothing we can use — DO NOT THROW. Let the sheet stay up.
    return null;
  };

  API.resolveFromRef = async (mechRef) => {
    const raw = await loadMechByRef(mechRef);
    return compile(raw);
  };

  API.primeCaches = async () => { await Promise.all([ensureManifest(), ensureWeapons(), ensureBV()]); };
  API.clearCaches = () => { MANIFEST = null; WEAPONS = null; BVDB = null; };

  window.MSS84_COMPILER = API;
})();
