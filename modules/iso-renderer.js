// modules/iso-renderer.js
(() => {
  const svgNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}) {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
    return node;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function hexToHsl(hex) {
    hex = hex.replace('#', '');
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;

    const rp = r / 255, gp = g / 255, bp = b / 255;
    const max = Math.max(rp, gp, bp), min = Math.min(rp, gp, bp);
    let h = 0, s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rp: h = (gp - bp) / d + (gp < bp ? 6 : 0); break;
        case gp: h = (bp - rp) / d + 2; break;
        case bp: h = (rp - gp) / d + 4; break;
      }
      h /= 6;
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    function f(n) {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c);
    }
    return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function adjustLightness(hex, deltaPct) {
    const { h, s, l } = hexToHsl(hex);
    return hslToHex(h, s, clamp(l + deltaPct, 0, 100));
  }

  function relLum(hex) {
    hex = hex.replace('#', '');
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;

    const chan = v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }

  function renderRiseBands(gPolys, gTex, topPts, lift, fillColor, terrainPat = null, terrainOpacity = 0.18) {
  if (lift <= 0) return;

  // visible lower/right faces for point-down layout
  const faces = [
    [2, 3],
    [3, 4],
    [4, 5]
  ];

  // keep terrain hue, just darken it a bit
  const sideFill = adjustLightness(fillColor, -10);
  const sideStroke = adjustLightness(fillColor, -18);

  for (const [a, b] of faces) {
    const quad = [
      topPts[a],
      topPts[b],
      [topPts[b][0], topPts[b][1] + lift],
      [topPts[a][0], topPts[a][1] + lift]
    ];

    const band = el('polygon', {
      points: IsoGeom.ptsToString(quad),
      fill: sideFill,
      stroke: sideStroke,
      'stroke-width': 1.1
    });
    band.style.pointerEvents = 'none';
    gPolys.appendChild(band);

    // optional: carry terrain texture softly onto the vertical face too
    if (terrainPat) {
      const tex = el('polygon', {
        points: IsoGeom.ptsToString(quad),
        fill: `url(#${terrainPat})`,
        opacity: terrainOpacity
      });
      tex.style.pointerEvents = 'none';
      gTex.appendChild(tex);
    }
  }
}

  function renderTileLabel(gLabels, x, y, tile, terrain, size, topFill) {
    const ink = relLum(topFill) < 0.42 ? '#f8f8f8' : '#0b0f14';
    const cov = ['None', 'Light', 'Medium', 'Heavy'][tile.coverIndex] || 'None';
    const covAbbr = { None:'', Light:'| L1', Medium:'| M2', Heavy:'| H3' };

    const fontMain  = Math.max(8, size * 0.25);
    const fontSub   = Math.max(6, size * 0.18);
    const fontCoord = Math.max(6, size * 0.16);

    const label = el('text', {
      x,
      y,
      class: 'lbl',
      'font-size': fontMain
    });
    label.style.color = ink;
    label.textContent = `${tile.height}${cov === 'None' ? '' : ' ' + covAbbr[cov]}`;
    gLabels.appendChild(label);

    const terrainText = el('text', {
      x,
      y: y + size * 0.38,
      class: 'lbl',
      'font-size': fontSub
    });
    terrainText.style.color = ink;
    terrainText.textContent = terrain.name;
    gLabels.appendChild(terrainText);

    const cc = String(tile.q + 1).padStart(2, '0');
    const rr = String(tile.r + 1).padStart(2, '0');
    const coord = el('text', {
      x: (x - size * 0.26).toFixed(2),
      y: (y - size * 0.70).toFixed(2),
      class: 'coord',
      'font-size': fontCoord,
      'text-anchor': 'start',
      'dominant-baseline': 'hanging'
    });
    coord.style.color = ink;
    coord.textContent = cc + rr;
    gLabels.appendChild(coord);
  }

  function drawIsoStructure(gStructs, s, geom, opts) {
    const { hexSize, selectedStructureId } = opts;
    const ctr = geom.get(`${s.q},${s.r}`);
    if (!ctr) return;

    const g = el('g', {
      class: `structure${s.id === selectedStructureId ? ' selected' : ''}`,
      transform: `translate(${ctr.x},${ctr.y}) rotate(${s.angle || 0}) scale(${(s.scale || 1) * hexSize})`,
      'data-id': s.id
    });
    g.setAttribute('opacity', '0.75');

    if (Array.isArray(s.shapes)) {
      s.shapes.forEach(shape => {
        const tag = (
          shape.kind === 'rect' ? 'rect' :
          shape.kind === 'polygon' ? 'polygon' :
          shape.kind === 'polyline' ? 'polyline' :
          shape.kind === 'path' ? 'path' :
          shape.kind === 'circle' ? 'circle' :
          shape.kind === 'ellipse' ? 'ellipse' :
          'path'
        );

        const node = el(tag);
        const extraCls = (shape.cls || shape.class || '').trim();

        if (shape.hit) {
          node.setAttribute('class', `hit${extraCls ? ' ' + extraCls : ''}`);
          node.setAttribute('fill', 'none');
          node.setAttribute('stroke', '#ffd54a');
        } else {
          node.setAttribute('class', `body${extraCls ? ' ' + extraCls : ''}`);
          if (tag !== 'polyline') node.setAttribute('fill', shape.fill || '#20262c');
          if (shape.stroke) node.setAttribute('stroke', shape.stroke);
          if (shape.stroke || Number.isFinite(shape.sw)) {
            const pxWidth = Math.max(0.5, (Number(shape.sw) || 0.02) * hexSize);
            node.setAttribute('vector-effect', 'non-scaling-stroke');
            node.setAttribute('stroke-width', pxWidth.toFixed(2));
          }
        }

        if (shape.d && tag === 'path') node.setAttribute('d', shape.d);
        if (shape.points && (tag === 'polygon' || tag === 'polyline')) {
          node.setAttribute('points', shape.points.map(p => p.join(',')).join(' '));
        }

        if (tag === 'rect') {
          node.setAttribute('x', Number(shape.x) || 0);
          node.setAttribute('y', Number(shape.y) || 0);
          node.setAttribute('width', shape.w || 0);
          node.setAttribute('height', shape.h || 0);
          if (shape.rx != null) {
            node.setAttribute('rx', shape.rx);
            node.setAttribute('ry', shape.ry ?? shape.rx);
          }
        }

        if (tag === 'circle') {
          node.setAttribute('cx', Number(shape.cx) || 0);
          node.setAttribute('cy', Number(shape.cy) || 0);
          node.setAttribute('r', shape.r || 0);
        }

        if (tag === 'ellipse') {
          node.setAttribute('cx', Number(shape.cx) || 0);
          node.setAttribute('cy', Number(shape.cy) || 0);
          node.setAttribute('rx', shape.rx || 0);
          node.setAttribute('ry', shape.ry || 0);
        }

        const tx = Number(shape.tx) || 0;
        const ty = Number(shape.ty) || 0;
        const rot = Number(shape.rot) || 0;
        const sc = Number(shape.s) || 1;
        const t = [];
        if (tx || ty) t.push(`translate(${tx},${ty})`);
        if (rot) t.push(`rotate(${rot})`);
        if (sc !== 1) t.push(`scale(${sc})`);
        if (t.length) node.setAttribute('transform', t.join(' '));

        g.appendChild(node);
      });
    }

    gStructs.appendChild(g);
  }

  function drawIsoToken(gTokens, tok, geom, opts) {
    const { hexSize, TEAMS, iso, selectedTokenId } = opts;
    const center = geom.get(`${tok.q},${tok.r}`);
    if (!center) return;

    const cx = center.x;
    const cy = center.y;

    const rTok = Math.max(6, hexSize * 0.80 * (tok.scale || 1));
    const team = TEAMS[(tok.colorIndex || 0) % TEAMS.length].color;
    const tokPts = IsoGeom.ptsToString(
      IsoGeom.hexPointsArrayIso(0, 0, rTok, iso.tokenSquash)
    );

    const g = el('g', {
      transform: `translate(${cx},${cy}) rotate(${tok.angle || 0})`,
      'data-id': tok.id,
      'data-rtok': rTok
    });

    g.classList.add('token');
    if (tok.id === selectedTokenId) g.classList.add('selected');

    const base = el('polygon', { points: tokPts, class: 'base' });
    g.appendChild(base);

    const ring = el('polygon', {
      points: tokPts,
      class: 'ring',
      stroke: team,
      'stroke-width': Math.max(2, rTok * 0.14).toFixed(2)
    });
    g.appendChild(ring);

    const nose = el('line', {
      x1: 0,
      y1: 0 - (rTok * 0.20),
      x2: 0,
      y2: 0 - (rTok + Math.max(4, rTok * 0.25)),
      class: 'nose',
      stroke: team,
      'stroke-width': Math.max(2, rTok * 0.12).toFixed(2)
    });
    g.appendChild(nose);

    const fontTok = Math.max(14, hexSize * 0.3);
    const label = el('text', {
      class: 'tlabel',
      'font-size': fontTok,
      'stroke-width': Math.max(0.8, fontTok * 0.09).toFixed(2)
    });
    label.textContent = tok.label || 'MECH';
    g.appendChild(label);

    try {
      const mv = (typeof window.getMovementForToken === 'function')
        ? window.getMovementForToken(tok.id)
        : null;
      if (typeof window.renderMoveBadge === 'function') {
        window.renderMoveBadge(g, mv, rTok);
      }
    } catch {}

    try {
      const roll = (typeof window.getInitRollFor === 'function')
        ? window.getInitRollFor(tok.id)
        : undefined;
      if (typeof window.renderInitBadge === 'function') {
        window.renderInitBadge(g, roll, rTok);
      }
    } catch {}

    gTokens.appendChild(g);
  }

  const API = {};

  API.render = function render(opts) {
    const {
      frameBorder,
      groups,
      tiles,
      tokens,
      structures,
      hexSize,
      iso,
      TERRAINS,
      TEAMS,
      selectedTokenId,
      selectedStructureId
    } = opts;

    const {
      gShadows,
      gPolys,
      gTex,
      gOver,
      gLabels,
      gStructs,
      gTokens,
      gMeasure,
      gLosRays,
      gLos
    } = groups;

        gPolys.replaceChildren();
    gTex.replaceChildren();
    gOver.replaceChildren();
    gLabels.replaceChildren();
    gStructs.replaceChildren();
    gTokens.replaceChildren();
    gMeasure.replaceChildren();
    gLosRays.replaceChildren();
    gLos.replaceChildren();

    // IMPORTANT:
    // geom cache stores visible top-center of each iso hex
    const geom = new Map();
    window.__isoGeomCache = geom;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const tileList = Array.from(tiles.values()).sort((a, b) => (a.r - b.r) || (a.q - b.q));

    for (const t of tileList) {
      const base = IsoGeom.projectIsoBase(t.q, t.r, hexSize, iso.squash);

      const lift = Math.max(0, Number(t.height) || 0) * iso.liftStepPx(hexSize);
      const topCx = base.x;
      const topCy = base.y - lift;

      geom.set(`${t.q},${t.r}`, {
        x: topCx,
        y: topCy,
        lift
      });

      const terrain = TERRAINS[t.terrainIndex];
      const brightnessOffset = -Math.min(50, Math.abs(t.height) * 8);
      const fillColor = adjustLightness(terrain.fill, brightnessOffset);
      const topPts = IsoGeom.hexPointsArrayIso(topCx, topCy, hexSize, iso.squash);

      renderRiseBands(
  gPolys,
  gTex,
  topPts,
  lift,
  fillColor,
  terrain.pat,
  Math.max(0.12, terrain.opacity * 0.7)
);

      const poly = el('polygon', {
        points: IsoGeom.ptsToString(topPts),
        class: 'hex',
        fill: fillColor,
        stroke: '#00000066',
        'stroke-width': Math.max(1, hexSize * 0.03),
        'data-q': t.q,
        'data-r': t.r
      });
      gPolys.appendChild(poly);

      const tex = el('polygon', {
        points: IsoGeom.ptsToString(topPts),
        fill: `url(#${terrain.pat})`,
        opacity: terrain.opacity
      });
      tex.style.pointerEvents = 'none';
      gTex.appendChild(tex);

      if (t.coverIndex > 0) {
        const ringColor = adjustLightness(fillColor, [0, -5, -10, -15][t.coverIndex] || 0);
        const ring = el('polygon', {
          points: IsoGeom.ptsToString(topPts),
          fill: 'none',
          stroke: ringColor,
          'stroke-width': Math.max(2.5, hexSize * (0.12 + 0.06 * t.coverIndex)).toFixed(2),
          'stroke-linejoin': 'round',
          opacity: '0.95'
        });
        ring.style.pointerEvents = 'none';
        gOver.appendChild(ring);
      }

      renderTileLabel(gLabels, topCx, topCy, t, terrain, hexSize, fillColor);

      minX = Math.min(minX, topCx - hexSize);
      minY = Math.min(minY, topCy - hexSize);
      maxX = Math.max(maxX, topCx + hexSize);
      maxY = Math.max(maxY, topCy + hexSize + lift);
    }

    const structList = structures.slice().sort((a, b) => (a.r - b.r) || (a.q - b.q));
    structList.forEach(s => drawIsoStructure(gStructs, s, geom, {
      hexSize,
      selectedStructureId
    }));

    const tokList = tokens.slice().sort((a, b) => (a.r - b.r) || (a.q - b.q));
    tokList.forEach(tok => drawIsoToken(gTokens, tok, geom, {
      hexSize,
      TEAMS,
      iso,
      selectedTokenId
    }));

    const pad = 12;
    frameBorder.setAttribute('x', (minX - pad).toFixed(2));
    frameBorder.setAttribute('y', (minY - pad).toFixed(2));
    frameBorder.setAttribute('width', (maxX - minX + 2 * pad).toFixed(2));
    frameBorder.setAttribute('height', (maxY - minY + 2 * pad).toFixed(2));
  };

  window.IsoView = API;
})();
