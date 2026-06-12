/* Build js/data.js from real survey data.
 *
 * Inputs:  tools/raw/<park>.json   (OSM trails/water/parking — fetch-osm.mjs)
 *          tools/raw/tiles/        (terrarium elevation PNGs — fetch-elevation.mjs)
 *          tools/park-content.mjs  (hand-written POIs, hints, taglines)
 *
 * Output:  js/data.js — generated; never edit by hand.
 *
 * Pipeline: decode DEM → marching-squares contours → trail graph
 * (split OSM ways at junctions, merge pass-through nodes, real miles +
 * climb per edge) → resolve POI anchors → project everything to map
 * coordinates → emit.
 *
 * Usage: node tools/build-mapdata.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFeatures, smooth3 } from "./terrain.mjs";
import { loadLidar } from "./lidar.mjs";
import { TAGS, PARK_CONTENT } from "./park-content.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const Z = 15;
const TILE = 256;
const MAP_W = 1000;

/* ---------------- geo helpers ---------------- */

const R_MI = 3958.8;
function haversineMiles(la1, lo1, la2, lo2) {
  const r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(a));
}

function pointInPoly(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat, xi = poly[i].lon, yj = poly[j].lat, xj = poly[j].lon;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const lng2px = (lng) => ((lng + 180) / 360) * 2 ** Z * TILE;
const lat2px = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z * TILE;
};
const px2lng = (px) => (px / (2 ** Z * TILE)) * 360 - 180;
const px2lat = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (2 ** Z * TILE)))) * 180) / Math.PI;

/* ---------------- polyline utils ---------------- */

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

function chaikin(pts, closed = false) {
  if (pts.length < 3) return pts;
  const out = closed ? [] : [pts[0]];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    out.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25]);
    out.push([x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

const flat = (pts) => pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);

/* ---------------- contours (marching squares) ---------------- */

function buildContours(gridInfo, project, intervalFt, indexEvery) {
  const { grid, W, H, toLL } = gridInfo;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < lo) lo = grid[i];
    if (grid[i] > hi) hi = grid[i];
  }

  const levels = [];
  for (let l = Math.ceil(lo / intervalFt) * intervalFt; l < hi; l += intervalFt) levels.push(l);

  const minor = [], index = [];
  for (const level of levels) {
    // collect cell-edge crossings as segments, then chain them
    const segs = [];
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const v00 = grid[y * W + x], v10 = grid[y * W + x + 1];
        const v01 = grid[(y + 1) * W + x], v11 = grid[(y + 1) * W + x + 1];
        const lo4 = Math.min(v00, v10, v01, v11), hi4 = Math.max(v00, v10, v01, v11);
        if (level < lo4 || level >= hi4) continue;
        let idx = 0;
        if (v00 >= level) idx |= 1;
        if (v10 >= level) idx |= 2;
        if (v11 >= level) idx |= 4;
        if (v01 >= level) idx |= 8;
        if (idx === 0 || idx === 15) continue;
        const t = (a, b) => (level - a) / (b - a);
        const top = [x + t(v00, v10), y], right = [x + 1, y + t(v10, v11)];
        const bot = [x + t(v01, v11), y + 1], left = [x, y + t(v00, v01)];
        const E = {
          1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bot]],
          6: [[top, bot]], 7: [[left, bot]], 8: [[bot, left]], 9: [[bot, top]],
          11: [[bot, right]], 12: [[right, left]], 13: [[right, top]], 14: [[top, left]],
          5: (v00 + v10 + v01 + v11) / 4 >= level ? [[left, bot], [right, top]] : [[left, top], [right, bot]],
          10: (v00 + v10 + v01 + v11) / 4 >= level ? [[top, right], [bot, left]] : [[top, left], [bot, right]],
        }[idx];
        for (const s of E) segs.push(s);
      }
    }
    // chain segments into polylines
    const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
    const byEnd = new Map();
    segs.forEach((s, i) => {
      for (const p of [s[0], s[1]]) {
        const k = key(p);
        if (!byEnd.has(k)) byEnd.set(k, []);
        byEnd.get(k).push(i);
      }
    });
    const used = new Uint8Array(segs.length);
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [segs[i][0], segs[i][1]];
      for (const dir of [1, 0]) { // extend forward then backward
        for (;;) {
          const end = dir ? line[line.length - 1] : line[0];
          const cands = (byEnd.get(key(end)) || []).filter((j) => !used[j]);
          if (!cands.length) break;
          const j = cands[0];
          used[j] = 1;
          const nxt = key(segs[j][0]) === key(end) ? segs[j][1] : segs[j][0];
          dir ? line.push(nxt) : line.unshift(nxt);
        }
      }
      if (line.length < 5) continue;
      // cell coords → lat/lng → map coords, smooth, simplify
      let pts = line.map(([cx, cy]) => {
        const ll = toLL(cx, cy);
        const m = project(ll.lat, ll.lng);
        return [m.x, m.y];
      });
      pts = rdp(chaikin(pts), 0.9);
      if (pts.length < 3) continue;
      if (level % (intervalFt * indexEvery) === 0) index.push({ e: level, pts: flat(pts) });
      else minor.push(flat(pts));
    }
  }
  return { minor, index, levels: levels.length, lo: Math.round(lo), hi: Math.round(hi) };
}

