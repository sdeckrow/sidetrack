/* Terrain-feature extraction from the DEM.
 *
 * Point features: hilltops (local maxima with all-directions relief),
 * saddles (ring test), stream bends/junctions from OSM hydrography.
 *
 * Linear features — the navigator's bread and butter:
 *   reentrant axes: traced down the drainage flow field (water finds the
 *     middle of a reentrant by definition), then VALIDATED by elevation
 *     cross-sections — the ground must rise on both sides along the line.
 *   spur axes: the same trace on the inverted DEM follows crests; the
 *     cross-section check requires ground falling away on both sides.
 *
 * Only axes that survive the cross-section gate are kept, with honest
 * credentials: median depth (ft) and length (m).
 */

export function extractFeatures(gridInfo, opts) {
  const { grid, W, H } = gridInfo;
  const { cellM, toMap, boundaryFlat, streams, trailPts, caps = {} } = opts;
  const cellFt = cellM * 3.28084;

  /* ---- smooth (3 passes — the DEM has interpolation noise) ---- */
  const S = smooth3(smooth3(smooth3(grid, W, H), W, H), W, H);

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

  /* ---- D8 flow fields + accumulation (downhill and inverted) ---- */
  const orderDesc = new Uint32Array(W * H);
  for (let i = 0; i < W * H; i++) orderDesc[i] = i;
  orderDesc.sort((a, b) => S[b] - S[a]);
  const dirDown = flowField(S, W, H, false);
  const dirUp = flowField(S, W, H, true);
  const accum = accumulate(orderDesc, dirDown, false);
  const ridge = accumulate(orderDesc, dirUp, true);

  /* ---- hilltops: must stand well proud of a ~100 m ring ---- */
  const hills = [];
  const RING = ringOffsets(25); // ~100 m
  for (let y = 26; y < H - 26; y++) {
    cell: for (let x = 26; x < W - 26; x++) {
      const i = y * W + x, v = S[i];
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (!dx && !dy) continue;
          if (S[i + dy * W + dx] >= v) continue cell;
        }
      let maxRing = -Infinity;
      for (const [ox, oy] of RING) maxRing = Math.max(maxRing, S[i + oy * W + ox]);
      const relief = v - maxRing; // EVERY direction must drop, not just one
      if (relief >= 18) hills.push({ x, y, q: relief });
    }
  }

  /* ---- saddles ---- */
  const saddles = [];
  const SR = ringOffsets(8, 24); // ~32 m ring: real saddles, not dips
  for (let y = 9; y < H - 9; y++) {
    for (let x = 9; x < W - 9; x++) {
      const i = y * W + x, v = S[i];
      let trans = 0, prev = 0, ampUp = 0, ampDn = 0;
      for (let k = 0; k <= SR.length; k++) {
        const [ox, oy] = SR[k % SR.length];
        const d = S[i + oy * W + ox] - v;
        if (d > 0) ampUp = Math.max(ampUp, d);
        else ampDn = Math.max(ampDn, -d);
        const sgn = Math.abs(d) < 0.5 ? prev : Math.sign(d);
        if (k > 0 && sgn !== prev && sgn !== 0 && prev !== 0) trans++;
        prev = sgn || prev;
      }
      if (trans === 4 && Math.min(ampUp, ampDn) >= 13) {
        saddles.push({ x, y, q: Math.min(ampUp, ampDn) });
      }
    }
  }

  const pickPts = (cands, cap, spacing = 30) => {
    cands.sort((a, b) => b.q - a.q);
    const out = [];
    for (const c of cands) {
      if (out.length >= cap) break;
      if (out.every((o) => Math.abs(o.x - c.x) >= spacing || Math.abs(o.y - c.y) >= spacing)) out.push(c);
    }
    return out;
  };
  const hillsP = pickPts(hills, caps.hill ?? 40);
  const saddlesP = pickPts(saddles, caps.saddle ?? 25);

  /* ---- reentrant & spur AXES ---- */
  const axisOpts = { W, H, S, slope, cellM, cellFt };
  const reentAxes = traceAndValidate({
    ...axisOpts, dir: dirDown, flow: accum, inverted: false,
    A1: 100, A2: 8000, slopeMin: 4, depthMin: 10,
  });
  const spurAxes = traceAndValidate({
    ...axisOpts, dir: dirUp, flow: ridge, inverted: true,
    A1: 100, A2: 8000, slopeMin: 4, depthMin: 10,
  });

  /* ---- to map coords, filter to park, attach metadata ---- */
  const trailIdx = new BucketIndex(trailPts, 64);
  const finishPt = (list, t) =>
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

  const finishAxis = (list, t, cap) =>
    list
      .sort((a, b) => b.depth * b.lenCells - a.depth * a.lenCells)
      .map((a) => {
        const mapPts = a.cells.map(([cx, cy]) => { const m = toMap(cx, cy); return [m.x, m.y]; });
        const simp = rdp(mapPts, 1.0);
        const mid = a.cells[Math.floor(a.cells.length / 2)];
        const mm = toMap(mid[0], mid[1]);
        return {
          t, pts: flat(simp),
          x: Math.round(mm.x * 10) / 10, y: Math.round(mm.y * 10) / 10, // midpoint = control anchor
          e: Math.round(S[mid[1] * W + mid[0]]),
          depth: Math.round(a.depth),
          len: Math.round(a.lenCells * cellM),
          dT: Math.round(trailIdx.nearest(mm.x, mm.y)),
        };
      })
      .filter((f) => pointInPolyFlat(f.x, f.y, boundaryFlat))
      .slice(0, cap);

  return [
    ...finishPt(hillsP, "hill"),
    ...finishPt(saddlesP, "saddle"),
    ...finishAxis(reentAxes, "reentrant", caps.reentrant ?? 130),
    ...finishAxis(spurAxes, "spur", caps.spur ?? 130),
    ...streamFeatures(streams, boundaryFlat, trailIdx, caps),
  ];
}

