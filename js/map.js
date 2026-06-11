/* Sidetrack — hand-drawn orienteering map renderer (SVG). */

const MAP_W = 1000, MAP_H = 620;
const SVGNS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/* Closed blob path through points using quadratic midpoint smoothing. */
function blobPath(pts) {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (i === 0) d += `M ${mx} ${my} `;
    else d += `Q ${x1} ${y1} ${mx} ${my} `;
  }
  const [x1, y1] = pts[0];
  const [xl, yl] = pts[n - 1];
  d += `Q ${xl} ${yl} ${(xl + x1) / 2} ${(yl + y1) / 2} Z`;
  return d;
}

/* Open smoothed path for creeks / trails. */
function wavyPath(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]} `;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my} `;
  }
  const last = pts[pts.length - 1];
  d += `L ${last[0]} ${last[1]}`;
  return d;
}

/* Deterministic wobbly ellipse for contour rings. */
function contourPath(cx, cy, rx, ry, rot, seed) {
  const pts = [];
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wob = 1 + 0.07 * Math.sin(a * 3 + seed) + 0.05 * Math.sin(a * 5 + seed * 2);
    const x0 = Math.cos(a) * rx * wob;
    const y0 = Math.sin(a) * ry * wob;
    const cr = Math.cos((rot * Math.PI) / 180), sr = Math.sin((rot * Math.PI) / 180);
    pts.push([cx + x0 * cr - y0 * sr, cy + x0 * sr + y0 * cr]);
  }
  return blobPath(pts);
}

class ParkMap {
  constructor(svg, park) {
    this.svg = svg;
    this.park = park;
    this.view = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    this.onTap = null;
    this._build();
    this._wireGestures();
  }

