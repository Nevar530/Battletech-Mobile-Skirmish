// modules/iso-geometry.js
(() => {
  const API = {};

  // Point-down visual orientation
  API.ISO_POINT_DOWN_DEG = 90;
  API.toRad = (deg) => (deg * Math.PI) / 180;

  // Point-down hex polygon
  API.hexPointsArrayIso = function hexPointsArrayIso(cx, cy, size, squash = 1) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = API.toRad(API.ISO_POINT_DOWN_DEG + (60 * i));
      const dx = size * Math.cos(ang);
      const dy = size * Math.sin(ang) * squash;
      pts.push([cx + dx, cy + dy]);
    }
    return pts;
  };

  // ISO MODE CENTER LAYOUT:
  // This is NOT the app's flat-top spacing.
  // This is a point-down / pointy layout spacing for visual mode only.
  //
  // Using odd-r style row offset:
  // width  = sqrt(3) * size
  // height = 2 * size
  // x = q * width + (r odd ? width/2 : 0)
  // y = r * (1.5 * size)
  //
  // Then squash Y for iso look.
  API.offsetToPixelIsoBase = function offsetToPixelIsoBase(q, r, size, squash = 1) {
    const width = Math.sqrt(3) * size;
    const height = 2 * size;

    const x = q * width + ((r & 1) ? width / 2 : 0);
    const yRaw = r * (1.5 * size);

    return {
      x,
      y: yRaw * squash,
      yRaw,
      w: width,
      h: height * squash
    };
  };

  API.projectIsoBase = function projectIsoBase(q, r, size, squash = 1, originX = 0, originY = 0) {
    const p = API.offsetToPixelIsoBase(q, r, size, squash);
    return {
      x: p.x + originX,
      y: p.y + originY,
      yRaw: p.yRaw + originY,
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

  // For click/drag in iso mode:
  // robust nearest-center lookup instead of pretending flat-top inverse still works
  API.pixelToCellIsoNearest = function pixelToCellIsoNearest(px, py, cols, rows, size, squash = 1) {
    let bestQ = 0;
    let bestR = 0;
    let bestD2 = Infinity;

    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const p = API.projectIsoBase(q, r, size, squash);
        const dx = px - p.x;
        const dy = py - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestQ = q;
          bestR = r;
        }
      }
    }

    return { q: bestQ, r: bestR };
  };

  window.IsoGeom = API;
})();