/* ---------------- axis tracing + cross-section validation ---------------- */

function traceAndValidate({ W, H, S, slope, cellM, dir, flow, inverted, A1, A2, slopeMin, depthMin }) {
  // mask: cells that look like axis material
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (flow[i] >= A1 && flow[i] <= A2 && slope[i] >= slopeMin) mask[i] = 1;
  }
  // heads: masked cells nothing masked flows into
  const hasParent = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (mask[i] && dir[i] >= 0 && mask[dir[i]]) hasParent[dir[i]] = 1;
  }
  const claimed = new Int32Array(W * H);
  const paths = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || hasParent[i] || claimed[i]) continue;
    const path = [];
    let cur = i, id = paths.length + 1;
    while (cur >= 0 && mask[cur] && !claimed[cur] && path.length < 4000) {
      claimed[cur] = id;
      path.push(cur);
      cur = dir[cur];
    }
    if (cur >= 0 && claimed[cur] && claimed[cur] !== id) path.push(cur); // join the junction
    if (path.length >= 12) paths.push(path);
  }

  /* cross-section gate: ground must rise (reentrant) / fall (spur)
   * on BOTH sides, at stations along the line */
  const out = [];
  for (const path of paths) {
    const pts = path.map((i) => [i % W, (i / W) | 0]);
    const stations = [];
    for (let s = 3; s < pts.length - 3; s += 3) {
      const [tx, ty] = [pts[s + 3][0] - pts[s - 3][0], pts[s + 3][1] - pts[s - 3][1]];
      const tl = Math.hypot(tx, ty) || 1;
      const [nx, ny] = [-ty / tl, tx / tl];
      const c = S[pts[s][1] * W + pts[s][0]];
      const side = (sign) => {
        let extreme = inverted ? Infinity : -Infinity;
        for (const off of [6, 12]) { // ~25 m and ~50 m out
          const sx = Math.round(pts[s][0] + nx * off * sign);
          const sy = Math.round(pts[s][1] + ny * off * sign);
          if (sx < 0 || sx >= W || sy < 0 || sy >= H) return null;
          const v = S[sy * W + sx];
          extreme = inverted ? Math.min(extreme, v) : Math.max(extreme, v);
        }
        return extreme;
      };
      const L = side(1), R = side(-1);
      if (L === null || R === null) { stations.push({ s, depth: -1 }); continue; }
      // reentrant: both sides higher; spur: both sides lower
      const depth = inverted ? Math.min(c - L, c - R) : Math.min(L - c, R - c);
      stations.push({ s, depth });
    }
    // trim shallow ends, then judge what's left
    let a = 0, b = stations.length - 1;
    while (a <= b && stations[a].depth < depthMin) a++;
    while (b >= a && stations[b].depth < depthMin) b--;
    if (b - a < 3) continue; // too short after trim
    const kept = stations.slice(a, b + 1);
    const passing = kept.filter((st) => st.depth >= depthMin);
    if (passing.length / kept.length < 0.6) continue;
    const depths = passing.map((st) => st.depth).sort((x, y) => x - y);
    const median = depths[(depths.length / 2) | 0];
    const cells = pts.slice(stations[a].s, stations[b].s + 1);
    if (cells.length * cellM < 70) continue; // under ~70 m isn't a feature, it's a dent
    out.push({ cells, depth: median, lenCells: cells.length });
  }
  return out;
}

/* ---------------- flow helpers ---------------- */

const NB = (W) => [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
const NBD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

function flowField(S, W, H, inverted) {
  const dir = new Int32Array(W * H).fill(-1);
  const nb = NB(W);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let best = -1, bestDrop = 0;
      for (let k = 0; k < 8; k++) {
        const drop = (inverted ? S[i + nb[k]] - S[i] : S[i] - S[i + nb[k]]) / NBD[k];
        if (drop > bestDrop) { bestDrop = drop; best = i + nb[k]; }
      }
      dir[i] = best;
    }
  }
  return dir;
}

function accumulate(orderDesc, dir, reverse) {
  const accum = new Float32Array(dir.length).fill(1);
  if (reverse) {
    for (let k = orderDesc.length - 1; k >= 0; k--) {
      const i = orderDesc[k];
      if (dir[i] >= 0) accum[dir[i]] += accum[i];
    }
  } else {
    for (let k = 0; k < orderDesc.length; k++) {
      const i = orderDesc[k];
      if (dir[i] >= 0) accum[dir[i]] += accum[i];
    }
  }
  return accum;
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
      if (turn >= 70) bends.push({ t: "streambend", x: s[i], y: s[i + 1], q: turn });
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

/* ---------------- generic helpers ---------------- */

function smooth3(src, W, H) {
  const out = new Float32Array(W * H);
  out.set(src);
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      tmp[i] = (src[i - 1] + src[i] * 2 + src[i + 1]) / 4;
    }
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = (tmp[i - W] + tmp[i] * 2 + tmp[i + W]) / 4;
    }
  return out;
}

function ringOffsets(r, count = Math.max(16, Math.round(r * 4))) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    out.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
  }
  return out;
}

function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let iMax = 0, dMax = 0;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > dMax) { dMax = d; iMax = i; }
  }
  if (dMax <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, iMax + 1), eps).slice(0, -1).concat(rdp(pts.slice(iMax), eps));
}

const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);

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
