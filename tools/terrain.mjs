/* Terrain-feature extraction from the DEM.
 *
 * Finds the features an orienteer navigates by — hilltops, saddles,
 * reentrants, spurs — plus stream bends/junctions from OSM hydrography.
 * These become candidate control points for course generation.
 *
 * Methods (all standard terrain analysis):
 *  - smooth DEM (binomial 3x3, two passes) to kill sensor noise
 *  - hilltops: strict local maxima with enough relief over a ~60 m ring
 *  - saddles: 16-point ring test (elevation profile crosses the center
 *    level exactly 4 times → two ridges + two valleys meet)
 *  - reentrants/gullies: D8 flow accumulation — concave slices of slope
 *    collect water; modest accumulation + real slope = a reentrant
 *  - spurs/ridges: the same on the inverted DEM
 */

export function extractFeatures(gridInfo, opts) {
  const { grid, W, H } = gridInfo;
  const { cellM, toMap, boundaryFlat, streams, trailPts, caps = {} } = opts;
  const cellFt = cellM * 3.28084;

  /* ---- smooth ---- */
  const S = smooth3(smooth3(grid, W, H), W, H);

  /* ---- slope (degrees) ---- */
  const slope = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (S[i + 1] - S[i - 1]) / (2 * cellFt);
      const gy = (S[i + W] - S[i - W]) / (2 * cellFt);
      slope[i] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }

  /* ---- D8 flow accumulation (and inverted, for ridges) ---- */
  const accum = flowAccum(S, W, H, false);
  const ridge = flowAccum(S, W, H, true);

  /* ---- hilltops ---- */
  const hills = [];
  const RING = ringOffsets(15); // ~60 m
  for (let y = 16; y < H - 16; y++) {
    cell: for (let x = 16; x < W - 16; x++) {
      const i = y * W + x, v = S[i];
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (!dx && !dy) continue;
          if (S[i + dy * W + dx] >= v) continue cell;
        }
      let minRing = Infinity;
      for (const [ox, oy] of RING) minRing = Math.min(minRing, S[i + oy * W + ox]);
      const relief = v - minRing;
      if (relief >= 8) hills.push({ x, y, q: relief });
    }
  }

  /* ---- saddles ---- */
  const saddles = [];
  const SR = ringOffsets(3, 16);
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const i = y * W + x, v = S[i];
      let trans = 0, prev = 0, ampUp = 0, ampDn = 0;
      let first = 0;
      for (let k = 0; k <= SR.length; k++) {
        const [ox, oy] = SR[k % SR.length];
        const d = S[i + oy * W + ox] - v;
        if (d > 0) ampUp = Math.max(ampUp, d);
        else ampDn = Math.max(ampDn, -d);
        const sgn = Math.abs(d) < 0.5 ? prev : Math.sign(d);
        if (k === 0) first = sgn;
        else if (sgn !== prev && sgn !== 0 && prev !== 0) trans++;
        prev = sgn || prev;
      }
      void first;
      if (trans === 4 && Math.min(ampUp, ampDn) >= 5) {
        saddles.push({ x, y, q: Math.min(ampUp, ampDn) });
      }
    }
  }

  /* ---- reentrants (gully cells) & spurs (ridge cells) ---- */
  const reentrants = [], spurs = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (slope[i] < 4) continue;
      if (accum[i] >= 25 && accum[i] <= 5000) {
        reentrants.push({ x, y, q: slope[i] * Math.log2(accum[i]) });
      }
      if (ridge[i] >= 25 && ridge[i] <= 5000) {
        spurs.push({ x, y, q: slope[i] * Math.log2(ridge[i]) });
      }
    }
  }

  /* ---- greedy spacing selection, strongest first ---- */
  const SPACING = 15; // cells ≈ 60 m
  const pick = (cands, cap, spacing = SPACING) => {
    cands.sort((a, b) => b.q - a.q);
    const out = [];
    for (const c of cands) {
      if (out.length >= cap) break;
      let ok = true;
      for (const o of out) {
        if (Math.abs(o.x - c.x) < spacing && Math.abs(o.y - c.y) < spacing) { ok = false; break; }
      }
      if (ok) out.push(c);
    }
    return out;
  };

  const hillsP = pick(hills, caps.hill ?? 150);
  const saddlesP = pick(saddles, caps.saddle ?? 100);
  // spurs shouldn't duplicate hilltops/saddles — those already own the spot
  const taken = hillsP.concat(saddlesP);
  const farFromTaken = (c) => taken.every((t) => Math.abs(t.x - c.x) >= 12 || Math.abs(t.y - c.y) >= 12);
  const reentP = pick(reentrants.filter(farFromTaken), caps.reentrant ?? 400);
  const spursP = pick(spurs.filter(farFromTaken), caps.spur ?? 400);

  /* ---- to map coords, filter to park, attach elevation + trail distance ---- */
  const trailIdx = new BucketIndex(trailPts, 64);
  const finish = (list, t) =>
    list
      .map((c) => {
        const m = toMap(c.x, c.y);
        return {
          t, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10,
          e: Math.round(S[c.y * W + c.x]),
          q: Math.round(c.q * 10) / 10,
          dT: Math.round(trailIdx.nearest(m.x, m.y)),
        };
      })
      .filter((f) => pointInPolyFlat(f.x, f.y, boundaryFlat));

  const features = [
    ...finish(hillsP, "hill"),
    ...finish(saddlesP, "saddle"),
    ...finish(reentP, "reentrant"),
    ...finish(spursP, "spur"),
    ...streamFeatures(streams, boundaryFlat, trailIdx, caps),
  ];
  return features;
}

