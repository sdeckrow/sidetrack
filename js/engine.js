/* Sidetrack — routing, prediction & suggestion engine. Pure functions, no DOM. */

/* ---------------- graph ---------------- */

function buildAdj(park) {
  const adj = {};
  for (const id of Object.keys(park.nodes)) adj[id] = [];
  park.edges.forEach((e, i) => {
    adj[e.a].push({ to: e.b, edge: e, idx: i });
    adj[e.b].push({ to: e.a, edge: e, idx: i });
  });
  return adj;
}

function dijkstra(park, adj, src) {
  const dist = {}, prev = {};
  for (const id of Object.keys(park.nodes)) dist[id] = Infinity;
  dist[src] = 0;
  const open = new Set(Object.keys(park.nodes));
  while (open.size) {
    let u = null, best = Infinity;
    for (const id of open) if (dist[id] < best) { best = dist[id]; u = id; }
    if (u === null) break;
    open.delete(u);
    for (const { to, edge } of adj[u]) {
      const d = dist[u] + edge.miles;
      if (d < dist[to]) { dist[to] = d; prev[to] = u; }
    }
  }
  return { dist, prev };
}

function pathFrom(prev, src, dst) {
  if (src === dst) return [src];
  if (prev[dst] === undefined) return null;
  const path = [dst];
  let cur = dst;
  while (cur !== src) { cur = prev[cur]; path.push(cur); }
  return path.reverse();
}

function edgeBetween(adj, a, b) {
  return adj[a].find(n => n.to === b)?.edge ?? null;
}

function pathStats(park, adj, ids) {
  let miles = 0, climb = 0, maxNav = 1;
  for (let i = 0; i + 1 < ids.length; i++) {
    const e = edgeBetween(adj, ids[i], ids[i + 1]);
    miles += e.miles;
    climb += e.climb;
    maxNav = Math.max(maxNav, e.nav);
  }
  const junctions = Math.max(0, ids.length - 2);
  return { miles, climb, junctions, maxNav };
}

/* ---------------- classification ---------------- */

function classify(stats, poiOffTrail) {
  const len = stats.miles <= 1.6 ? "short" : stats.miles <= 3.4 ? "medium" : "long";
  const effortScore = stats.miles + stats.climb / 450;
  const effort = effortScore < 2 ? "easy" : effortScore < 3.6 ? "moderate" : "hard";
  let nav = stats.maxNav;
  if (poiOffTrail) nav = Math.min(3, nav + 1);
  if (stats.junctions >= 7) nav = Math.min(3, nav + 1);
  return { len, effort, nav };
}

const LEN_LABEL = { short: "Short", medium: "Medium", long: "Long" };
const EFFORT_LABEL = { easy: "Easy", moderate: "Moderate", hard: "Hard" };

/* ---------------- preferences & history ---------------- */

function emptyPrefs() { return { weights: {}, visited: {} }; }

function prefScore(prefs, poi) {
  let s = 0;
  for (const t of poi.tags) s += prefs.weights[t] || 0;
  const seen = prefs.visited[poi.id] || 0;
  return s - seen * 2.5; // novelty: strongly prefer places you haven't been
}

function recordOutcome(prefs, poi, rating) {
  // rating: 2 loved, 1 good, -1 meh
  for (const t of poi.tags) {
    prefs.weights[t] = (prefs.weights[t] || 0) + rating;
  }
  prefs.visited[poi.id] = (prefs.visited[poi.id] || 0) + 1;
}

function topTastes(prefs, n = 3) {
  return Object.entries(prefs.weights)
    .filter(([, w]) => w > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([t]) => t);
}

/* ---------------- suggestions ---------------- */

/**
 * Pick the best place to end a course after visiting `poi`: some trail
 * node elsewhere in the park (occasionally the car itself), chosen so the
 * course plus the remaining walk back to the car fits `budgetMiles`.
 */
