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
 * All thresholds are metric (meters/feet), scaled to the grid's cell
 * size, so the same code works on 4 m terrarium or 1–2 m lidar input.
 * Only axes that survive the cross-section gate are kept, with honest
 * credentials: median depth (ft) and length (m).
 */

export function extractFeatures(gridInfo, opts) {
  const { grid, W, H } = gridInfo;
  const { cellM, toMap, boundaryFlat, streams, trailPts, caps = {}, tuning = {} } = opts;
  const TU = {
    hillReliefFt: 18,   // a hilltop must drop this much in EVERY direction (~100 m ring)
    saddleAmpFt: 13,    // both sides must rise this much (~32 m ring)
    axisDepthFt: 10,    // reentrant/spur cross-section depth, both sides
    axisMinLenM: 70,    // shorter than this isn't a feature, it's a dent
    axisCatchM2: 1600,  // min catchment area feeding a reentrant head
    ...tuning,
  };

  /* ---- axis-analysis grid: ~2.5 m cells, whatever the input res ----
   * Resolution-independent behavior: flow tracing on sub-2 m lidar braids
   * into fragments, so we analyze at ~2.5 m and keep lidar's accuracy. */
  const kA = Math.max(1, Math.round(2.5 / cellM));
  const WA = Math.floor(W / kA), HA = Math.floor(H / kA);
  const cellMA = cellM * kA, cellFtA = cellMA * 3.28084;
  let SA = new Float32Array(WA * HA);
  for (let y = 0; y < HA; y++)
    for (let x = 0; x < WA; x++) SA[y * WA + x] = grid[y * kA * W + x * kA];
  SA = smooth3(smooth3(smooth3(SA, WA, HA), WA, HA), WA, HA);

  /* ---- slope (degrees) on the axis grid ---- */
  const slope = new Float32Array(WA * HA);
  for (let y = 1; y < HA - 1; y++) {
    for (let x = 1; x < WA - 1; x++) {
      const i = y * WA + x;
      const gx = (SA[i + 1] - SA[i - 1]) / (2 * cellFtA);
      const gy = (SA[i + WA] - SA[i - WA]) / (2 * cellFtA);
      slope[i] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }

  /* ---- D8 flow fields + accumulation (downhill and inverted) ---- */
  const orderDesc = sortIdxByElevDesc(SA);
  const dirDown = flowField(SA, WA, HA, false);
  const dirUp = flowField(SA, WA, HA, true);
  const accum = accumulate(orderDesc, dirDown, false);
  const ridge = accumulate(orderDesc, dirUp, true);

  /* ---- hilltops & saddles on a ~4 m decimated grid (scale-stable) ---- */
  const k = Math.max(1, Math.round(4 / cellM));
  const Wd = Math.floor(W / k), Hd = Math.floor(H / k);
  const Sd = new Float32Array(Wd * Hd);
  for (let y = 0; y < Hd; y++)
    for (let x = 0; x < Wd; x++) Sd[y * Wd + x] = grid[y * k * W + x * k];
  const sm = smooth3(Sd, Wd, Hd);
  Sd.set(sm);

  const hills = [];
  const RING = ringOffsets(25); // ~100 m on the decimated grid
  for (let y = 26; y < Hd - 26; y++) {
    cell: for (let x = 26; x < Wd - 26; x++) {
      const i = y * Wd + x, v = Sd[i];
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (!dx && !dy) continue;
          if (Sd[i + dy * Wd + dx] >= v) continue cell;
        }
      let maxRing = -Infinity;
      for (const [ox, oy] of RING) maxRing = Math.max(maxRing, Sd[i + oy * Wd + ox]);
      const relief = v - maxRing; // EVERY direction must drop, not just one
      if (relief >= TU.hillReliefFt) hills.push({ x: x * k, y: y * k, q: relief, e: v });
    }
  }

  const saddles = [];
  const SR = ringOffsets(8, 24); // ~32 m ring: real saddles, not dips
  for (let y = 9; (caps.saddle ?? 25) > 0 && y < Hd - 9; y++) {
    for (let x = 9; x < Wd - 9; x++) {
      const i = y * Wd + x, v = Sd[i];
      let trans = 0, prev = 0, ampUp = 0, ampDn = 0;
      for (let j = 0; j <= SR.length; j++) {
        const [ox, oy] = SR[j % SR.length];
        const d = Sd[i + oy * Wd + ox] - v;
        if (d > 0) ampUp = Math.max(ampUp, d);
        else ampDn = Math.max(ampDn, -d);
        const sgn = Math.abs(d) < 0.5 ? prev : Math.sign(d);
        if (j > 0 && sgn !== prev && sgn !== 0 && prev !== 0) trans++;
        prev = sgn || prev;
      }
      if (trans === 4 && Math.min(ampUp, ampDn) >= TU.saddleAmpFt) {
        saddles.push({ x: x * k, y: y * k, q: Math.min(ampUp, ampDn), e: v });
      }
    }
  }

  const spacingCells = Math.round(120 / cellM);
  const pickPts = (cands, cap) => {
    cands.sort((a, b) => b.q - a.q);
    const out = [];
    for (const c of cands) {
      if (out.length >= cap) break;
      if (out.every((o) => Math.abs(o.x - c.x) >= spacingCells || Math.abs(o.y - c.y) >= spacingCells)) out.push(c);
    }
    return out;
  };
  const hillsP = pickPts(hills, caps.hill ?? 40);
  const saddlesP = pickPts(saddles, caps.saddle ?? 25);

  /* ---- reentrant & spur AXES (metric thresholds, axis grid) ---- */
  const axisShared = {
    W: WA, H: HA, S: SA, slope, cellM: cellMA,
    A1: Math.round(TU.axisCatchM2 / (cellMA * cellMA)),
    A2: Math.round(130000 / (cellMA * cellMA)), // ≤ ~13 ha — beyond that it's a valley
    slopeMin: 4, depthMin: TU.axisDepthFt, minLenM: TU.axisMinLenM,
  };
  const reentAxes = dedupAxes(traceAndValidate({ ...axisShared, dir: dirDown, flow: accum, inverted: false }), cellMA);
  const spurAxes = dedupAxes(traceAndValidate({ ...axisShared, dir: dirUp, flow: ridge, inverted: true }), cellMA);

  /* ---- to map coords, filter to park, attach metadata ---- */
  const trailIdx = new BucketIndex(trailPts, 64);
  const finishPt = (list, t) =>
    list
      .map((c) => {
        const m = toMap(c.x, c.y);
        return {
          t, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10,
          e: Math.round(c.e),
          q: Math.round(c.q * 10) / 10,
          dT: Math.round(trailIdx.nearest(m.x, m.y)),
        };
      })
      .filter((f) => pointInPolyFlat(f.x, f.y, boundaryFlat));

  const finishAxis = (list, t, cap) =>
    list
      .sort((a, b) => b.depth * b.lenCells - a.depth * a.lenCells)
      .map((a) => {
        // axis-grid coords → full-grid coords → map
        const mapPts = a.cells.map(([cx, cy]) => { const m = toMap(cx * kA, cy * kA); return [m.x, m.y]; });
        const simp = rdp(mapPts, 0.35); // keep the shape — drawn as curves

        const mid = a.cells[Math.floor(a.cells.length / 2)];
        const mm = toMap(mid[0] * kA, mid[1] * kA);
        return {
          t, pts: flat(simp),
          x: Math.round(mm.x * 10) / 10, y: Math.round(mm.y * 10) / 10, // midpoint = control anchor
          e: Math.round(SA[mid[1] * WA + mid[0]]),
          depth: Math.round(a.depth),
          len: Math.round(a.lenCells * cellMA),
          dT: Math.round(trailIdx.nearest(mm.x, mm.y)),
        };
      })
      .filter((f) => pointInPolyFlat(f.x, f.y, boundaryFlat))
      .slice(0, cap);

  return [
    ...finishPt(hillsP, "hill"),
    ...finishPt(saddlesP, "saddle"),
    ...finishAxis(reentAxes, "reentrant", caps.reentrant ?? 250),
    ...finishAxis(spurAxes, "spur", caps.spur ?? 250),
    ...streamFeatures(streams, boundaryFlat, trailIdx, caps),
  ];
}