/* ---------------- trail graph ---------------- */

const TRAIL_RX = /^(path|footway|track|cycleway|bridleway|steps)$/;
const ROAD_RX = /^(residential|service|unclassified|tertiary|secondary|primary)$/;

function navRating(tags) {
  const hw = tags.highway;
  if (hw === "track" || hw === "cycleway" || hw === "footway" || hw === "steps") return 1;
  if (/^(paved|asphalt|concrete|compacted|fine_gravel|gravel)$/.test(tags.surface || "")) return 1;
  if (/^(bad|horrible|no)$/.test(tags.trail_visibility || "") || tags.informal === "yes") return 3;
  return 2;
}

function buildGraph(elements, boundaryGeom, dem, project) {
  const ways = elements.filter(
    (e) => e.type === "way" && TRAIL_RX.test(e.tags?.highway || "") &&
      e.geometry?.some((p) => pointInPoly(p.lat, p.lon, boundaryGeom))
  );

  // junction = OSM node shared by >1 kept way (or used twice in one way)
  const useCount = new Map();
  for (const w of ways) {
    const seen = new Set();
    for (const nid of w.nodes) {
      useCount.set(nid, (useCount.get(nid) || 0) + (seen.has(nid) ? 1 : 1));
      seen.add(nid);
    }
  }

  // split ways into edges at junctions
  let rawEdges = [];
  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const isJunction = useCount.get(w.nodes[i]) > 1;
      if (isJunction || i === w.nodes.length - 1) {
        rawEdges.push({
          aId: w.nodes[start], bId: w.nodes[i],
          ll: w.geometry.slice(start, i + 1),
          name: w.tags.name || null, tags: w.tags,
        });
        start = i;
      }
    }
  }

  // merge chains through degree-2 nodes with matching trail names
  for (;;) {
    const at = new Map();
    rawEdges.forEach((e, i) => {
      for (const id of [e.aId, e.bId]) {
        if (!at.has(id)) at.set(id, []);
        at.get(id).push(i);
      }
    });
    let merged = false;
    for (const [nid, idxs] of at) {
      if (idxs.length !== 2 || idxs[0] === idxs[1]) continue;
      const [e1, e2] = [rawEdges[idxs[0]], rawEdges[idxs[1]]];
      if (!e1 || !e2 || e1 === e2 || e1.name !== e2.name) continue;
      if (e1.aId === e1.bId || e2.aId === e2.bId) continue; // loops stay
      const p1 = e1.aId === nid ? { from: e1.bId, ll: [...e1.ll].reverse() } : { from: e1.aId, ll: e1.ll };
      const p2 = e2.aId === nid ? { to: e2.bId, ll: e2.ll } : { to: e2.aId, ll: [...e2.ll].reverse() };
      if (p1.from === p2.to) continue; // would collapse a loop
      rawEdges[idxs[0]] = { aId: p1.from, bId: p2.to, ll: p1.ll.concat(p2.ll.slice(1)), name: e1.name, tags: e1.tags };
      rawEdges[idxs[1]] = null;
      rawEdges = rawEdges.filter(Boolean);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  // drop tiny disconnected scraps (sidewalk fragments etc.)
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const e of rawEdges) for (const id of [e.aId, e.bId]) if (!parent.has(id)) parent.set(id, id);
  for (const e of rawEdges) parent.set(find(e.aId), find(e.bId));
  const compMiles = new Map();
  for (const e of rawEdges) {
    let mi = 0;
    for (let i = 1; i < e.ll.length; i++) mi += haversineMiles(e.ll[i - 1].lat, e.ll[i - 1].lon, e.ll[i].lat, e.ll[i].lon);
    e.miles = mi;
    const c = find(e.aId);
    compMiles.set(c, (compMiles.get(c) || 0) + mi);
  }
  rawEdges = rawEdges.filter((e) => compMiles.get(find(e.aId)) >= 0.4);

  // graph nodes with friendly ids; names from incident trails
  const nodeIds = new Map();
  const nodes = {};
  let nCount = 0;
  const idFor = (osmId, ll) => {
    if (nodeIds.has(osmId)) return nodeIds.get(osmId);
    const id = "n" + (++nCount);
    nodeIds.set(osmId, id);
    const m = project(ll.lat, ll.lon);
    nodes[id] = { x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 };
    return id;
  };

  const edges = rawEdges.map((e) => {
    const a = idFor(e.aId, e.ll[0]);
    const b = idFor(e.bId, e.ll[e.ll.length - 1]);
    // climb: positive elevation gain along the line, 3 ft deadband
    let climb = 0, prevE = dem.atLL(e.ll[0].lat, e.ll[0].lon);
    for (let i = 1; i < e.ll.length; i++) {
      const el = dem.atLL(e.ll[i].lat, e.ll[i].lon);
      if (el - prevE > 3) { climb += el - prevE; prevE = el; }
      else if (el < prevE) prevE = el;
    }
    const ptsLL = e.ll.map((p) => { const m = project(p.lat, p.lon); return [m.x, m.y]; });
    return {
      a, b, trail: e.name || "unnamed path",
      miles: Math.round(e.miles * 100) / 100,
      climb: Math.round(climb),
      nav: navRating(e.tags),
      pts: flat(rdp(ptsLL, 0.4)),
    };
  });

  // node names from incident edges
  const incident = {};
  edges.forEach((e) => {
    (incident[e.a] = incident[e.a] || []).push(e);
    (incident[e.b] = incident[e.b] || []).push(e);
  });
  for (const [id, n] of Object.entries(nodes)) {
    const names = [...new Set((incident[id] || []).map((e) => e.trail).filter((t) => t !== "unnamed path"))];
    const deg = (incident[id] || []).length;
    if (deg === 1) n.name = names[0] ? `end of ${names[0]}` : "trail end";
    else if (names.length >= 2) n.name = `${names[0]} × ${names[1]}`;
    else if (names.length === 1) n.name = `${names[0]} junction`;
    else n.name = "trail junction";
  }

  return { nodes, edges };
}