function pickFinish(park, poiD, carD, poi, outboundIds, courseSoFar, budgetMiles) {
  let best = null;
  for (const finishId of Object.keys(park.nodes)) {
    if (finishId === poi.node) continue; // a course has to go somewhere
    const onward = poiD.dist[finishId];
    const home = carD.dist[finishId];
    if (!isFinite(onward) || !isFinite(home)) continue;
    const total = courseSoFar + onward + home;
    if (total > budgetMiles) continue;

    let s = 0;
    // explore: ending somewhere you didn't walk out through
    if (!outboundIds.includes(finishId)) s += 2.5;
    // genuinely new ground beats doubling straight back
    if (finishId !== outboundIds[0]) s += 1;
    // use most of the time you said you had — but don't stretch to the brim
    if (isFinite(budgetMiles)) {
      const use = total / budgetMiles;
      s += 3 * Math.max(0, 1 - Math.abs(use - 0.8) * 2.2);
    }
    // a real onward leg after the find, not a token few steps
    s += Math.min(onward, 1.5);
    // ...but don't strand them needlessly far from the car either
    s -= home * 0.2;

    if (!best || s > best.s) best = { finishId, onward, home, s };
  }
  return best;
}

/**
 * Build adventure candidates: from `fromId`, visit one POI, then come out
 * on a trail somewhere in the park — sometimes at the car, usually not —
 * keeping course + walk-home inside `budgetMiles`. Returns up to one best
 * candidate per length bucket, scored by taste, novelty, and whether the
 * POI lies along the hiker's predicted heading.
 */
function suggest(park, adj, fromId, carId, prefs, predictedIds, budgetMiles = Infinity) {
  const fromD = dijkstra(park, adj, fromId);
  const carD = dijkstra(park, adj, carId); // walk-home distance from anywhere
  const out = [];
  for (const poi of park.pois) {
    if (poi.node === fromId) continue;
    const toPoi = pathFrom(fromD.prev, fromId, poi.node);
    if (!toPoi) continue;
    const poiD = dijkstra(park, adj, poi.node);
    const courseSoFar = fromD.dist[poi.node];

    const fin = pickFinish(park, poiD, carD, poi, toPoi, courseSoFar, budgetMiles);
    if (!fin) continue;

    const onwardIds = pathFrom(poiD.prev, poi.node, fin.finishId);
    const ids = toPoi.concat(onwardIds.slice(1));
    const homeIds = pathFrom(carD.prev, carId, fin.finishId).reverse(); // finish -> car
    const stats = pathStats(park, adj, ids);
    const cls = classify(stats, poi.offTrail);

    let score = 10 + prefScore(prefs, poi);
    if (predictedIds && predictedIds.has(poi.node)) score += 4; // "on your way"
    if (poi.offTrail) score += 1; // the whole point of the app
    score += fin.s * 0.5;

    out.push({
      poi, ids, stats, cls, score,
      finishId: fin.finishId,
      homeIds,
      homeMiles: fin.home,
      endsAtCar: fin.finishId === carId,
      onYourWay: !!(predictedIds && predictedIds.has(poi.node)),
    });
  }

  // one best option per length bucket, then fill with next-best overall
  out.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const len of ["short", "medium", "long"]) {
    const c = out.find(o => o.cls.len === len && !picked.includes(o));
    if (c) picked.push(c);
  }
  for (const o of out) {
    if (picked.length >= 4) break;
    if (!picked.includes(o)) picked.push(o);
  }
  picked.sort((a, b) => a.stats.miles - b.stats.miles);
  return picked;
}

/* ---------------- position snapping ---------------- */

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return { d: Math.hypot(px - x, py - y), x, y, t };
}

/** Snap a map-coordinate point to the nearest trail edge,
 *  following the edge's real polyline geometry. */
function snapToTrail(park, x, y) {
  let best = null;
  for (const e of park.edges) {
    const p = e.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const s = distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]);
      if (!best || s.d < best.d) best = { ...s, edge: e };
    }
  }
  return best;
}

