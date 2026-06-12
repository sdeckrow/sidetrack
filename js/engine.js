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
  };
}
