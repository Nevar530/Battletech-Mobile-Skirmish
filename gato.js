/* ===== gato.js — BattleTech (Classic) rolls engine (pure functions) =====
   Usage example:
     import * as GATO from './gato.js';
     const tn = GATO.computeToHit(attacker, target, weapon, ctx);
     const res = GATO.resolveAttack(attacker, target, weapon, ctx, GATO.rng());
*/

export const RNG = () => Math.random();

/* ---------- Types (informal) ----------
attacker = { gunnery: 4, piloting: 5, moved: 'walk'|'run'|'jump', jumpDist:0, tcomp:false, heat:0, todBonus:0 }
target   = { movedHexes: 0, inWood:0, partialCover:false, prone:false, immobile:false, hullFacing:'front'|'left'|'right'|'rear' }
weapon   = { name:'ER Medium Laser', dmg:5, type:'energy'|'ballistic'|'missile',
             short:3, med:6, long:9, min:0, acc:0, pulse:false, cluster:{size:0, table:null}, heat:3 }
ctx      = { range:5, los:'clear'|'woods'|'partial',
             attackerHeight:0, targetHeight:0, elevationDiff:0, calledShot:false, aimedLoc:null,
             night:false, lightWoodsHexes:0, heavyWoodsHexes:0, attackerProne:false,
             modifiers:{ custom:0 } }
----------------------------------------*/

/* ===== Mod tables ===== */
const TARGET_MOVE_MOD = [
  {hexes:0, mod:0},{hexes:1,mod:1},{hexes:2,mod:1},{hexes:3,mod:2},{hexes:4,mod:2},
  {hexes:5,mod:3},{hexes:6,mod:3},{hexes:7,mod:4},{hexes:8,mod:4},{hexes:9,mod:5},
]; // 0..9+; beyond last, clamp to last

const ATTACKER_MOVE_MOD = {
  stand: 0, walk: 0, run: 2, jump: 3
};

const WOODS_MOD = (light, heavy) => (light * 1) + (heavy * 2); // per hex in LOS segments

/* Missile cluster tables (2d6 -> hits) */
const LRM_CLUSTER = { // BT:LRM5/10/15/20 table simplified mapper
  5:  [0,2,2,3,3,4,4,4,5,5,5,5,5],   // index 2..12 by 2d6
  10: [0,3,4,5,6,6,6,7,8,9,10,10,10],
  15: [0,5,5,7,8,9,9,10,11,12,14,15,15],
  20: [0,6,6,9,10,12,12,14,15,16,18,20,20],
};

const SRM_CLUSTER = { 2: [0,1,1,1,2,2,2,2,2,2,2,2,2], 4: [0,2,2,3,3,3,3,3,4,4,4,4,4], 6: [0,2,3,3,4,4,4,5,5,6,6,6,6] };

export function clamp(val, min, max){ return Math.max(min, Math.min(max, val)); }

/* ===== Dice ===== */
export function roll2d6(rng = RNG){
  return (1 + Math.floor(rng()*6)) + (1 + Math.floor(rng()*6));
}

/* ===== Range band & modifiers ===== */
export function getRangeBand(weapon, range){
  if (range <= weapon.short) return 'short';
  if (range <= weapon.med)   return 'medium';
  if (range <= weapon.long)  return 'long';
  return 'beyond';
}

export function rangeMod(weapon, band){
  switch (band){
    case 'short': return 0;
    case 'medium': return 2;
    case 'long': return 4;
    default: return Infinity; // out of range
  }
}

export function minRangePenalty(weapon, range){
  if (!weapon.min || range >= weapon.min) return 0;
  // +1 per hex inside min range (some weapons cap at +6; apply generic cap)
  return clamp(weapon.min - range, 0, 6);
}

/* ===== To-Hit Calculation ===== */
export function computeToHit(attacker, target, weapon, ctx){
  if (target.immobile) return 4; // standard “immobile target” base TN

  const band = getRangeBand(weapon, ctx.range);
  const base = attacker.gunnery;

  if (band === 'beyond') return Infinity;

  const attMove = ATTACKER_MOVE_MOD[attacker.moved || 'stand'] ?? 0;
  const tgtMoveHexes = clamp(target.movedHexes ?? 0, 0, 99);
  const tgtMove = TARGET_MOVE_MOD.findLast(e => tgtMoveHexes >= e.hexes)?.mod ?? 0;

  const woods = WOODS_MOD(ctx.lightWoodsHexes||0, ctx.heavyWoodsHexes||0);
  const partialCover = (target.partialCover ? 1 : 0);
  const proneMod = (target.prone ? 1 : 0); // simple baseline

  const rMod = rangeMod(weapon, band);
  const minPen = minRangePenalty(weapon, ctx.range);

  // Accuracy bonuses
  const pulseBonus = weapon.pulse ? -2 : 0;
  const tcompBonus = attacker.tcomp ? -1 : 0;

  const nightMod = ctx.night ? 2 : 0;
  const losMod = (ctx.los === 'partial' ? 1 : 0);

  const custom = (ctx.modifiers?.custom ?? 0) + (attacker.todBonus ?? 0);

  let tn = base + attMove + tgtMove + woods + partialCover + proneMod + rMod + minPen + nightMod + losMod + custom + pulseBonus + tcompBonus;

  // Called shots (optional simple model): +3 unless special case
  if (ctx.calledShot && !target.immobile) tn += 3;

  return Math.max(2, tn); // floor at 2
}

