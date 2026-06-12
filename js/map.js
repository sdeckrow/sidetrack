/* Sidetrack — topographic map renderer (SVG).
 *
 * Draws real survey data (OSM trails/water, USGS contours) in classic
 * USGS topo style: green woodland tint, white open land, brown contours
 * with elevation labels, blue water, black dashed trails, red major
 * roads — with an orienteering-purple course overlay on top.
 */

const SVGNS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/* flat [x1,y1,x2,y2,…] → SVG path d (straight segments) */
function flatPath(pts, close = false) {
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
  return close ? d + " Z" : d;
}

/* flat pts → smooth curve: quadratic beziers through segment midpoints.
 * For terrain lines (contours, reentrant/spur axes) — no corners. */
function curvePath(pts) {
  const n = pts.length;
  if (n < 6) return flatPath(pts);
  let d = `M ${pts[0]} ${pts[1]} L ${(pts[0] + pts[2]) / 2} ${(pts[1] + pts[3]) / 2}`;
  for (let i = 2; i + 3 < n; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2, my = (pts[i + 1] + pts[i + 3]) / 2;
    d += ` Q ${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  d += ` L ${pts[n - 2]} ${pts[n - 1]}`;
  return d;
}

const COLORS = {
  paper: "#fbfbf7",
  woodland: "#d3e5bc",   // USGS green tint: forested
  openLand: "#fbfbf7",   // white: clearings, fields
  contour: "#bc7e3c",
  contourIndex: "#9c5f22",
  water: "#b9d8ef",
  waterEdge: "#2a76b0",
  stream: "#2a76b0",
  grid: "#9bb4cc",
  roadMajor: "#d44a36",
  roadMinor: "#3c3c3c",
  trail: "#111111",
  boundary: "#444444",
  course: "#a626a6",
};

class ParkMap {
  constructor(svg, park) {
    this.svg = svg;
    this.park = park;
    this.W = park.mapW;
    this.H = park.mapH;
    this.view = { x: 0, y: 0, w: this.W, h: this.H };
    this.onTap = null;
    this._build();
    this._wireGestures();
  }

  _build() {
    const svg = this.svg;
    const { W, H } = this;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // layers, bottom to top
    this.gPaper = el("g", {}, svg);
    this.gBase = el("g", {}, svg);   // USGS Topo tiles
    this.gContours = el("g", {}, svg); // our lidar vector contours: crisp at any zoom
    this.gTrails = el("g", {}, svg);
    this.gBoundary = el("g", {}, svg);
    this.gLabels = el("g", { class: "map-labels" }, svg);
    this.gCourse = el("g", { class: "course" }, svg);
    this.gLive = el("g", {}, svg);

    el("rect", { x: 0, y: 0, width: W, height: H, fill: COLORS.paper }, this.gPaper);

    this._drawBasemap();
    this._drawContours();
    this._drawTrails();
    this._drawBoundary();
    this._drawFurniture();

    // "you" marker (hidden until positioned)
    this.youDot = el("g", { class: "you", visibility: "hidden" }, this.gLive);
    el("circle", { r: 14, class: "you-pulse" }, this.youDot);
    el("circle", { r: 6, class: "you-core" }, this.youDot);
  }

  /* Real USGS Topo tiles (public domain), positioned in map coords.
   * Level-of-detail: z15 for wide views, z16 when zoomed in; only tiles
   * intersecting the current view (plus a margin) are mounted. Each tile
   * rect is computed from its own mercator corners, so the mercator→
   * equirectangular mismatch stays sub-pixel at park scale. */
  _drawBasemap() {
    const p = this.park;
    const clipId = `clip-${p.id}`;
    const defs = el("defs", {}, this.svg);
    const clip = el("clipPath", { id: clipId }, defs);
    el("rect", { x: 0, y: 0, width: this.W, height: this.H }, clip);
    this.gBase.setAttribute("clip-path", `url(#${clipId})`);
    this.mountedTiles = new Map(); // "z/x/y" -> <image>
    this._updateTiles();
  }

  /* Lidar-derived vector contours over the raster basemap: they trace the
   * same terrain as the USGS lines but stay thin and dark at any zoom. */
  _drawContours() {
    const c = this.park.contours;
    if (!c) return;
    for (const line of c.minor) {
      el("path", {
        d: curvePath(line), fill: "none", stroke: COLORS.contour,
        "stroke-width": 0.8, opacity: 0.85, "vector-effect": "non-scaling-stroke",
      }, this.gContours);
    }
    for (const line of c.index) {
      el("path", {
        d: curvePath(line.pts), fill: "none", stroke: COLORS.contourIndex,
        "stroke-width": 1.6, opacity: 0.9, "vector-effect": "non-scaling-stroke",
      }, this.gContours);
    }
  }

  _tileMath(z) {
    const g = this.park.geo, n = 2 ** z;
    return {
      tx2lng: (x) => (x / n) * 360 - 180,
      ty2lat: (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
      lng2tx: (lng) => ((lng + 180) / 360) * n,
      lat2ty: (lat) => {
        const r = (lat * Math.PI) / 180;
        return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
      },
      mapX: (lng) => ((lng - g.lngMin) / (g.lngMax - g.lngMin)) * this.W,
      mapY: (lat) => ((g.latMax - lat) / (g.latMax - g.latMin)) * this.H,
      lngOfMapX: (x) => g.lngMin + (x / this.W) * (g.lngMax - g.lngMin),
      latOfMapY: (y) => g.latMax - (y / this.H) * (g.latMax - g.latMin),
    };
  }

  /* tile pixels per map px at a given level (≈ constant per park) */
  _tileDensity(level) {
    return ((level.x1 - level.x0 + 1) * 256) / this.W;
  }

  _updateTiles() {
    const p = this.park, v = this.view;
    if (!this.mountedTiles) return;
    // pick level: z16 once z15 pixels would stretch past ~1.3x on screen
    const clientW = this.svg.getBoundingClientRect().width || 800;
    const levels = p.tiles.levels;
    const screenPerTilePx = (lv) => clientW / v.w / this._tileDensity(lv);
    let level = levels[0];
    for (const lv of levels) {
      if (screenPerTilePx(level) > 1.3) level = lv;
    }
    const m = this._tileMath(level.z);
    // visible tile range with a margin of 1
    const x0 = Math.max(level.x0, Math.floor(m.lng2tx(m.lngOfMapX(v.x))) - 1);
    const x1 = Math.min(level.x1, Math.floor(m.lng2tx(m.lngOfMapX(v.x + v.w))) + 1);
    const y0 = Math.max(level.y0, Math.floor(m.lat2ty(m.latOfMapY(v.y))) - 1);
    const y1 = Math.min(level.y1, Math.floor(m.lat2ty(m.latOfMapY(v.y + v.h))) + 1);

    const want = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) want.add(`${level.z}/${x}/${y}`);
    for (const [key, img] of this.mountedTiles) {
      if (!want.has(key)) { img.remove(); this.mountedTiles.delete(key); }
    }
    for (const key of want) {
      if (this.mountedTiles.has(key)) continue;
      const [z, x, y] = key.split("/").map(Number);
      const mx1 = m.mapX(m.tx2lng(x)), mx2 = m.mapX(m.tx2lng(x + 1));
      const my1 = m.mapY(m.ty2lat(y)), my2 = m.mapY(m.ty2lat(y + 1));
      this.mountedTiles.set(key, el("image", {
        href: `${p.tiles.url}/${z}/${x}/${y}.png`,
        x: mx1, y: my1, width: mx2 - mx1, height: my2 - my1,
        preserveAspectRatio: "none",
      }, this.gBase));
    }
  }

  _drawTrails() {
    const p = this.park;
    for (const e of p.edges) {
      // USGS-style: trails are dashed black; dashes shorten as the path gets fainter
      const dash = e.nav >= 3 ? "2.5 3.5" : e.nav === 2 ? "6 3" : "11 3";
      el("path", {
        d: flatPath(e.pts), fill: "none",
        stroke: COLORS.trail, "stroke-width": e.nav >= 3 ? 1.1 : 1.5,
        "stroke-dasharray": dash, "stroke-linecap": "butt", class: "trail-edge",
        "vector-effect": "non-scaling-stroke",
      }, this.gTrails);
    }
    // junction dots + parking squares
    for (const [, n] of Object.entries(p.nodes)) {
      if (n.parking) {
        const g = el("g", { transform: `translate(${n.x},${n.y})` }, this.gTrails);
        el("rect", { x: -9, y: -9, width: 18, height: 18, rx: 2, fill: "#fff", stroke: "#111", "stroke-width": 1.5 }, g);
        const t = el("text", { "text-anchor": "middle", y: 5, class: "parking-p" }, g);
        t.textContent = "P";
      } else {
        el("circle", { cx: n.x, cy: n.y, r: 1.3, fill: COLORS.trail, opacity: 0.6 }, this.gTrails);
      }
    }
  }

  _drawBoundary() {
    const p = this.park;
    const { W, H } = this;
    // dim everything outside the park, ISOM out-of-bounds style
    el("path", {
      d: `M 0 0 H ${W} V ${H} H 0 Z ` + flatPath(p.boundary, true),
      fill: COLORS.paper, "fill-rule": "evenodd", opacity: 0.72, "pointer-events": "none",
    }, this.gBoundary);
    el("path", {
      d: flatPath(p.boundary, true), fill: "none",
      stroke: COLORS.boundary, "stroke-width": 1.3, "stroke-dasharray": "12 4 3 4", opacity: 0.9,
    }, this.gBoundary);
  }

  _drawFurniture() {
    // quad-style title block: small caps, top left, on a white tab
    const tb = el("g", {}, this.gLabels);
    const title = el("text", { x: 22, y: 34, class: "map-title" }, tb);
    title.textContent = this.park.name.toUpperCase();
    const tw = this.park.name.length * 11 + 24;
    tb.insertBefore(el("rect", { x: 12, y: 14, width: tw, height: 30, fill: "#fbfbf7", opacity: 0.85 }), title);
    const { W, H } = this;
    // north arrow
    const na = el("g", { transform: `translate(${W - 42}, 52)` }, this.gLabels);
    el("path", { d: "M 0 18 L 0 -16 M -7 -6 L 0 -16 L 7 -6", fill: "none", stroke: "#333", "stroke-width": 2.2, "stroke-linecap": "round" }, na);
    const nt = el("text", { x: 0, y: 34, "text-anchor": "middle", class: "north-n" }, na);
    nt.textContent = "N";
    // scale bar: one real mile, quarter ticks
    const mi = this.park.pxPerMile;
    const sb = el("g", { transform: `translate(22, ${H - 26})`, class: "scale-bar" }, this.gLabels);
    el("rect", { x: -8, y: -14, width: mi + 60, height: 30, fill: COLORS.paper, opacity: 0.8, rx: 2 }, sb);
    el("path", { d: `M 0 0 H ${mi}`, stroke: "#333", "stroke-width": 2 }, sb);
    for (let q = 0; q <= 4; q++) {
      el("path", { d: `M ${(mi * q) / 4} -5 V 5`, stroke: "#333", "stroke-width": q % 4 === 0 ? 2 : 1.2 }, sb);
    }
    const st = el("text", { x: mi + 8, y: 4, class: "scale-text" }, sb);
    st.textContent = "1 mile";
    const at = el("text", { x: 0, y: -18, class: "scale-text", opacity: 0.8 }, sb);
    at.textContent = "Basemap: USGS The National Map";
  }

  /* ---- terrain-feature debug overlay ---- */

  showFeatures(features) {
    if (this.gFeatures) this.gFeatures.remove();
    this.gFeatures = el("g", {}, this.svg);
    this.svg.insertBefore(this.gFeatures, this.gCourse);
    const STYLE = {
      hill: { color: "#8a4b14", shape: "triangle" },
      saddle: { color: "#8a4b14", shape: "diamond" },
      reentrant: { color: "#0a8a2a", shape: "axis" },
      spur: { color: "#e05c10", shape: "axis" },
      streambend: { color: "#1f6fa8", shape: "circle" },
      streamjct: { color: "#1f6fa8", shape: "square" },
    };
    for (const f of features) {
      const s = STYLE[f.t];
      if (!s) continue;
      const far = f.dT > this.park.pxPerMile * 0.3; // >0.3 mi from any trail
      const g = el("g", { opacity: far ? 0.35 : 0.95 }, this.gFeatures);
      const r = 3;
      if (s.shape === "axis") {
        // axis curve: thin, constant screen width at any zoom
        el("path", {
          d: curvePath(f.pts), fill: "none", stroke: s.color,
          "stroke-width": Math.min(2, 0.8 + f.depth / 30), "stroke-linecap": "round",
          "vector-effect": "non-scaling-stroke",
        }, g);
        const tip = el("title", {}, g);
        tip.textContent = `${f.t} axis · ${f.depth} ft deep · ${f.len} m long · ${(f.dT / this.park.pxPerMile).toFixed(2)} mi to trail`;
        continue;
      }
      if (s.shape === "triangle") {
        el("path", { d: `M ${f.x} ${f.y - r - 1} L ${f.x + r} ${f.y + r - 1} L ${f.x - r} ${f.y + r - 1} Z`, fill: s.color }, g);
      } else if (s.shape === "diamond") {
        el("path", { d: `M ${f.x} ${f.y - r - 1} L ${f.x + r + 1} ${f.y} L ${f.x} ${f.y + r + 1} L ${f.x - r - 1} ${f.y} Z`, fill: "none", stroke: s.color, "stroke-width": 1.4 }, g);
      } else if (s.shape === "square") {
        el("rect", { x: f.x - r, y: f.y - r, width: r * 2, height: r * 2, fill: s.color }, g);
      } else {
        el("circle", { cx: f.x, cy: f.y, r, fill: "none", stroke: s.color, "stroke-width": 1.5 }, g);
      }
      const tip = el("title", {}, g);
      tip.textContent = `${f.t} · ${f.e} ft · q ${f.q} · ${(f.dT / this.park.pxPerMile).toFixed(2)} mi to trail`;
    }
    // legend (only the feature types actually present)
    const present = new Set(features.map((f) => f.t));
    const rows = [
      ["hill", "hilltop"], ["saddle", "saddle"], ["reentrant", "reentrant axis"],
      ["spur", "spur axis"], ["streambend", "stream bend"], ["streamjct", "stream junction"],
    ].filter(([t]) => present.has(t));
    const lgH = rows.length * 17 + 10;
    const lg = el("g", { transform: `translate(${this.W - 168}, ${this.H - lgH - 12})` }, this.gFeatures);
    el("rect", { x: 0, y: 0, width: 156, height: lgH, fill: "#fbfbf7", opacity: 0.92, stroke: "#999", "stroke-width": 0.7, rx: 3 }, lg);
    rows.forEach(([t, label], i) => {
      const y = 17 + i * 17;
      const s = STYLE[t];
      if (s.shape === "axis") el("path", { d: `M 8 ${y} L 20 ${y}`, stroke: s.color, "stroke-width": 2.5, "stroke-linecap": "round" }, lg);
      else if (s.shape === "triangle") el("path", { d: `M 14 ${y - 4} L 18 ${y + 3} L 10 ${y + 3} Z`, fill: s.color }, lg);
      else if (s.shape === "diamond") el("path", { d: `M 14 ${y - 4} L 18 ${y} L 14 ${y + 4} L 10 ${y} Z`, fill: "none", stroke: s.color, "stroke-width": 1.4 }, lg);
      else if (s.shape === "square") el("rect", { x: 11, y: y - 3, width: 6, height: 6, fill: s.color }, lg);
      else el("circle", { cx: 14, cy: y, r: 3, fill: "none", stroke: s.color, "stroke-width": 1.5 }, lg);
      const t2 = el("text", { x: 26, y: y + 3.5, class: "scale-text" }, lg);
      t2.textContent = label;
    });
  }

  hideFeatures() {
    if (this.gFeatures) { this.gFeatures.remove(); this.gFeatures = null; }
  }

  /* ---- course overlay (orienteering purple) ---- */

  clearCourse() { this.gCourse.innerHTML = ""; }

  /**
   * Draw start triangle at `startPt`, control circles at `controls`
   * ({x, y, found}), double circle at `finishNode`, connected by straight
   * purple legs (orienteering convention). `homePts`, if given, is the
   * eventual walk back to the car: a faint dashed polyline.
   */
  drawCourse(startPt, controls, finishNode, homePts) {
    this.clearCourse();
    const P = COLORS.course;
    if (homePts && homePts.length > 3) {
      el("path", {
        d: flatPath(homePts), fill: "none", stroke: P, "stroke-width": 2,
        "stroke-dasharray": "2 8", "stroke-linecap": "round", opacity: 0.5,
      }, this.gCourse);
    }
    const pts = [startPt, ...controls, { x: finishNode.x, y: finishNode.y }];
    for (let i = 0; i + 1 < pts.length; i++) {
      el("line", {
        x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y,
        stroke: P, "stroke-width": 2.4, opacity: 0.75,
      }, this.gCourse);
    }
    // start triangle
    const s = 15;
    el("path", {
      d: `M ${startPt.x} ${startPt.y - s} L ${startPt.x + s * 0.87} ${startPt.y + s / 2} L ${startPt.x - s * 0.87} ${startPt.y + s / 2} Z`,
      fill: "none", stroke: P, "stroke-width": 3,
    }, this.gCourse);
    // controls
    controls.forEach((c, i) => {
      el("circle", { cx: c.x, cy: c.y, r: 16, fill: "none", stroke: P, "stroke-width": 3, opacity: c.found ? 0.45 : 1 }, this.gCourse);
      const t = el("text", { x: c.x + 20, y: c.y - 13, class: "control-num" }, this.gCourse);
      t.textContent = c.found ? `${i + 1} ✓` : `${i + 1}`;
      if (c.found) {
        el("path", { d: `M ${c.x - 8} ${c.y} L ${c.x - 2} ${c.y + 7} L ${c.x + 9} ${c.y - 8}`, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
      }
    });
    // finish: double circle
    el("circle", { cx: finishNode.x, cy: finishNode.y, r: 13, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
    el("circle", { cx: finishNode.x, cy: finishNode.y, r: 19, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
  }

  /* Faint preview of a candidate route, following real trail geometry. */
  previewRoute(routePts) {
    this.clearCourse();
    if (!routePts || routePts.length < 4) return;
    el("path", {
      d: flatPath(routePts), fill: "none",
      stroke: COLORS.course, "stroke-width": 5, opacity: 0.3, "stroke-linecap": "round",
    }, this.gCourse);
  }

  /* ---- live position ---- */

  setYou(pt, visible) {
    if (!pt) { this.youDot.setAttribute("visibility", "hidden"); return; }
    this.youDot.setAttribute("transform", `translate(${pt.x},${pt.y})`);
    this.youDot.setAttribute("visibility", visible ? "visible" : "hidden");
  }

  /* ---- pan / zoom / tap ---- */

  _applyView() {
    const v = this.view;
    this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    this._updateTiles();
  }

  _clientToMap(cx, cy) {
    const r = this.svg.getBoundingClientRect();
    const v = this.view;
    return {
      x: v.x + ((cx - r.left) / r.width) * v.w,
      y: v.y + ((cy - r.top) / r.height) * v.h,
    };
  }

  _wireGestures() {
    const svg = this.svg;
    const pointers = new Map();
    let moved = false, lastPinch = null;

    svg.addEventListener("pointerdown", (ev) => {
      svg.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      moved = false;
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const prev = pointers.get(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const r = svg.getBoundingClientRect();
      if (pointers.size === 1) {
        const dx = (ev.clientX - prev.x) * (this.view.w / r.width);
        const dy = (ev.clientY - prev.y) * (this.view.h / r.height);
        if (Math.abs(ev.clientX - prev.x) + Math.abs(ev.clientY - prev.y) > 1) moved = true;
        this.view.x -= dx; this.view.y -= dy;
        this._applyView();
      } else if (pointers.size === 2) {
        moved = true;
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (lastPinch) this._zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, lastPinch / d);
        lastPinch = d;
      }
    });
    const up = (ev) => {
      if (pointers.size === 1 && !moved && this.onTap) {
        this.onTap(this._clientToMap(ev.clientX, ev.clientY));
      }
      pointers.delete(ev.pointerId);
      lastPinch = null;
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", (ev) => { pointers.delete(ev.pointerId); lastPinch = null; });
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this._zoomAt(ev.clientX, ev.clientY, ev.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });
  }

  _zoomAt(cx, cy, factor) {
    const v = this.view;
    const pt = this._clientToMap(cx, cy);
    // cap zoom where the deepest tile level is still sharp (~2.6x native)
    const clientW = this.svg.getBoundingClientRect().width || 800;
    const deepest = this.park.tiles.levels[this.park.tiles.levels.length - 1];
    const minW = Math.max(60, clientW / (2.6 * this._tileDensity(deepest)));
    const nw = Math.min(this.W * 1.4, Math.max(minW, v.w * factor));
    const nh = nw * (this.H / this.W);
    v.x = pt.x - ((pt.x - v.x) / v.w) * nw;
    v.y = pt.y - ((pt.y - v.y) / v.h) * nh;
    v.w = nw; v.h = nh;
    this._applyView();
  }

  resetView() {
    this.view = { x: 0, y: 0, w: this.W, h: this.H };
    this._applyView();
  }
}