/* ---------------- axis tracing + cross-section validation ---------------- */

function traceAndValidate({ W, H, S, slope, cellM, dir, flow, inverted, A1, A2, slopeMin, depthMin, minLenM = 70 }) {
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (flow[i] >= A1 && flow[i] <= A2 && slope[i] >= slopeMin) mask[i] = 1;
  }
  const hasParent = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (mask[i] && dir[i] >= 0 && mask[dir[i]]) hasParent[dir[i]] = 1;
  }
  const claimed = new Int32Array(W * H);
  const paths = [];
  const minPath = Math.round(50 / cellM), maxPath = Math.round(1500 / cellM);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || hasParent[i] || claimed[i]) continue;
    const path = [];
    let cur = i;
    const id = paths.length + 1;
    while (cur >= 0 && mask[cur] && !claimed[cur] && path.length < maxPath) {
      claimed[cur] = id;
      path.push(cur);
      cur = dir[cur];
    }
    if (cur >= 0 && claimed[cur] && claimed[cur] !== id) path.push(cur); // join the junction
    if (path.length >= minPath) paths.push(path);
  }

  /* cross-section gate: ground must rise (reentrant) / fall (spur)
   * on BOTH sides, at stations along the line */
  const st = Math.max(2, Math.round(12 / cellM));
  const off1 = Math.round(25 / cellM), off2 = Math.round(50 / cellM);
  const out = [];
  for (const path of paths) {
    const pts = path.map((i) => [i % W, (i / W) | 0]);
    const stations = [];
    for (let s = st; s < pts.length - st; s += st) {
      const [tx, ty] = [pts[s + st][0] - pts[s - st][0], pts[s + st][1] - pts[s - st][1]];
      const tl = Math.hypot(tx, ty) || 1;
      const [nx, ny] = [-ty / tl, tx / tl];
      const c = S[pts[s][1] * W + pts[s][0]];
      const side = (sign) => {
        let extreme = inverted ? Infinity : -Infinity;
        for (const off of [off1, off2]) { // ~25 m and ~50 m out
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
      const depth = inverted ? Math.min(c - L, c - R) : Math.min(L - c, R - c);
      stations.push({ s, depth });
    }
    let a = 0, b = stations.length - 1;
    while (a <= b && stations[a].depth < depthMin) a++;
    while (b >= a && stations[b].depth < depthMin) b--;
    if (b - a < 3) continue;
    const kept = stations.slice(a, b + 1);
    const passing = kept.filter((x) => x.depth >= depthMin);
    if (passing.length / kept.length < 0.6) continue;
    const depths = passing.map((x) => x.depth).sort((x, y) => x - y);
    const median = depths[(depths.length / 2) | 0];
    const cells = pts.slice(stations[a].s, stations[b].s + 1);
    if (cells.length * cellM < minLenM) continue; // too short to navigate by
    out.push({ cells, depth: median, lenCells: cells.length });
  }
  return out;
}

/* Two traces braided down the same wide reentrant: keep the better one.
 * Lines overlap if most sampled points sit within ~20 m of the other. */
function dedupAxes(axes, cellM) {
  const thresh = 20 / cellM;
  axes.sort((a, b) => b.depth * b.lenCells - a.depth * a.lenCells);
  const kept = [];
  for (const a of axes) {
    let overlapped = false;
    for (const b of kept) {
      let near = 0;
      const N = 12;
      for (let i = 0; i < N; i++) {
        const p = a.cells[Math.floor((i / (N - 1)) * (a.cells.length - 1))];
        let dMin = Infinity;
        for (let j = 0; j < b.cells.length; j += 2) {
          const q = b.cells[j];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < dMin) dMin = d;
        }
        if (dMin <= thresh) near++;
      }
      if (near / N >= 0.55) { overlapped = true; break; }
    }
    if (!overlapped) kept.push(a);
  }
  return kept;
}