/* ---------------- stream bends & junctions (map coords) ---------------- */

function streamFeatures(streams, boundaryFlat, trailIdx, caps) {
  const key = (x, y) => `${Math.round(x / 3)},${Math.round(y / 3)}`;
  const endCount = new Map();
  for (const s of streams) {
    for (const [x, y] of [[s[0], s[1]], [s[s.length - 2], s[s.length - 1]]]) {
      const k = key(x, y);
      endCount.set(k, { x, y, n: (endCount.get(k)?.n || 0) + 1 });
    }
  }
  const jcts = [...endCount.values()].filter((e) => e.n >= 2)
    .map((e) => ({ t: "streamjct", x: e.x, y: e.y, q: e.n }));

  const bends = [];
  for (const s of streams) {
    for (let i = 4; i + 5 < s.length; i += 2) {
      const a1 = Math.atan2(s[i + 1] - s[i - 3], s[i] - s[i - 4]);
      const a2 = Math.atan2(s[i + 5] - s[i + 1], s[i + 4] - s[i]);
      let turn = Math.abs(a2 - a1) * (180 / Math.PI);
      if (turn > 180) turn = 360 - turn;
      if (turn >= 55) bends.push({ t: "streambend", x: s[i], y: s[i + 1], q: turn });
    }
  }
  bends.sort((a, b) => b.q - a.q);
  const picked = [];
  for (const b of bends) {
    if (picked.length >= (caps.streambend ?? 150)) break;
    if (picked.every((p) => Math.hypot(p.x - b.x, p.y - b.y) >= 40)) picked.push(b);
  }

  return jcts.concat(picked)
    .filter((f) => pointInPolyFlat(f.x, f.y, boundaryFlat))
    .map((f) => ({
      ...f,
      x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10,
      q: Math.round(f.q * 10) / 10, dT: Math.round(trailIdx.nearest(f.x, f.y)),
    }));
}

/* ---------------- helpers ---------------- */

function smooth3(src, W, H) {
  const out = new Float32Array(W * H);
  out.set(src);
  const K = [1, 2, 1];
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      tmp[i] = (src[i - 1] * K[0] + src[i] * K[1] + src[i + 1] * K[2]) / 4;
    }
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = (tmp[i - W] * K[0] + tmp[i] * K[1] + tmp[i + W] * K[2]) / 4;
    }
  return out;
}

function flowAccum(S, W, H, inverted) {
  const n = W * H;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => (inverted ? S[a] - S[b] : S[b] - S[a]));
  const accum = new Float32Array(n).fill(1);
  const NB = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
  for (const i of sorted) {
    const x = i % W, y = (i / W) | 0;
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
    let best = -1, bestDrop = 0;
    for (let k = 0; k < 8; k++) {
      const drop = (inverted ? S[i + NB[k]] - S[i] : S[i] - S[i + NB[k]]) / DIST[k];
      if (drop > bestDrop) { bestDrop = drop; best = i + NB[k]; }
    }
    if (best >= 0) accum[best] += accum[i];
  }
  return accum;
}

function ringOffsets(r, count = Math.max(16, Math.round(r * 4))) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    out.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
  }
  return out;
}

function pointInPolyFlat(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* spatial bucket index over flat [x,y,…] points for nearest-distance lookups */
class BucketIndex {
  constructor(flatPts, cell) {
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i + 1 < flatPts.length; i += 2) {
      const k = `${(flatPts[i] / cell) | 0},${(flatPts[i + 1] / cell) | 0}`;
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(flatPts[i], flatPts[i + 1]);
    }
  }
  nearest(x, y, maxRings = 12) {
    const cx = (x / this.cell) | 0, cy = (y / this.cell) | 0;
    let best = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const b = this.map.get(`${cx + dx},${cy + dy}`);
          if (!b) continue;
          for (let i = 0; i + 1 < b.length; i += 2) {
            best = Math.min(best, Math.hypot(b[i] - x, b[i + 1] - y));
          }
        }
      }
      if (best < (r - 1) * this.cell) break; // can't be beaten by farther rings
    }
    return best === Infinity ? 9999 : best;
  }
}
