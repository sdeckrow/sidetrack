/* Sidetrack — orienteering map renderer (SVG).
 *
 * Draws real survey data (OSM trails/water, USGS contours) in ISOM-ish
 * orienteering colors: white runnable forest, yellow open land, brown
 * contours, blue water, black paths, purple course overlay.
 */

const SVGNS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/* flat [x1,y1,x2,y2,…] → SVG path d */
function flatPath(pts, close = false) {
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
  return close ? d + " Z" : d;
}

const COLORS = {
  paper: "#fffdf6",
  contour: "#c4824d",
  contourIndex: "#a96b38",
  water: "#aadcf0",
  waterEdge: "#3d87ad",
  stream: "#3d87ad",
  openLand: "#ffe896",
  scrub: "#b7d9a8",
  roadMajor: "#444444",
  roadMinor: "#8d8d8d",
  trail: "#1a1a1a",
  boundary: "#7a4dbf",
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
    this.gVeg = el("g", {}, svg);
    this.gContours = el("g", {}, svg);
    this.gWater = el("g", {}, svg);
    this.gRoads = el("g", {}, svg);
    this.gTrails = el("g", {}, svg);
    this.gBoundary = el("g", {}, svg);
    this.gLabels = el("g", { class: "map-labels" }, svg);
    this.gCourse = el("g", { class: "course" }, svg);
    this.gLive = el("g", {}, svg);

    el("rect", { x: 0, y: 0, width: W, height: H, fill: COLORS.paper }, this.gPaper);

    this._drawTerrain();
    this._drawTrails();
    this._drawBoundary();
    this._drawLabels();
    this._drawFurniture();

    // "you" marker (hidden until positioned)
    this.youDot = el("g", { class: "you", visibility: "hidden" }, this.gLive);
    el("circle", { r: 14, class: "you-pulse" }, this.youDot);
    el("circle", { r: 6, class: "you-core" }, this.youDot);
    // car marker
    this.carMark = el("text", { class: "car-mark", visibility: "hidden", "text-anchor": "middle" }, this.gLive);
    this.carMark.textContent = "🚗";
  }

  _drawTerrain() {
    const p = this.park;
    // open land / scrub
    for (const v of p.veg) {
      el("path", {
        d: flatPath(v.pts, true),
        fill: v.fill === "green" ? COLORS.scrub : COLORS.openLand,
        opacity: 0.8,
      }, this.gVeg);
    }
    // real contours from USGS elevation
    for (const c of p.contours.minor) {
      el("path", { d: flatPath(c), fill: "none", stroke: COLORS.contour, "stroke-width": 0.7, opacity: 0.9 }, this.gContours);
    }
    for (const c of p.contours.index) {
      el("path", { d: flatPath(c), fill: "none", stroke: COLORS.contourIndex, "stroke-width": 1.5, opacity: 0.95 }, this.gContours);
    }
    // lakes & streams
    for (const w of p.water) {
      el("path", { d: flatPath(w.pts, true), fill: COLORS.water, stroke: COLORS.waterEdge, "stroke-width": 1.2 }, this.gWater);
    }
    for (const s of p.streams) {
      el("path", { d: flatPath(s), fill: "none", stroke: COLORS.stream, "stroke-width": 1.4, "stroke-linecap": "round" }, this.gWater);
    }
    for (const d of p.dams) {
      el("path", { d: flatPath(d), fill: "none", stroke: "#222", "stroke-width": 2.4, "stroke-linecap": "round" }, this.gWater);
    }
    // roads for context
    for (const r of p.roads) {
      el("path", {
        d: flatPath(r.pts), fill: "none",
        stroke: r.kind === "major" ? COLORS.roadMajor : COLORS.roadMinor,
        "stroke-width": r.kind === "major" ? 2.6 : 1.3,
      }, this.gRoads);
    }
    // parking lots
    for (const lot of this.park.parkingLots) {
      el("path", { d: flatPath(lot.pts, true), fill: "#d9d4c8", stroke: "#9b958a", "stroke-width": 0.8 }, this.gRoads);
    }
  }

  _drawTrails() {
    const p = this.park;
    for (const e of p.edges) {
      // ISOM-style: solid for tracks, dashes shorten as the path gets fainter
      const dash = e.nav >= 3 ? "3 5" : e.nav === 2 ? "8 4" : null;
      const attrs = {
        d: flatPath(e.pts), fill: "none",
        stroke: COLORS.trail, "stroke-width": e.nav >= 3 ? 1.3 : 1.8,
        "stroke-linecap": "round", class: "trail-edge",
      };
      if (dash) attrs["stroke-dasharray"] = dash;
      el("path", attrs, this.gTrails);
    }
    // junction dots + parking squares
    for (const [, n] of Object.entries(p.nodes)) {
      if (n.parking) {
        const g = el("g", { transform: `translate(${n.x},${n.y})` }, this.gTrails);
        el("rect", { x: -10, y: -10, width: 20, height: 20, rx: 3, fill: "#fff", stroke: "#1a1a1a", "stroke-width": 1.8 }, g);
        const t = el("text", { "text-anchor": "middle", y: 5.5, class: "parking-p" }, g);
        t.textContent = "P";
      } else {
        el("circle", { cx: n.x, cy: n.y, r: 1.7, fill: COLORS.trail, opacity: 0.85 }, this.gTrails);
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
      stroke: COLORS.boundary, "stroke-width": 1.6, "stroke-dasharray": "10 4 2 4", opacity: 0.8,
    }, this.gBoundary);
  }

  _drawLabels() {
    for (const l of this.park.labels) {
      const t = el("text", {
        x: l.x, y: l.y - 4, transform: `rotate(${l.rot} ${l.x} ${l.y})`,
        class: "trail-label", "text-anchor": "middle",
      }, this.gLabels);
      t.textContent = l.text;
    }
    for (const l of this.park.lakeLabels || []) {
      const t = el("text", { x: l.x, y: l.y, class: "lake-label", "text-anchor": "middle" }, this.gLabels);
      t.textContent = l.text;
    }
    const title = el("text", { x: 22, y: 38, class: "map-title" }, this.gLabels);
    title.textContent = this.park.name;
    const sub = el("text", { x: 22, y: 58, class: "map-sub" }, this.gLabels);
    sub.textContent = this.park.tagline;
  }

  _drawFurniture() {
    const { W, H } = this;
    // north arrow
    const na = el("g", { transform: `translate(${W - 42}, 52)` }, this.gLabels);
    el("path", { d: "M 0 18 L 0 -16 M -7 -6 L 0 -16 L 7 -6", fill: "none", stroke: "#333", "stroke-width": 2.2, "stroke-linecap": "round" }, na);
    const nt = el("text", { x: 0, y: 34, "text-anchor": "middle", class: "north-n" }, na);
    nt.textContent = "N";
    // scale bar: one real mile, quarter ticks
    const mi = this.park.pxPerMile;
    const sb = el("g", { transform: `translate(22, ${H - 26})`, class: "scale-bar" }, this.gLabels);
    el("rect", { x: -8, y: -14, width: mi + 60, height: 30, fill: "#fffdf6", opacity: 0.75, rx: 4 }, sb);
    el("path", { d: `M 0 0 H ${mi}`, stroke: "#333", "stroke-width": 2 }, sb);
    for (let q = 0; q <= 4; q++) {
      el("path", { d: `M ${(mi * q) / 4} -5 V 5`, stroke: "#333", "stroke-width": q % 4 === 0 ? 2 : 1.2 }, sb);
    }
    const st = el("text", { x: mi + 8, y: 4, class: "scale-text" }, sb);
    st.textContent = "1 mile";
    const ct = el("text", { x: 0, y: -18, class: "scale-text" }, sb);
    ct.textContent = `contours ${this.park.contourInterval} ft`;
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

  setCar(node) {
    if (!node) { this.carMark.setAttribute("visibility", "hidden"); return; }
    this.carMark.setAttribute("x", node.x);
    this.carMark.setAttribute("y", node.y - 16);
    this.carMark.setAttribute("visibility", "visible");
  }

  /* ---- pan / zoom / tap ---- */

  _applyView() {
    const v = this.view;
    this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
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
    const nw = Math.min(this.W * 1.4, Math.max(120, v.w * factor));
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