/** Real trail geometry for a node-id route, as flat [x1,y1,…] points. */
function routePts(park, adj, ids) {
  const out = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const e = edgeBetween(adj, ids[i], ids[i + 1]);
    if (!e) continue;
    let pts = e.pts;
    if (e.a !== ids[i]) { // edge stored b→a relative to our travel: reverse
      pts = [];
      for (let j = e.pts.length - 2; j >= 0; j -= 2) pts.push(e.pts[j], e.pts[j + 1]);
    }
    const start = out.length ? 2 : 0; // skip duplicated junction point
    for (let j = start; j < pts.length; j++) out.push(pts[j]);
  }
  return out;
}

function nearestNode(park, x, y) {
  let best = null, bestD = Infinity;
  for (const [id, n] of Object.entries(park.nodes)) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/* ---------------- prediction ---------------- */

/**
 * Given the last few snapped node visits (most recent last), figure out
 * which way the hiker is heading and collect node ids reachable within
 * `horizonMiles` *without* going back the way they came.
 */
function predictAhead(park, adj, recentNodes, horizonMiles = 1.3) {
  if (recentNodes.length < 2) return new Set();
  const cur = recentNodes[recentNodes.length - 1];
  const cameFrom = recentNodes[recentNodes.length - 2];
  const reach = new Set();
  const stack = [{ id: cur, from: cameFrom, left: horizonMiles }];
  while (stack.length) {
    const { id, from, left } = stack.pop();
    for (const { to, edge } of adj[id]) {
      if (to === from) continue; // don't predict a U-turn
      if (edge.miles > left) continue;
      if (!reach.has(to)) {
        reach.add(to);
        stack.push({ id: to, from: id, left: left - edge.miles });
      }
    }
  }
  return reach;
}

/* ---------------- live hints (warmer / colder) ---------------- */

function hintFor(poi, hintIndex, distMilesNow, distMilesAtLastHint) {
  const canned = poi.hints || [];
  const seq = [];
  if (canned[0]) seq.push({ kind: "canned", text: canned[0] });
  seq.push({ kind: "trend" });
  if (canned[1]) seq.push({ kind: "canned", text: canned[1] });
  seq.push({ kind: "range" });
  if (canned[2]) seq.push({ kind: "canned", text: canned[2] });

  const step = seq[Math.min(hintIndex, seq.length - 1)];
  if (step.kind === "canned") return step.text;
  if (step.kind === "trend") {
    if (distMilesAtLastHint == null) return "Keep moving, then ask again — I'll tell you if you're getting warmer.";
    const delta = distMilesAtLastHint - distMilesNow;
    if (delta > 0.02) return "Warmer. Noticeably warmer, actually.";
    if (delta < -0.02) return "Colder. Whatever you just decided… reconsider.";
    return "Lukewarm. You're circling it.";
  }
  // range
  if (distMilesNow < 0.08) return "You're within a couple hundred yards. Eyes up, phone down.";
  if (distMilesNow < 0.25) return "Less than a quarter mile as the crow flies. The crow is smug about it.";
  if (distMilesNow < 0.6)  return "Somewhere under three-quarters of a mile. The right trail matters more than speed.";
  return "Still a fair hike away. Trust the map, pick your route.";
}

/* ---------------- easy course generation ----------------
 * Courses are guided walks over the handrail network: trails, streams,
 * reentrant axes, spur crests, stitched into one graph at build time.
 * Easy rules: start on a trail near the hiker, ~100 m legs that follow
 * handrails, each control a distinct detected feature, finish on trail.
 */

const EASY = {
  startSnapM: 80,     // hiker must be this close to a trail to start
  firstLegMaxM: 350,  // walking in along the trail before the attack is fine
  legMinM: 60, legMaxM: 240, legIdealM: 120,
  finishMinM: 30, finishMaxM: 300,
  punchM: 30,         // arrival radius at a control
};

function handrailAdj(park) {
  if (park._hadj) return park._hadj;
  const h = park.handrails;
  const n = h.nodes.length / 2;
  const adj = Array.from({ length: n }, () => []);
  park._hkind = new Map(); // (a,b) -> edge kind, for route-quality scoring
  park._hlen = new Map();
  for (let i = 0; i + 3 < h.edges.length; i += 4) {
    const [a, b, kind, m] = [h.edges[i], h.edges[i + 1], h.edges[i + 2], h.edges[i + 3]];
    adj[a].push([b, m, kind]);
    adj[b].push([a, m, kind]);
    park._hkind.set(a * 100000 + b, kind);
    park._hlen.set(a * 100000 + b, m);
  }
  park._hadj = adj;
  return adj;
}

/* fraction of a leg's meters spent following reentrant axes */
function legReentrantFrac(park, prev, from, to) {
  let total = 0, reent = 0, v = to, guard = 0;
  while (v !== from && v >= 0 && guard++ < 20000) {
    const u = prev[v];
    if (u < 0) break;
    const kind = park._hkind.get(u * 100000 + v) ?? park._hkind.get(v * 100000 + u);
    const len = park._hlen.get(u * 100000 + v) ?? park._hlen.get(v * 100000 + u) ?? 0;
    total += len;
    if (kind === 2) reent += len;
    v = u;
  }
  return total ? reent / total : 0;
}

/* Dijkstra with integer-meter buckets (Dial's algorithm), cut at maxM. */
function hrDijkstra(park, src, maxM) {
  const adj = handrailAdj(park);
  const n = adj.length;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const buckets = Array.from({ length: maxM + 1 }, () => []);
  dist[src] = 0;
  buckets[0].push(src);
  for (let d = 0; d <= maxM; d++) {
    for (const u of buckets[d]) {
      if (dist[u] < d) continue;
      for (const [v, m, kind] of adj[u]) {
        void kind;
        const nd = d + m;
        if (nd <= maxM && nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          buckets[nd].push(v);
        }
      }
    }
  }
  return { dist, prev };
}

function hrNode(park, i) {
  return { x: park.handrails.nodes[i * 2], y: park.handrails.nodes[i * 2 + 1] };
}

/* Nearest handrail node of a given kind (0=trail) to a map point. */
function nearestHrNode(park, x, y, kindFilter = null) {
  const h = park.handrails;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < h.nodeKind.length; i++) {
    if (kindFilter !== null && h.nodeKind[i] !== kindFilter) continue;
    const d = Math.hypot(h.nodes[i * 2] - x, h.nodes[i * 2 + 1] - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { node: best, distM: bestD / (park.pxPerMile / 1609.34) };
}

const FEATURE_LABEL = {
  hill: (f) => `Hilltop · ${Math.round(f.q)} ft relief`,
  reentrant: (f) => `Reentrant · ${f.depth} ft deep, ${f.len} m long`,
  spur: (f) => `Spur · drops ${f.depth} ft each side`,
  streambend: () => "Stream bend",
  streamjct: () => "Stream junction",
};

const FEATURE_HINT = {
  hill: "Up is the only instruction. Stop when everything else is down.",
  reentrant: "Stay on your handrail until the ground folds into a small valley — stand in its crease.",
  spur: "The hillside sticks a finger out. Walk the knuckle, not the webbing.",
  streambend: "Water is your handrail. The control is where it changes its mind.",
  streamjct: "Follow the water until it meets more water.",
};

/**
 * Generate up to 3 easy courses from `pos` (map coords): nControls
 * distinct features ~100 m apart along handrails, then out to a trail.
 */
function easyCourses(park, pos, nControls) {
  const pxPerM = park.pxPerMile / 1609.34;
  const start = nearestHrNode(park, pos.x, pos.y, 0); // kind 0 = trail
  if (start.node < 0 || start.distM > EASY.startSnapM) {
    return { error: `You need to be within ${EASY.startSnapM} m of a trail to start an easy course.` };
  }

  // this version: reentrants only — you follow a reentrant, then another
  // reentrant brings you back out to a path
  const usable = park.features.filter((f) => f.hn !== undefined && f.t === "reentrant");

  // beam search over control sequences
  let beams = [{ at: start.node, controls: [], score: 0, usedF: new Set() }];
  for (let leg = 0; leg < nControls; leg++) {
    const legMax = leg === 0 ? EASY.firstLegMaxM : EASY.legMaxM;
    const next = [];
    for (const b of beams) {
      const { dist, prev } = hrDijkstra(park, b.at, legMax + 30);
      for (const f of usable) {
        if (b.usedF.has(f)) continue;
        const dM = dist[f.hn];
        if (!isFinite(dM) || dM < EASY.legMinM || dM > legMax) continue;
        // controls shouldn't bunch up
        if (b.controls.some((c) => Math.hypot(c.f.x - f.x, c.f.y - f.y) / pxPerM < 60)) continue;
        let s = b.score;
        s -= Math.abs(dM - EASY.legIdealM) * 0.15;            // leg length near ideal
        s += Math.min(20, (f.depth || f.q || 5));              // prominent feature
        s += 14 * legReentrantFrac(park, prev, b.at, f.hn);    // FOLLOW the reentrant, don't trail-walk
        next.push({
          at: f.hn, score: s,
          controls: [...b.controls, { f, legM: Math.round(dM) }],
          usedF: new Set([...b.usedF, f]),
        });
      }
    }
    next.sort((a, c) => c.score - a.score);
    beams = next.slice(0, 6);
    if (!beams.length) return { error: "No reentrant country within easy reach from here — hike a little farther in and try again." };
  }

  // exit leg: nearest trail node, ideally not where you started
  const courses = [];
  for (const b of beams) {
    const { dist } = hrDijkstra(park, b.at, EASY.finishMaxM);
    let fin = -1, finScore = -Infinity;
    for (let i = 0; i < park.handrails.nodeKind.length; i++) {
      if (park.handrails.nodeKind[i] !== 0) continue;
      const dM = dist[i];
      if (!isFinite(dM) || dM < EASY.finishMinM || dM > EASY.finishMaxM) continue;
      const p = hrNode(park, i);
      let s = -Math.abs(dM - 120) * 0.1;
      s += Math.min(25, Math.hypot(p.x - pos.x, p.y - pos.y) / pxPerM * 0.08); // new ground
      if (s > finScore) { finScore = s; fin = i; }
    }
    if (fin < 0) continue;
    const finishLegM = Math.round(dist[fin]);
    courses.push({
      kind: "easy",
      startNode: start.node, startPt: hrNode(park, start.node),
      controls: b.controls.map((c) => ({ ...c, found: false })),
      finishNode: fin, finishPt: hrNode(park, fin),
      finishLegM,
      totalM: b.controls.reduce((s, c) => s + c.legM, 0) + finishLegM,
      score: b.score + finScore,
    });
  }
  courses.sort((a, b) => b.score - a.score);
  // de-dup courses sharing the same first control
  const seen = new Set(), out = [];
  for (const c of courses) {
    const k = c.controls[0].f.x + ":" + c.controls[0].f.y;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= 3) break;
  }
  return { courses: out };
}

/* ---------------- geo projection ---------------- */

function geoToMap(park, lat, lng) {
  const g = park.geo;
  const x = ((lng - g.lngMin) / (g.lngMax - g.lngMin)) * park.mapW;
  const y = ((g.latMax - lat) / (g.latMax - g.latMin)) * park.mapH;
  const inside = lat >= g.latMin && lat <= g.latMax && lng >= g.lngMin && lng <= g.lngMax;
  return { x, y, inside };
}

if (typeof module !== "undefined") {
  module.exports = {
    buildAdj, dijkstra, pathFrom, edgeBetween, pathStats, classify,
    LEN_LABEL, EFFORT_LABEL, emptyPrefs, prefScore, recordOutcome, topTastes,
    suggest, snapToTrail, routePts, nearestNode, predictAhead, hintFor, geoToMap,
    easyCourses, nearestHrNode, hrDijkstra, hrNode, FEATURE_LABEL, FEATURE_HINT, EASY,
  };
}