  _build() {
    const svg = this.svg;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${MAP_W} ${MAP_H}`);

    const defs = el("defs", {}, svg);
    // hand-drawn wobble filters
    for (const [id, scale] of [["rough", 3.5], ["roughStrong", 7]]) {
      const f = el("filter", { id, x: "-10%", y: "-10%", width: "120%", height: "120%" }, defs);
      el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.015", numOctaves: 3, seed: 7, result: "n" }, f);
      el("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale, xChannelSelector: "R", yChannelSelector: "G" }, f);
    }
    // paper grain
    const fp = el("filter", { id: "paper", x: "0", y: "0", width: "100%", height: "100%" }, defs);
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.9", numOctaves: 2, seed: 3, result: "n" }, fp);
    el("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.28  0 0 0 0.06 0" }, fp);
    el("feComposite", { operator: "over", in2: "SourceGraphic" }, fp);

    // layers
    this.gPaper = el("g", {}, svg);
    this.gTerrain = el("g", { filter: "url(#roughStrong)" }, svg);
    this.gWater = el("g", { filter: "url(#rough)" }, svg);
    this.gTrails = el("g", { filter: "url(#rough)" }, svg);
    this.gLabels = el("g", { class: "map-labels" }, svg);
    this.gCourse = el("g", { filter: "url(#rough)", class: "course" }, svg);
    this.gLive = el("g", {}, svg);

    // paper
    el("rect", { x: 0, y: 0, width: MAP_W, height: MAP_H, fill: "#f6efdc" }, this.gPaper);
    el("rect", { x: 0, y: 0, width: MAP_W, height: MAP_H, fill: "#f6efdc", filter: "url(#paper)" }, this.gPaper);
    el("rect", { x: 6, y: 6, width: MAP_W - 12, height: MAP_H - 12, fill: "none", stroke: "#7a5c3e", "stroke-width": 2.5, filter: "url(#rough)" }, this.gPaper);

    this._drawTerrain();
    this._drawTrails();
    this._drawLabels();

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
    // vegetation / open areas
    const VEG_FILL = { green: "#b7d9a8", yellow: "#f5d27a", white: "#ffffff" };
    for (const v of p.veg) {
      el("path", { d: blobPath(v.pts), fill: VEG_FILL[v.fill], opacity: v.fill === "white" ? 0.5 : 0.55 }, this.gTerrain);
    }
    // contours
    p.ridges.forEach((r, ri) => {
      for (let i = 0; i < r.rings; i++) {
        const k = 1 - i / (r.rings + 0.5);
        el("path", {
          d: contourPath(r.cx, r.cy, r.rx * k, r.ry * k, r.rot, ri * 3 + i),
          fill: "none", stroke: "#c07a3a",
          "stroke-width": i === Math.floor(r.rings / 2) ? 2.2 : 1.1,
          opacity: 0.85,
        }, this.gTerrain);
      }
    });
    // water
    for (const w of p.water) {
      if (w.type === "lake") {
        el("path", { d: blobPath(w.pts), fill: "#9fd2e8", stroke: "#3d87ad", "stroke-width": 1.6 }, this.gWater);
      } else {
        el("path", { d: wavyPath(w.pts), fill: "none", stroke: "#3d87ad", "stroke-width": 2, "stroke-linecap": "round" }, this.gWater);
      }
    }
    // north arrow (a map convention, not a compass — promise)
    const na = el("g", { transform: `translate(${MAP_W - 52}, 56)` }, this.gTerrain);
    el("path", { d: "M 0 18 L 0 -16 M -7 -6 L 0 -16 L 7 -6", fill: "none", stroke: "#7a5c3e", "stroke-width": 2.4, "stroke-linecap": "round" }, na);
    const nt = el("text", { x: 0, y: 34, "text-anchor": "middle", class: "north-n" }, na);
    nt.textContent = "N";
  }

  _drawTrails() {
    const p = this.park;
    for (const e of p.edges) {
      const a = p.nodes[e.a], b = p.nodes[e.b];
      // slight bow so parallel-ish trails don't look ruler-drawn
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      const dash = e.nav >= 3 ? "3 7" : e.nav === 2 ? "7 6" : "12 5";
      el("path", {
        d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`,
        fill: "none", stroke: "#2b2b2b", "stroke-width": e.nav >= 3 ? 1.6 : 2.2,
        "stroke-dasharray": dash, "stroke-linecap": "round",
        class: "trail-edge",
      }, this.gTrails);
    }
    // junction ticks + parking
    for (const [id, n] of Object.entries(p.nodes)) {
      if (n.parking) {
        const g = el("g", { transform: `translate(${n.x},${n.y})` }, this.gTrails);
        el("rect", { x: -11, y: -11, width: 22, height: 22, rx: 4, fill: "#f6efdc", stroke: "#2b2b2b", "stroke-width": 2 }, g);
        const t = el("text", { "text-anchor": "middle", y: 6, class: "parking-p" }, g);
        t.textContent = "P";
      } else {
        el("circle", { cx: n.x, cy: n.y, r: 2.6, fill: "#2b2b2b" }, this.gTrails);
      }
    }
  }

  _drawLabels() {
    for (const l of this.park.labels) {
      const t = el("text", {
        x: l.x, y: l.y, transform: `rotate(${l.rot} ${l.x} ${l.y})`,
        class: "trail-label", "text-anchor": "middle",
      }, this.gLabels);
      t.textContent = l.text;
    }
    const title = el("text", { x: 26, y: 44, class: "map-title" }, this.gLabels);
    title.textContent = this.park.name;
    const sub = el("text", { x: 26, y: 66, class: "map-sub" }, this.gLabels);
    sub.textContent = this.park.tagline;
  }

  /* ---- course overlay (orienteering purple) ---- */

  clearCourse() { this.gCourse.innerHTML = ""; }

  /**
   * Draw start triangle at `startPt`, control circles at `controls`
   * ({x, y, found}), double circle at `finishNode` (a trail node — not
   * necessarily the car), connected by purple legs. `homePts`, if given,
   * is the eventual walk back to the car, drawn as a faint dashed leg so
   * the way home is always on the map without being part of the course.
   */
  drawCourse(startPt, controls, finishNode, homePts) {
    this.clearCourse();
    const P = "#a626a6";
    if (homePts && homePts.length > 1) {
      el("path", {
        d: wavyPath(homePts.map(p => [p.x, p.y])),
        fill: "none", stroke: P, "stroke-width": 2,
        "stroke-dasharray": "2 8", "stroke-linecap": "round", opacity: 0.45,
      }, this.gCourse);
    }
    const pts = [startPt, ...controls, { x: finishNode.x, y: finishNode.y }];
    // legs (gapped at the symbols just by drawing under thin symbols — fine at this style)
    for (let i = 0; i + 1 < pts.length; i++) {
      el("line", {
        x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y,
        stroke: P, "stroke-width": 2.4, opacity: 0.75,
      }, this.gCourse);
    }
    // start triangle
    const s = 16;
    el("path", {
      d: `M ${startPt.x} ${startPt.y - s} L ${startPt.x + s * 0.87} ${startPt.y + s / 2} L ${startPt.x - s * 0.87} ${startPt.y + s / 2} Z`,
      fill: "none", stroke: P, "stroke-width": 3,
    }, this.gCourse);
    // controls
    controls.forEach((c, i) => {
      el("circle", { cx: c.x, cy: c.y, r: 17, fill: "none", stroke: P, "stroke-width": 3, opacity: c.found ? 0.45 : 1 }, this.gCourse);
      const t = el("text", { x: c.x + 22, y: c.y - 14, class: "control-num" }, this.gCourse);
      t.textContent = c.found ? `${i + 1} ✓` : `${i + 1}`;
      if (c.found) {
        el("path", { d: `M ${c.x - 8} ${c.y} L ${c.x - 2} ${c.y + 7} L ${c.x + 9} ${c.y - 8}`, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
      }
    });
    // finish: double circle
    el("circle", { cx: finishNode.x, cy: finishNode.y, r: 14, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
    el("circle", { cx: finishNode.x, cy: finishNode.y, r: 20, fill: "none", stroke: P, "stroke-width": 3 }, this.gCourse);
  }

  /* Faint preview of a candidate route (when browsing cards). */
  previewRoute(ids) {
    this.clearCourse();
    const p = this.park;
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = p.nodes[ids[i]], b = p.nodes[ids[i + 1]];
      el("line", {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: "#a626a6", "stroke-width": 5, opacity: 0.28, "stroke-linecap": "round",
      }, this.gCourse);
    }
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
    const nw = Math.min(MAP_W * 1.4, Math.max(180, v.w * factor));
    const nh = nw * (MAP_H / MAP_W);
    v.x = pt.x - ((pt.x - v.x) / v.w) * nw;
    v.y = pt.y - ((pt.y - v.y) / v.h) * nh;
    v.w = nw; v.h = nh;
    this._applyView();
  }

  resetView() {
    this.view = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    this._applyView();
  }
}
