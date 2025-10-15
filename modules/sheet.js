
/* =====================
   sheet.js (updated)
   - Adds "Load from JSON" button
   - Robust mech manifest resolver (uses model code from token label)
   - Auto-hydrate static fields from /data/... JSON
   - Weapons stats enrichment from /data/weapons.json (aliases supported)
   - Preserves dynamic fields; marks token dirty
   ===================== */

/* NOTE: This file assumes the rest of your sheet module structure exists.
   It augments behavior without changing external APIs.
*/

(function(){
  const STORAGE_NS = 'mss84:sheet';
  const DIRTY_NS   = 'mss84:sheets:dirty';

  // Expose minimal public API bucket if not present
  if (!window.MSS84_SHEET) window.MSS84_SHEET = {};

  // ---- Helpers: storage keys & dirty flag ----
  function skey(mapId, tokenId){ return `${STORAGE_NS}:${mapId || 'local'}:${tokenId}`; }
  function dkey(mapId){ return `${DIRTY_NS}:${mapId || 'local'}`; }

  function markSheetDirty(mapId, tokenId){
    try {
      const k = dkey(mapId);
      const cur = JSON.parse(localStorage.getItem(k) || '{}');
      cur[tokenId] = true;
      localStorage.setItem(k, JSON.stringify(cur));
    } catch {}
  }

  // ---- Armor mapping helpers ----
  const LOCS = ['HD','CT','LT','RT','LA','RA','LL','RL'];
  const HAS_REAR = new Set(['LT','CT','RT']);
  const ARMOR_KEY_MAP = {
    HD: ['HD','Head','head'],
    CT: ['CT','Center Torso','Center','CTR','centerTorso'],
    LT: ['LT','Left Torso','LTorso','leftTorso'],
    RT: ['RT','Right Torso','RTorso','rightTorso'],
    LA: ['LA','Left Arm','leftArm'],
    RA: ['RA','Right Arm','rightArm'],
    LL: ['LL','Left Leg','leftLeg'],
    RL: ['RL','Right Leg','rightLeg'],
  };
  function resolveArmorBlock(armorObj, locCode){
    if (!armorObj) return null;

    // Flat form (your JSON)
    const flat = {
      HD: { Front: armorObj.head },
      CT: { Front: armorObj.centerTorso, Rear: armorObj.rearCenterTorso },
      LT: { Front: armorObj.leftTorso,   Rear: armorObj.rearLeftTorso   },
      RT: { Front: armorObj.rightTorso,  Rear: armorObj.rearRightTorso  },
      LA: { Front: armorObj.leftArm },
      RA: { Front: armorObj.rightArm },
      LL: { Front: armorObj.leftLeg },
      RL: { Front: armorObj.rightLeg },
    };
    const blk = flat[locCode];
    if (blk && (blk.Front != null || blk.Rear != null)) return blk;

    // Nested form fallback
    const keys = ARMOR_KEY_MAP[locCode] || [locCode];
    for (const k of keys){ if (armorObj[k] != null) return armorObj[k]; }
    return null;
  }

  // ---- Weapons DB (with alias matching) ----
  let WEAP_DB = null;
  async function getWeaponsDb(){
    if (WEAP_DB) return WEAP_DB;
    try {
      const r = await fetch('data/weapons.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('weapons.json not found');
      const arr = await r.json();
      // Build index by lowercased name and aliases
      const byKey = new Map();
      const canon = new Map();
      arr.forEach(w => {
        const name = String(w.name || w.id || '').trim();
        if (!name) return;
        const entry = {
          id: w.id || name,
          name,
          type: w.type || '',
          damage: Number(w.damage || 0) || 0,
          heat: Number(w.heat || 0) || 0,
          ammo: (w.ammo == null ? null : String(w.ammo)),
          range: Object.assign({ pointblank: '-', short: 0, medium: 0, long: 0 }, w.range || {}),
        };
        canon.set(name.toLowerCase(), entry);
        const keys = new Set([name.toLowerCase()]);
        if (Array.isArray(w.aliases)) {
          w.aliases.forEach(a => {
            if (!a) return;
            keys.add(String(a).toLowerCase());
            // Expand alias patterns like "{k}" with 2/5/10/20, etc.
            if (String(a).includes('{k}')) {
              [2,3,4,5,6,7,8,9,10,12,15,20,30,40].forEach(n => {
                keys.add(String(a).replaceAll('{k}', String(n)).toLowerCase());
              });
            }
          });
        }
        keys.forEach(k => byKey.set(k, entry));
      });
      WEAP_DB = { list: arr, byKey, canon };
      return WEAP_DB;
    } catch (e) {
      console.warn('weapons db load failed', e);
      WEAP_DB = { list: [], byKey: new Map(), canon: new Map() };
      return WEAP_DB;
    }
  }

  function matchWeaponStatsSync(db, raw){
    if (!db) return null;
    const keyCandidates = [];
    const n = (s)=>String(s||'').trim();
    const tName = n(raw.Name || raw.name || raw.Type || raw.type);
    if (!tName) return null;
    keyCandidates.push(tName.toLowerCase());

    // Common simplifications
    keyCandidates.push(tName.replace(/\s+/g,' ').toLowerCase());
    keyCandidates.push(tName.replace(/\s+/g,'').toLowerCase());
    keyCandidates.push(tName.replaceAll('-', ' ').toLowerCase());

    // LRMs, SRMs often appear as "LRM 15", "Streak SRM 6", etc.
    // Already covered by weapons.json aliases.

    for (const k of keyCandidates){
      if (db.byKey.has(k)) return db.byKey.get(k);
    }
    return null;
  }

  // ---- Token label helper (DOM-first, no script.js changes required) ----
  function getTokenLabelById(mapId, tokenId){
    try {
      const g = document.querySelector(`svg .token[data-id="${tokenId}"]`);
      const t = g?.querySelector('.label, text.label, text')?.textContent || '';
      return (t||'').trim();
    } catch { return ''; }
  }

  // ---- Current context managed by sheet.js ----
  let current = { mapId: null, tokenId: null };
  let sheet = null;

  // Minimal shims for functions the host app already provides
  function pulseSaved(){ /* optional: visual pulse */ }
  function hydrateAll(){}
  function renderBars(){}
  function renderArmor(){}
  function renderHeatBar(){}
  function syncHeatEffectField(){}
  function renderCritBoards(){}
  function renderWeapons(){}
  function QS(sel, root){ return (root||document).querySelector(sel); }

  // Load & Save (keep per-token)
  function load(mapId, tokenId){
    try {
      const raw = localStorage.getItem(skey(mapId, tokenId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function save(mapId, tokenId, data){
    try {
      localStorage.setItem(skey(mapId, tokenId), JSON.stringify(data));
      markSheetDirty(mapId, tokenId);
      pulseSaved();
    } catch {}
  }

  // ---- Static loader from manifest + mech JSON ----
  async function loadStaticFromJson(fillMode = 'fill'){
    const mapId = current.mapId, tokenId = current.tokenId;
    if (!mapId || !tokenId) return;

    try {
      // gather hints
      const chassis = (sheet?.mech?.chassis || '').trim();
      const variant = (sheet?.mech?.variant || '').trim();
      let modelHint = (variant || '').toUpperCase();
      let labelHint = `${chassis} ${variant}`.trim();
      // fall back to token label
      const lab = getTokenLabelById(mapId, tokenId);
      if (lab) {
        const parts = lab.split(/\s+/);
        if (parts.length === 1) modelHint = parts[0].toUpperCase();
        if (!labelHint) labelHint = lab;
        if (!modelHint && parts.length > 1) modelHint = parts[parts.length-1].toUpperCase();
      }

      // manifest
      let manifest = null;
      try { manifest = await (await fetch('data/manifest.json', {cache:'no-store'})).json(); } catch {}
      const list = Array.isArray(manifest) ? manifest
                : Array.isArray(manifest?.items) ? manifest.items
                : Array.isArray(manifest?.entries) ? manifest.entries
                : [];

      if (!list.length) { console.warn('Load from JSON: manifest empty'); return; }

      // match row: model preferred
      let match = null;
      if (modelHint) {
        match = list.find(e => String(e?.model||'').toUpperCase() === modelHint) || null;
      }
      if (!match && labelHint) {
        const norm = s => String(s||'').toLowerCase();
        match = list.find(e => norm(e?.displayName || e?.name || e?.title) === norm(labelHint)) || null;
      }
      if (!match) {
        console.warn('Load from JSON: no manifest match', { labelHint, modelHint });
        return;
      }

      // path
      let path = match.path || match.file || match.url || '';
      if (!path) { console.warn('Load from JSON: manifest row has no path/file'); return; }
      if (!path.startsWith('data/')) path = `data/${path}`;

      // mech json
      let mech = null;
      try { mech = await (await fetch(path, {cache:'no-store'})).json(); } catch {}
      if (!mech) { console.warn('Load from JSON: mech file not found or invalid at', path); return; }

      const overwriteStatic = (fillMode === 'static' || fillMode === 'all');
      const overwriteAll    = (fillMode === 'all');

      // Ensure base sheet object
      if (!sheet) sheet = {};
      sheet.v = sheet.v || 1;
      sheet.mech = sheet.mech || { chassis:'', variant:'', tonnage:0 };
      sheet.move = sheet.move || { stand:0, walk:0, run:0, jump:0 };
      sheet.heat = sheet.heat || { current:0, sinks:0 };
      sheet.armor = sheet.armor || {};
      LOCS.forEach(L => {
        sheet.armor[L] = sheet.armor[L] || { ext:{cur:0,max:0}, str:{cur:0,max:0} };
        if (HAS_REAR.has(L)) sheet.armor[L].rear = sheet.armor[L].rear || { cur:0, max:0 };
      });
      sheet.weapons = sheet.weapons || [];
      sheet.nextWid = sheet.nextWid || 1;
      sheet.pilot = sheet.pilot || { name:'', callsign:'', gunnery:4, piloting:5, hits:[] };
      sheet.notes = sheet.notes || '';

      // Identity
      const mChassis = mech.Chassis || mech.chassis || sheet.mech.chassis;
      const mVariant = mech.Variant || mech.variant || mech.model || sheet.mech.variant;
      const mTons    = Number(mech.Tons || mech.Tonnage || mech.tonnage || mech.mass || sheet.mech.tonnage || 0) || 0;

      if (overwriteAll || overwriteStatic || !sheet.mech.chassis) sheet.mech.chassis = mChassis;
      if (overwriteAll || overwriteStatic || !sheet.mech.variant) sheet.mech.variant = mVariant;
      if (overwriteAll || overwriteStatic || !sheet.mech.tonnage) sheet.mech.tonnage = mTons;

      // Movement
      const mv = mech.Movement || mech.movement || {};
      const w = Number(mv.Walk || mv.walk || 0) || 0;
      const r = Number(mv.Run  || mv.run  || (w ? (w+2) : 0)) || 0;
      const j = Number(mv.Jump || mv.jump || 0) || 0;
      if (overwriteAll || overwriteStatic || !sheet.move.walk) sheet.move.walk = w || sheet.move.walk;
      if (overwriteAll || overwriteStatic || !sheet.move.run ) sheet.move.run  = r || sheet.move.run;
      if (overwriteAll || overwriteStatic || !sheet.move.jump) sheet.move.jump = j || sheet.move.jump;

      // Heat sinks (parse "12 Single")
      const sinksRaw = (mech.HeatSinks ?? mech.heatSinks ?? mech?.heat?.sinks ?? sheet.heat.sinks) || 0;

      const sinks = (typeof sinksRaw === 'string') ? (parseInt(sinksRaw,10) || 0) : (Number(sinksRaw)||0);
      if (overwriteAll || overwriteStatic || !sheet.heat.sinks) sheet.heat.sinks = sinks || sheet.heat.sinks;

      // Armor
      const armorMax = mech.Armor || mech.armor || {};
      if (armorMax && typeof armorMax === 'object') {
        for (const L of LOCS) {
          const block = resolveArmorBlock(armorMax, L) || {};
          const get = v => Number(v||0) || 0;
          const extMax  = get(block.ext || block.Front || block.Armor || block.Max);
          const rearMax = get(block.rear || block.Rear);
          const strMax  = get(block.str  || block.Structure);

          if (overwriteAll || overwriteStatic) {
            sheet.armor[L].ext.max  = extMax;
            if (sheet.armor[L].rear) sheet.armor[L].rear.max = rearMax;
            sheet.armor[L].str.max  = strMax;
          } else {
            if (!sheet.armor[L].ext.max)  sheet.armor[L].ext.max  = extMax;
            if (sheet.armor[L].rear && !sheet.armor[L].rear.max) sheet.armor[L].rear.max = rearMax;
            if (!sheet.armor[L].str.max)  sheet.armor[L].str.max  = strMax;
          }

          if (!(sheet.armor[L].ext.cur > 0))  sheet.armor[L].ext.cur  = sheet.armor[L].ext.max;
          if (sheet.armor[L].rear && !(sheet.armor[L].rear.cur > 0)) sheet.armor[L].rear.cur = sheet.armor[L].rear.max;
          if (!(sheet.armor[L].str.cur > 0))  sheet.armor[L].str.cur  = sheet.armor[L].str.max;
        }
      }

      // Weapons: enrich using weapons.json
      const srcWeaps = Array.isArray(mech.Weapons) ? mech.Weapons
                      : Array.isArray(mech.weapons) ? mech.weapons : null;
      if (srcWeaps && (overwriteAll || overwriteStatic || (sheet.weapons||[]).length === 0)) {
        const db = await getWeaponsDb();
        sheet.weapons = [];
        srcWeaps.forEach(wi => {
          const nameLike = (wi.Name || wi.name || wi.Type || wi.type || '').trim();
          const match = matchWeaponStatsSync(db, wi);
          const stats = match || null;
          const ammoMax = stats ? 0 : Number(wi?.AmmoMax || wi?.Ammo || wi?.ammo?.max || 0) || 0; // mech files usually don't carry this
          const isEnergy = stats ? (String(stats.type||'').toLowerCase()==='energy')
                                 : /laser|ppc|plasma|flamer/i.test(nameLike);

          sheet.weapons.push({
            wid: sheet.nextWid++,
            name: nameLike,
            type: stats ? stats.type : (wi.Type || wi.type || ''),
            dmg:  stats ? stats.damage : Number(wi.Damage || wi.damage || 0) || 0,
            heat: stats ? stats.heat   : Number(wi.Heat   || wi.heat   || 0) || 0,
            min:  stats ? (stats.range.pointblank==='-'?0:Number(stats.range.pointblank||0)||0) : Number(wi.Min||wi.min||0)||0,
            s:    stats ? Number(stats.range.short  ||0)||0 : Number(wi.Short||wi.s||0)||0,
            m:    stats ? Number(stats.range.medium ||0)||0 : Number(wi.Medium||wi.m||0)||0,
            l:    stats ? Number(stats.range.long   ||0)||0 : Number(wi.Long||wi.l||0)||0,
            ammo: {
              max: stats && stats.ammo ? (typeof stats.ammo === 'string' ? 0 : Number(stats.ammo||0)||0) : ammoMax,
              cur: stats && stats.ammo ? (typeof stats.ammo === 'string' ? 0 : Number(stats.ammo||0)||0) : (isEnergy ? 0 : ammoMax)
            }
          });
        });
      }

      // Persist & render
      save(mapId, tokenId, sheet);
      hydrateAll(); renderBars(); renderArmor(); renderHeatBar(); syncHeatEffectField(); renderCritBoards(); renderWeapons();
      console.log('Load from JSON: OK', { path, mode: fillMode, modelHint, labelHint });

    } catch (e) {
      console.warn('Load from JSON: failed', e);
    }
  }

  // ---- Mount: wire button, keep API ----
  function mount(mapId, tokenId){
    current.mapId = mapId; current.tokenId = tokenId;
    sheet = load(mapId, tokenId) || sheet || {
      v:1, mech:{chassis:'',variant:'',tonnage:0}, move:{stand:0,walk:0,run:0,jump:0},
      heat:{current:0,sinks:0}, armor:{},
      weapons:[], nextWid:1, pilot:{name:'',callsign:'',gunnery:4,piloting:5,hits:[]}, notes:''
    };
    // ensure armor shape
    LOCS.forEach(L => {
      sheet.armor[L] = sheet.armor[L] || { ext:{cur:0,max:0}, str:{cur:0,max:0} };
      if (HAS_REAR.has(L)) sheet.armor[L].rear = sheet.armor[L].rear || { cur:0, max:0 };
    });

    // Button presence is optional; create if missing
    let btn = QS('#loadFromJsonBtn');
    if (!btn) {
      const header = document.querySelector('.mss84-sheet__hdr, .mss84-sheet .hdr, .mss84-sheet');
      if (header) {
        btn = document.createElement('button');
        btn.id = 'loadFromJsonBtn';
        btn.className = 'mss84-sheet__x';
        btn.title = 'Pull static data from local /data JSON';
        btn.textContent = 'Load from JSON';
        header.insertBefore(btn, header.firstChild);
      }
    }
    if (btn && !btn.__wired) {
      btn.__wired = true;
      btn.addEventListener('click', ()=>loadStaticFromJson('fill'));
    }

    // initial render (host app usually does this)
    hydrateAll(); renderBars(); renderArmor(); renderHeatBar(); syncHeatEffectField(); renderCritBoards(); renderWeapons();
  }

  // Public API compatibility
  window.MSS84_SHEET.mount = mount;
  window.MSS84_SHEET.setIds = function(mapId, tokenId){ mount(mapId, tokenId); };
  window.MSS84_SHEET.loadStaticFromJson = loadStaticFromJson;
  window.MSS84_SHEET._getWeaponsDb = getWeaponsDb;

})();
