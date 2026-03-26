// modules/iso-geometry.js
(() => {
  const API = {};

  API.ISO_ROT_DEG = 30;
  API.toRad = (deg) => (deg * Math.PI) / 180;

  // Point-down visual hex for ISO mode
  API.hexPointsArrayIso = function hexPointsArrayIso(cx, cy, size, squash = 1) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = API.toRad(API.ISO_ROT_DEG + (60 * i));
      const dx = size * Math.cos(ang);
      const dy = size * Math.sin(ang) * squash;
      pts.push([cx + dx, cy + dy]);
    }
    return pts;
  };

  // Board/base center projection only
  API.offsetToPixelIsoBase = function offsetToPixelIsoBase(q, r, size, squash = 1) {
    const h = Math.sqrt(3) * size;
    const x = q * (size * 1.5);
    const yFlat = r * h + (q % 2 ? h / 2 : 0);

    return {
      x,
      y: yFlat * squash,
      yFlat,
      w: size * 2,
      h: h * squash
    };
  };

  API.projectIsoBase = function projectIsoBase(q, r, size, squash = 1, originX = 0, originY = 0) {
    const p = API.offsetToPixelIsoBase(q, r, size, squash);
    return {
      x: p.x + originX,
      y: p.y + originY,
      yFlat: p.yFlat + originY,
      w: p.w,
      h: p.h
    };
  };

  API.translatePoints = function translatePoints(pts, dx, dy) {
    return pts.map(([x, y]) => [x + dx, y + dy]);
  };

  API.ptsToString = function ptsToString(pts) {
    return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  };

  // Inverse screen -> flat board math for ISO center picking/dragging
  API.unsquashPoint = function unsquashPoint(px, py, squash = 1) {
    if (!squash || squash === 1) return { x: px, y: py };
    return { x: px, y: py / squash };
  };

  window.IsoGeom = API;
})();