/* ---------------- main ---------------- */

const out = {};

for (const parkId of ["redmountain", "oakmountain"]) {
  console.log(`\n=== ${parkId} ===`);
  const raw = JSON.parse(await readFile(path.join(HERE, "raw", `${parkId}.json`), "utf8"));
  const { bbox } = raw;
  const content = PARK_CONTENT[parkId];

  // projection: equirectangular, x = 1000 px wide, y scaled to true aspect
  const midLat = ((bbox.latMin + bbox.latMax) / 2) * (Math.PI / 180);
  const xMi = (bbox.lngMax - bbox.lngMin) * 69.172 * Math.cos(midLat);
  const yMi = (bbox.latMax - bbox.latMin) * 68.703;
  const mapH = Math.round((MAP_W * yMi) / xMi);
  const pxPerMile = MAP_W / xMi;
  const project = (lat, lng) => ({
    x: ((lng - bbox.lngMin) / (bbox.lngMax - bbox.lngMin)) * MAP_W,
    y: ((bbox.latMax - lat) / (bbox.latMax - bbox.latMin)) * mapH,
  });
  console.log(`map ${MAP_W}x${mapH}, ${pxPerMile.toFixed(0)} px/mi`);

  // USGS 3DEP lidar elevation (fetch-lidar.mjs)
  const gridInfo = await loadLidar(parkId);
  console.log(`lidar: ${gridInfo.W}x${gridInfo.H} @ ${gridInfo.res} m/px`);

  // vector contour overlay, 20 ft to match the USGS basemap interval
  const interval = 20;
  const cGrid = smooth3(smooth3(gridInfo.grid, gridInfo.W, gridInfo.H), gridInfo.W, gridInfo.H);
  const contours = buildContours({ ...gridInfo, grid: cGrid }, project, interval, 5);
  console.log(`contours: ${contours.minor.length} minor + ${contours.index.length} index (${contours.lo}–${contours.hi} ft, ${interval} ft interval)`);

  const { nodes, edges } = buildGraph(raw.elements, raw.boundary.geometry, gridInfo, project);
  console.log(`graph: ${Object.keys(nodes).length} nodes, ${edges.length} edges, ${edges.reduce((s, e) => s + e.miles, 0).toFixed(1)} trail miles`);

  /* parking: a lot is a trailhead if it sits close to a trail node
   * (the lots themselves are often mapped just outside the park polygon) */
  const inPark = (g) => g.some((p) => pointInPoly(p.lat, p.lon, raw.boundary.geometry));
  const lots = raw.elements.filter((e) => e.type === "way" && e.tags?.amenity === "parking" && e.geometry);
  const parkingLots = [];
  for (const lot of lots) {
    const cLat = lot.geometry.reduce((s, p) => s + p.lat, 0) / lot.geometry.length;
    const cLng = lot.geometry.reduce((s, p) => s + p.lon, 0) / lot.geometry.length;
    const c = project(cLat, cLng);
    let best = null, bestD = Infinity;
    for (const [id, n] of Object.entries(nodes)) {
      const d = Math.hypot(n.x - c.x, n.y - c.y);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (!best || bestD > pxPerMile * 0.09) continue; // not a trailhead lot
    parkingLots.push({ pts: flat(lot.geometry.map((p) => { const m = project(p.lat, p.lon); return [m.x, m.y]; })) });
    if (!nodes[best].parking) {
      nodes[best].parking = true;
      let base = nodes[best].name.replace(/^end of /, "").replace(/ junction$/, "").replace(/ × .*$/, "").trim();
      if (/^trail( end)?$/.test(base)) base = "";
      nodes[best].name = lot.tags.name || (base ? `${base} trailhead` : "Trailhead");
    }
  }
  // content-declared trailheads (real lots OSM doesn't have yet)
  for (const th of content.trailheads || []) {
    const c = project(th.lat, th.lng);
    let best = null, bestD = Infinity;
    for (const [id, n] of Object.entries(nodes)) {
      const d = Math.hypot(n.x - c.x, n.y - c.y);
      if (d < bestD) { bestD = d; best = id; }
    }
    nodes[best].parking = true;
    nodes[best].name = th.name;
  }
  console.log(`parking: ${parkingLots.length} trailhead lots, ${Object.values(nodes).filter((n) => n.parking).length} trailhead nodes`);

  /* water, streams, roads, veg, boundary */
  const polyOf = (e) => flat(e.geometry.map((p) => { const m = project(p.lat, p.lon); return [m.x, m.y]; }));
  const els = raw.elements.filter((e) => e.type === "way" && e.geometry);
  const water = els.filter((e) => e.tags.natural === "water" || e.tags.landuse === "reservoir")
    .map((e) => ({ name: e.tags.name || null, pts: polyOf(e) }));
  const streams = els.filter((e) => /^(river|stream)$/.test(e.tags.waterway || "") && inPark(e.geometry)).map(polyOf);
  const dams = els.filter((e) => e.tags.waterway === "dam").map(polyOf);
  const roads = els.filter((e) => ROAD_RX.test(e.tags.highway || "") && inPark(e.geometry))
    .map((e) => ({ kind: /^(secondary|tertiary|primary)$/.test(e.tags.highway) ? "major" : "minor", pts: polyOf(e) }));
  const veg = els.filter((e) =>
    (/^(grass|meadow|recreation_ground)$/.test(e.tags.landuse || "") ||
      /^(pitch|golf_course)$/.test(e.tags.leisure || "") ||
      /^(grassland|beach)$/.test(e.tags.natural || "")) && inPark(e.geometry))
    .map((e) => ({ fill: e.tags.natural === "scrub" ? "green" : "yellow", pts: polyOf(e) }));
  const scrub = els.filter((e) => e.tags.natural === "scrub" && inPark(e.geometry))
    .map((e) => ({ fill: "green", pts: polyOf(e) }));
  const boundary = polyOf(raw.boundary);

  /* terrain features: candidate control points for course generation */
  const cellM = gridInfo.res * Math.cos(midLat); // merc meters → ground meters
  const features = extractFeatures(gridInfo, {
    cellM,
    toMap: (cx, cy) => { const ll = gridInfo.toLL(cx, cy); return project(ll.lat, ll.lng); },
    boundaryFlat: boundary,
    streams,
    trailPts: edges.flatMap((e) => e.pts),
  });
  const fCounts = {};
  for (const f of features) fCounts[f.t] = (fCounts[f.t] || 0) + 1;
  console.log(`features: ${features.length}`, fCounts);

  /* POIs: resolve anchors to real coords + nearest graph node */
  const adjEdges = edges;
  const pois = [];
  for (const poi of content.pois) {
    let lat, lng;
    if (poi.anchor.lat) ({ lat, lng } = poi.anchor);
    else if (poi.anchor.trail) {
      const named = adjEdges.filter((e) => e.trail === poi.anchor.trail).sort((a, b) => b.miles - a.miles)[0];
      if (!named) { console.log(`  !! POI ${poi.id}: trail "${poi.anchor.trail}" not found — skipped`); continue; }
      const mid = Math.floor(named.pts.length / 4) * 2;
      const m = named.pts;
      pois.push(finishPoi(poi, { x: m[mid], y: m[mid + 1] }));
      continue;
    } else if (poi.anchor.water) {
      const lake = water.find((w) => w.name === poi.anchor.water);
      if (!lake) { console.log(`  !! POI ${poi.id}: lake "${poi.anchor.water}" not found — skipped`); continue; }
      const xs = lake.pts.filter((_, i) => i % 2 === 0), ys = lake.pts.filter((_, i) => i % 2 === 1);
      pois.push(finishPoi(poi, { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length }));
      continue;
    }
    const m = project(lat, lng);
    pois.push(finishPoi(poi, m));
  }
  function finishPoi(poi, m) {
    let best = null, bestD = Infinity;
    for (const [id, n] of Object.entries(nodes)) {
      const d = Math.hypot(n.x - m.x, n.y - m.y);
      if (d < bestD) { bestD = d; best = id; }
    }
    return {
      id: poi.id, node: best, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10,
      name: poi.name, tags: poi.tags, offTrail: poi.offTrail, blurb: poi.blurb, hints: poi.hints,
    };
  }
  console.log(`pois: ${pois.map((p) => p.id).join(", ")}`);

  /* labels: most-significant named trails + named lakes */
  const byName = new Map();
  for (const e of edges) {
    if (e.trail === "unnamed path") continue;
    byName.set(e.trail, (byName.get(e.trail) || 0) + e.miles);
  }
  const labels = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => {
    const e = edges.filter((x) => x.trail === name).sort((a, b) => b.miles - a.miles)[0];
    const m = e.pts, mid = Math.floor(m.length / 4) * 2;
    const x1 = m[Math.max(0, mid - 2)], y1 = m[Math.max(0, mid - 1)];
    const x2 = m[Math.min(m.length - 2, mid + 2)], y2 = m[Math.min(m.length - 1, mid + 3)];
    let rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    if (rot > 90) rot -= 180;
    if (rot < -90) rot += 180;
    return { x: m[mid], y: m[mid + 1], rot: Math.round(rot), text: name };
  });
  const lakeLabels = water.filter((w) => w.name && w.pts.length > 16).map((w) => {
    const xs = w.pts.filter((_, i) => i % 2 === 0), ys = w.pts.filter((_, i) => i % 2 === 1);
    return { x: Math.round(xs.reduce((a, b) => a + b) / xs.length), y: Math.round(ys.reduce((a, b) => a + b) / ys.length), text: w.name };
  });

  // USGS Topo basemap tile ranges (tiles fetched by fetch-basemap.mjs)
  const tiles = {
    url: "tiles/usgstopo",
    levels: [15, 16].map((TZ) => ({
      z: TZ,
      x0: Math.floor(lng2px(bbox.lngMin) / TILE / 2 ** (Z - TZ)),
      x1: Math.floor(lng2px(bbox.lngMax) / TILE / 2 ** (Z - TZ)),
      y0: Math.floor(lat2px(bbox.latMax) / TILE / 2 ** (Z - TZ)),
      y1: Math.floor(lat2px(bbox.latMin) / TILE / 2 ** (Z - TZ)),
    })),
  };
  void veg; void scrub; void roads; void labels; // display now comes from USGS tiles

  out[parkId] = {
    id: parkId, name: content.name, tagline: content.tagline,
    mapW: MAP_W, mapH, pxPerMile: Math.round(pxPerMile * 10) / 10,
    geo: bbox, tiles, contourInterval: interval,
    contours: { minor: contours.minor, index: contours.index },
    boundary, water, streams, dams, parkingLots,
    nodes, edges, pois, lakeLabels, features,
  };
}

const header = `/* Sidetrack — park data. GENERATED by tools/build-mapdata.mjs — DO NOT EDIT.
 *
 * Real survey data:
 *  - Trails, water, roads, parking: © OpenStreetMap contributors (ODbL)
 *  - Contours: USGS 3DEP / Mapzen terrain tiles (AWS Open Data)
 * Edit POI content in tools/park-content.mjs, then:
 *   node tools/fetch-osm.mjs && node tools/fetch-elevation.mjs && node tools/build-mapdata.mjs
 */

`;
const js =
  header +
  `const TAGS = ${JSON.stringify(TAGS, null, 2)};\n\n` +
  `const PARKS = ${JSON.stringify(out)};\n\n` +
  `if (typeof module !== "undefined") module.exports = { PARKS, TAGS };\n`;

await writeFile(path.join(HERE, "..", "js", "data.js"), js);
const kb = Math.round(Buffer.byteLength(js) / 1024);
console.log(`\nwrote js/data.js (${kb} KB)`);