/* ===== Hit location (2d6 tables, simplified ‘mech) ===== */
const HIT_LOC = {
  front: { 2:'CT',3:'RA',4:'RA',5:'RL',6:'RT',7:'CT',8:'LT',9:'LL',10:'LA',11:'LA',12:'HD' },
  rear:  { 2:'CTR',3:'RA',4:'RA',5:'RR',6:'RTR',7:'CTR',8:'LTR',9:'LR',10:'LA',11:'LA',12:'HD' },
  left:  { 2:'LT',3:'LA',4:'LA',5:'LL',6:'LT',7:'CT',8:'RT',9:'RL',10:'RA',11:'RA',12:'HD' },
  right: { 2:'RT',3:'RA',4:'RA',5:'RL',6:'RT',7:'CT',8:'LT',9:'LL',10:'LA',11:'LA',12:'HD' },
};

export function rollHitLocation(facing, rng = RNG){
  const r = roll2d6(rng);
  const table = HIT_LOC[facing || 'front'] || HIT_LOC.front;
  return { roll:r, loc: table[r] || 'CT' };
}

/* ===== Cluster resolution ===== */
function clusterHits(weapon, roll, rng = RNG){
  if (!weapon.cluster || weapon.cluster.size <= 0) return null;
  const size = weapon.cluster.size;
  const t = (weapon.name||'').toUpperCase().includes('LRM') ? LRM_CLUSTER[size] : SRM_CLUSTER[size];
  if (!t) return null;
  const hits = t[roll] || 0;
  return { size, hits };
}

/* ===== Resolve attack ===== */
export function resolveAttack(attacker, target, weapon, ctx, rng = RNG){
  const tn = computeToHit(attacker, target, weapon, ctx);
  if (!Number.isFinite(tn)) return { hit:false, tn, note:'Out of range' };

  const roll = roll2d6(rng);
  const hit = roll >= tn;

  if (!hit) return { hit:false, tn, roll };

  // Cluster behavior (missiles, some LBX); otherwise single packet
  const facing = target.hullFacing || 'front';
  const locRoll = roll2d6(rng);
  const baseLoc = rollHitLocation(facing, () => { /* override with prior */ return 0; });
  baseLoc.roll = locRoll; baseLoc.loc = (HIT_LOC[facing]||HIT_LOC.front)[locRoll] || 'CT';

  let packets = [];

  if (weapon.cluster && weapon.cluster.size > 0){
    const cl = clusterHits(weapon, roll, rng);
    const per = weapon.cluster.per || (weapon.type === 'missile' ? 1 : weapon.dmg);
    const n = cl ? cl.hits : 0;
    for (let i=0;i<n;i++){
      const rLoc = roll2d6(rng);
      const loc = (HIT_LOC[facing]||HIT_LOC.front)[rLoc] || 'CT';
      packets.push({ dmg: per, loc, locRoll:rLoc });
    }
  } else {
    packets.push({ dmg: weapon.dmg, loc: baseLoc.loc, locRoll: baseLoc.roll });
  }

  return {
    hit:true,
    tn, roll,
    packets,          // [{dmg, loc, locRoll}, ...]
    heat: weapon.heat || 0,
  };
}

/* ===== Piloting skill rolls (PSR), Heat, etc. ===== */
export function pilotingCheck(piloting, modifiers = 0, rng = RNG){
  const tn = piloting + modifiers;
  const roll = roll2d6(rng);
  return { success: roll >= tn, tn, roll };
}

/* ===== Example weapon helpers ===== */
export const Weapons = {
  ER_Medium: { name:'ER Medium Laser', dmg:5, type:'energy', short:5, med:10, long:15, min:0, pulse:false, heat:5 },
  AC5:       { name:'AC/5', dmg:5, type:'ballistic', short:6, med:12, long:18, min:0, heat:1 },
  LRM20:     { name:'LRM 20', dmg:0, type:'missile', short:7, med:14, long:21, min:0, heat:6, cluster:{ size:20, per:1 } },
  SRM6:      { name:'SRM 6', dmg:0, type:'missile', short:3, med:6, long:9,  min:0, heat:4, cluster:{ size:6, per:2 } },
};

/* ===== Thin façade for UI integration ===== */
export function makeAttack(attacker, target, weapon, ctx, rng = RNG){
  const result = resolveAttack(attacker, target, weapon, ctx, rng);
  // Hook: apply heat, mark PSR triggers, ammo tracking, etc. in your app layer.
  return result;
}