/* ---------------- flow helpers ---------------- */

const NBD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

function flowField(S, W, H, inverted) {
  const dir = new Int32Array(W * H).fill(-1);
  const nb = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let best = -1, bestDrop = 0;
      for (let j = 0; j < 8; j++) {
        const drop = (inverted ? S[i + nb[j]] - S[i] : S[i] - S[i + nb[j]]) / NBD[j];
        if (drop > bestDrop) { bestDrop = drop; best = i + nb[j]; }
      }
      dir[i] = best;
    }
  }
  return dir;
}

/* counting sort by elevation, descending — O(n), fine at 25M+ cells */
function sortIdxByElevDesc(S) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S.length; i++) {
    if (S[i] < lo) lo = S[i];
    if (S[i] > hi) hi = S[i];
  }
  const Q = 65536, scale = (Q - 1) / Math.max(1e-9, hi - lo);
  const counts = new Uint32Array(Q + 1);
  for (let i = 0; i < S.length; i++) counts[Q - 1 - (((S[i] - lo) * scale) | 0)]++;
  let sum = 0;
  for (let b = 0; b < Q; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
  const order = new Uint32Array(S.length);
  for (let i = 0; i < S.length; i++) {
    const b = Q - 1 - (((S[i] - lo) * scale) | 0);
    order[counts[b]++] = i;
  }
  return order;
}

function accumulate(orderDesc, dir, reverse) {
  const accum = new Float32Array(dir.length).fill(1);
  if (reverse) {
    for (let j = orderDesc.length - 1; j >= 0; j--) {
      const i = orderDesc[j];
      if (dir[i] >= 0) accum[dir[i]] += accum[i];
    }
  } else {
    for (let j = 0; j < orderDesc.length; j++) {
      const i = orderDesc[j];
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
      const kk = key(x, y);
      endCount.set(kk, { x, y, n: (endCount.get(kk)?.n || 0) + 1 });
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

export function smooth3(src, W, H) {
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
