/* Sidetrack — UI glue: state, tracking, suggestions, adventures, history. */

const $ = (sel) => document.querySelector(sel);
const STORE_PREFS = "sidetrack.prefs";
const STORE_HISTORY = "sidetrack.history";

const state = {
  park: null,
  adj: null,
  map: null,
  carId: null,           // node id where the car is
  pos: null,             // {x, y} map coords
  recentNodes: [],       // node ids passed, most recent last
  mode: "demo",          // "demo" | "gps"
  gpsWatchId: null,
  walking: null,         // demo walk animation state
  adventure: null,       // active adventure
  candidates: [],        // last suggestions shown
  prefs: loadJSON(STORE_PREFS) || emptyPrefs(),
  history: loadJSON(STORE_HISTORY) || [],
  showYou: true,         // hidden during adventures unless spoiler toggled
};

function loadJSON(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
function save() {
  localStorage.setItem(STORE_PREFS, JSON.stringify(state.prefs));
  localStorage.setItem(STORE_HISTORY, JSON.stringify(state.history));
}

/* ---------------- park / setup ---------------- */

function pickPark(parkId) {
  stopWalking();
  stopGps();
  state.park = PARKS[parkId];
  state.adj = buildAdj(state.park);
  state.carId = null;
  state.pos = null;
  state.recentNodes = [];
  state.adventure = null;
  state.candidates = [];
  state.map = new ParkMap($("#map"), state.park);
  state.map.onTap = onMapTap;
  // debug: ?features shows detected terrain features (course-gen candidates)
  const params = new URLSearchParams(location.search);
  if (params.has("features")) {
    state.map.showFeatures(state.park.features || []);
  }
  // debug: ?view=x,y,w jumps to a map view (for screenshot testing)
  if (params.has("view")) {
    const [x, y, w] = params.get("view").split(",").map(Number);
    if (w > 0) {
      state.map.view = { x, y, w, h: w * (state.map.H / state.map.W) };
      state.map._applyView();
    }
  }
  $("#park-select").value = parkId;
  renderPanel();
  setBanner(`Welcome to ${state.park.name}. Tap the trailhead where you parked to begin.`);
}

function onMapTap(pt) {
  const park = state.park;
  if (!state.carId) {
    // first tap: choose parking
    const nid = nearestNode(park, pt.x, pt.y);
    const n = park.nodes[nid];
    let parkNode = nid;
    if (!n.parking) {
      // snap to closest parking node
      let best = null, bestD = Infinity;
      for (const [id, nn] of Object.entries(park.nodes)) {
        if (!nn.parking) continue;
        const d = Math.hypot(nn.x - pt.x, nn.y - pt.y);
        if (d < bestD) { bestD = d; best = id; }
      }
      parkNode = best;
    }
    setCar(parkNode);
    return;
  }
  if (state.mode === "demo") walkTo(pt);
}

function setCar(nodeId) {
  const park = state.park;
  state.carId = nodeId;
  state.pos = { x: park.nodes[nodeId].x, y: park.nodes[nodeId].y };
  state.recentNodes = [nodeId];
  updateYou();
  renderPanel();
  setBanner(`Car parked at ${park.nodes[nodeId].name}. ${state.mode === "demo" ? "Tap anywhere on a trail to start walking (demo)." : "Start hiking — I'm watching the trail."}`);
}

/* ---------------- movement: demo walking ---------------- */

function walkTo(pt) {
  const park = state.park, adj = state.adj;
  const snapped = snapToTrail(park, pt.x, pt.y);
  const targetNode = nearestNode(park, snapped.x, snapped.y);
  const hereNode = nearestNode(park, state.pos.x, state.pos.y);
  const d = dijkstra(park, adj, hereNode);
  const ids = pathFrom(d.prev, hereNode, targetNode);
  if (!ids) return;
  // follow the real trail geometry, flagging graph nodes as we pass them
  const waypoints = [{ x: state.pos.x, y: state.pos.y, node: null }];
  waypoints.push({ x: park.nodes[ids[0]].x, y: park.nodes[ids[0]].y, node: ids[0] });
  for (let i = 0; i + 1 < ids.length; i++) {
    const pts = routePts(park, adj, [ids[i], ids[i + 1]]);
    for (let j = 2; j < pts.length - 2; j += 2) waypoints.push({ x: pts[j], y: pts[j + 1], node: null });
    waypoints.push({ x: park.nodes[ids[i + 1]].x, y: park.nodes[ids[i + 1]].y, node: ids[i + 1] });
  }
  startWalking(waypoints);
}

function startWalking(waypoints) {
  stopWalking();
  const speedPx = state.park.pxPerMile * 3 * 250 / 3600; // 3 mph at 250x demo time
  state.walking = { waypoints, seg: 0, t: 0, speedPx, last: performance.now() };
  state.walking.raf = requestAnimationFrame(stepWalk);
}

function stopWalking() {
  if (state.walking?.raf) cancelAnimationFrame(state.walking.raf);
  state.walking = null;
}

function stepWalk(now) {
  const w = state.walking;
  if (!w) return;
  let dt = Math.min(0.1, (now - w.last) / 1000);
  w.last = now;
  let dist = w.speedPx * dt;
  while (dist > 0 && w.seg < w.waypoints.length - 1) {
    const a = w.waypoints[w.seg], b = w.waypoints[w.seg + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const remain = (1 - w.t) * segLen;
    if (dist >= remain) {
      dist -= remain;
      w.seg++; w.t = 0;
      if (b.node) passNode(b.node);
    } else {
      w.t += dist / segLen;
      dist = 0;
    }
  }
  const a = w.waypoints[w.seg];
  const b = w.waypoints[Math.min(w.seg + 1, w.waypoints.length - 1)];
  state.pos = { x: a.x + (b.x - a.x) * w.t, y: a.y + (b.y - a.y) * w.t };
  updateYou();
  checkArrivals();
  if (w.seg >= w.waypoints.length - 1) {
    stopWalking();
  } else {
    w.raf = requestAnimationFrame(stepWalk);
  }
}

/* ---------------- movement: GPS ---------------- */

function startGps() {
  if (!navigator.geolocation) {
    setBanner("No geolocation available on this device — staying in demo mode.");
    $("#mode-toggle").checked = false;
    return;
  }
  state.mode = "gps";
  stopWalking();
  state.gpsWatchId = navigator.geolocation.watchPosition(onGpsFix, (err) => {
    setBanner(`GPS error (${err.message}) — switch back to demo mode if you're not at the park.`);
  }, { enableHighAccuracy: true, maximumAge: 5000 });
}

function stopGps() {
  if (state.gpsWatchId != null) navigator.geolocation.clearWatch(state.gpsWatchId);
  state.gpsWatchId = null;
  state.mode = "demo";
}

function onGpsFix(fix) {
  if (!state.park) return;
  const m = geoToMap(state.park, fix.coords.latitude, fix.coords.longitude);
  if (!m.inside) {
    setBanner("Your GPS fix is outside this park's map. Wrong park selected, or try demo mode.");
    return;
  }
  state.pos = { x: m.x, y: m.y };
  const snapped = snapToTrail(state.park, m.x, m.y);
  const nearN = nearestNode(state.park, snapped.x, snapped.y);
  const n = state.park.nodes[nearN];
  if (Math.hypot(n.x - m.x, n.y - m.y) < 18) passNode(nearN);
  updateYou();
  checkArrivals();
}

/* ---------------- node passage, prediction ---------------- */

function passNode(id) {
  const r = state.recentNodes;
  if (r[r.length - 1] === id) return;
  r.push(id);
  if (r.length > 12) r.shift();
  if (!state.adventure) maybePredict();
}

function maybePredict() {
  const ahead = predictAhead(state.park, state.adj, state.recentNodes);
  if (!ahead.size) return;
  const upcoming = state.park.pois
    .filter(p => ahead.has(p.node) && !(state.prefs.visited[p.id]))
    .sort((a, b) => prefScore(state.prefs, b) - prefScore(state.prefs, a));
  if (upcoming.length) {
    const p = upcoming[0];
    setBanner(`Looks like you're heading toward ${state.park.nodes[p.node].name} — ${p.name} is out that way. Want an adventure?`, true);
  }
}

/* ---------------- easy courses & adventures ---------------- */

function controlCount() {
  return parseInt($("#controls-select").value, 10);
}

function suggestNow() {
  if (!state.park || !state.carId || !state.pos) {
    setBanner("Pick where you parked first — tap a P on the map.");
    return;
  }
  const want = controlCount();
  let n = want, r = easyCourses(state.park, state.pos, n);
  while (r.error && n > 1) {
    n--;
    r = easyCourses(state.park, state.pos, n);
  }
  if (r.error) {
    state.candidates = [];
    renderPanel();
    setBanner(r.error);
    return;
  }
  state.candidates = r.courses;
  renderPanel();
  setBanner(n < want
    ? `A ${want}-control course doesn't fit from right here — best the terrain offers is ${n}. Hike on a bit for more options.`
    : "Pick a course — every control is a reentrant, and every leg follows a line you can read: trail, stream, or the reentrant itself.");
}

function startAdventure(cand) {
  state.adventure = {
    cand,
    startedAt: Date.now(),
    found: 0,             // controls punched so far
    hintIndex: 0,
    distAtLastHint: null,
    finished: false,
  };
  state.showYou = false; // ranger mode: no live dot, that's the game
  drawAdventure();
  renderPanel();
  const n = cand.controls.length;
  setBanner(`Course set: ${n} control${n > 1 ? "s" : ""}, ~${cand.totalM} m. Start at the triangle, punch the circles in order, come out at the double circle on the trail. No dot, no compass — just you and the terrain.`);
}

function drawAdventure() {
  const a = state.adventure;
  const c = a.cand;
  state.map.drawCourse(
    c.startPt,
    c.controls.map((ctl, i) => ({ x: ctl.f.x, y: ctl.f.y, found: i < a.found })),
    c.finishPt,
  );
  updateYou();
}

/* the thing the hiker is currently navigating to */
function currentTarget() {
  const a = state.adventure;
  if (!a) return null;
  const c = a.cand;
  return a.found < c.controls.length ? c.controls[a.found].f : c.finishPt;
}

const PUNCH_MILES = 30 / 1609.34; // arrival radius at a control

/* distance from current position, in miles; target is a node id or the POI itself */
function distMilesTo(target) {
  const t = typeof target === "string" ? state.park.nodes[target] : target;
  return Math.hypot(t.x - state.pos.x, t.y - state.pos.y) / state.park.pxPerMile;
}

function checkArrivals() {
  const a = state.adventure;
  if (!a || a.finished) return;
  const c = a.cand;
  if (a.found < c.controls.length) {
    const ctl = c.controls[a.found].f;
    if (distMilesTo(ctl) < PUNCH_MILES) {
      a.found++;
      a.hintIndex = 0;
      a.distAtLastHint = null;
      drawAdventure();
      renderPanel();
      const label = FEATURE_LABEL[ctl.t](ctl);
      setBanner(a.found < c.controls.length
        ? `Control ${a.found} punched — ${label}. On to circle ${a.found + 1}.`
        : `Control ${a.found} punched — ${label}. Now out to the double circle: the trail is ~${c.finishLegM} m away.`, true);
    }
  } else if (distMilesTo(c.finishPt) < PUNCH_MILES) {
    a.finished = true;
    renderPanel();
    setBanner("Back on trail — course complete! How was it?", true);
  }
}

function giveHint() {
  const a = state.adventure;
  if (!a) return;
  const c = a.cand;
  const onFinish = a.found >= c.controls.length;
  const target = currentTarget();
  const dNow = distMilesTo(target);
  let text;
  if (onFinish) {
    text = dNow < 0.06 ? "The trail is close enough to smell. Keep going."
      : "The double circle sits on a trail. Pick the line back that feels inevitable.";
  } else {
    const f = c.controls[a.found].f;
    text = hintFor({ hints: [FEATURE_HINT[f.t]] }, a.hintIndex, dNow, a.distAtLastHint);
    a.hintIndex++;
  }
  a.distAtLastHint = dNow;
  $("#hint-text").textContent = text;
  $("#hint-box").classList.add("show");
}

function finishAdventure(rating) {
  const a = state.adventure;
  const c = a.cand;
  recordOutcome(state.prefs, { id: `easy-${c.controls.map(x => x.f.t).join("-")}`, tags: [] }, rating);
  state.history.unshift({
    date: new Date().toISOString().slice(0, 10),
    park: state.park.name,
    poi: `Easy course — ${c.controls.map(x => x.f.t).join(", ")}`,
    tags: [],
    miles: c.totalM / 1609.34,
    controls: c.controls.length,
    rating,
  });
  save();
  state.adventure = null;
  state.candidates = [];
  state.showYou = true;
  state.map.clearCourse();
  updateYou();
  renderPanel();
  setBanner("Logged it. Hit “Suggest sidetracks” from anywhere on a trail and run another.");
}

function abandonAdventure() {
  state.adventure = null;
  state.showYou = true;
  state.map.clearCourse();
  updateYou();
  renderPanel();
  setBanner("Course abandoned — no judgment. The map's still yours.");
}

/* ---------------- rendering ---------------- */

function updateYou() {
  if (!state.map) return;
  const visible = state.pos && (state.showYou || !state.adventure);
  state.map.setYou(state.pos, !!visible);
}

function setBanner(text, highlight = false) {
  const b = $("#banner");
  b.textContent = text;
  b.classList.toggle("highlight", highlight);
}

const NAV_STARS = (n) => "★".repeat(n) + "☆".repeat(3 - n);

function renderPanel() {
  const panel = $("#cards");
  panel.innerHTML = "";

  if (state.adventure) {
    renderAdventurePanel(panel);
    return;
  }

  if (!state.candidates.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = state.carId
      ? "Get on a trail and hit “Suggest sidetracks” — courses build from wherever you stand."
      : "Tap the map where you parked (the P squares) to get started.";
    panel.appendChild(p);
    return;
  }

  state.candidates.forEach((c, ci) => {
    const card = document.createElement("div");
    card.className = "card";
    const controlsHtml = c.controls
      .map((ctl, i) => `<li><b>${i + 1}.</b> ${FEATURE_LABEL[ctl.f.t](ctl.f)} <span class="muted">· ${ctl.legM} m leg</span></li>`)
      .join("");
    card.innerHTML = `
      <div class="card-head">
        <h3>Course ${"ABC"[ci]} — ${c.controls.length} control${c.controls.length > 1 ? "s" : ""} · ~${c.totalM} m</h3>
      </div>
      <ol class="control-list">${controlsHtml}</ol>
      <p class="finish-line">Comes out on a trail ${c.finishLegM} m past the last control. <span class="muted">Tap card to preview.</span></p>
      <div class="card-actions">
        <button class="btn primary go">Run it</button>
      </div>`;
    // tap anywhere on the card to preview the course on the map
    card.addEventListener("click", () => {
      panel.querySelectorAll(".card").forEach((el2) => el2.classList.remove("selected"));
      card.classList.add("selected");
      state.map.drawCourse(
        c.startPt,
        c.controls.map((ctl) => ({ x: ctl.f.x, y: ctl.f.y, found: false })),
        c.finishPt,
      );
    });
    card.querySelector(".go").addEventListener("click", (ev) => {
      ev.stopPropagation();
      startAdventure(c);
    });
    panel.appendChild(card);
  });
}

function renderAdventurePanel(panel) {
  const a = state.adventure;
  const card = document.createElement("div");
  card.className = "card active-adventure";

  const c = a.cand;
  const n = c.controls.length;
  if (a.finished) {
    card.innerHTML = `
      <h3>Course complete 🏁</h3>
      <p class="blurb">${n} control${n > 1 ? "s" : ""}, ~${c.totalM} m, all punched. Rate it so I learn:</p>
      <div class="card-actions rate">
        <button class="btn rate-btn" data-r="2">🤩 Loved it</button>
        <button class="btn rate-btn" data-r="1">🙂 Good</button>
        <button class="btn rate-btn" data-r="-1">😐 Meh</button>
      </div>`;
    card.querySelectorAll(".rate-btn").forEach(b =>
      b.addEventListener("click", () => finishAdventure(parseInt(b.dataset.r, 10))));
  } else {
    const onFinish = a.found >= n;
    const next = onFinish ? null : c.controls[a.found].f;
    card.innerHTML = `
      <h3>${onFinish ? "Last leg — out to the trail" : `Control ${a.found + 1} of ${n}`}</h3>
      <p class="blurb">${onFinish
        ? `All controls punched. Navigate to the double circle — a trail ~${c.finishLegM} m away.`
        : `<b>${FEATURE_LABEL[next.t](next)}</b> — about ${c.controls[a.found].legM} m along your handrail. Your position is hidden; that's the fun part.`}</p>
      <div class="badges">
        <span class="chip">${a.found}/${n} punched</span>
        <span class="chip">~${c.totalM} m course</span>
      </div>
      <div class="card-actions">
        <button class="btn primary hint">Give me a hint</button>
        <button class="btn ghost spoiler">${state.showYou ? "Hide me" : "Show me (spoiler)"}</button>
        <button class="btn ghost abandon">Abandon</button>
        ${state.mode === "demo" ? `<button class="btn ghost found-demo">${onFinish ? "I'm at the finish" : "I found it"}</button>` : ""}
      </div>`;
    card.querySelector(".hint").addEventListener("click", giveHint);
    card.querySelector(".spoiler").addEventListener("click", () => {
      state.showYou = !state.showYou;
      updateYou();
      renderPanel();
    });
    card.querySelector(".abandon").addEventListener("click", abandonAdventure);
    const fd = card.querySelector(".found-demo");
    if (fd) fd.addEventListener("click", () => {
      // demo shortcut: declare arrival (honor system, like real orienteering)
      const target = currentTarget();
      if (distMilesTo(target) < 0.12) {
        state.pos = { x: target.x, y: target.y };
        checkArrivals();
      } else {
        setBanner("Hmm — you don't seem close enough to punch that control. Keep looking.");
      }
    });
  }
  panel.appendChild(card);
}

function renderHistory() {
  const list = $("#history-list");
  list.innerHTML = "";
  const taste = topTastes(state.prefs, 4);
  $("#taste").innerHTML = taste.length
    ? "Your taste so far: " + taste.map(t => `<span class="chip way">${TAGS[t]}</span>`).join(" ")
    : "No taste profile yet — go find something.";
  if (!state.history.length) {
    list.innerHTML = '<p class="muted">No adventures logged yet.</p>';
    return;
  }
  for (const h of state.history) {
    const div = document.createElement("div");
    div.className = "card history-item";
    const face = h.rating === 2 ? "🤩" : h.rating === 1 ? "🙂" : "😐";
    div.innerHTML = `
      <div class="card-head"><h3>${h.poi}</h3><span>${face}</span></div>
      <p class="muted">${h.date} · ${h.park} · ${h.miles.toFixed(2)} mi${h.controls
        ? ` · ${h.controls} control${h.controls > 1 ? "s" : ""}`
        : h.cls ? ` · ${LEN_LABEL[h.cls.len]} / ${EFFORT_LABEL[h.cls.effort]} / Nav ${NAV_STARS(h.cls.nav)}` : ""}</p>`;
    list.appendChild(div);
  }
}

/* ---------------- tabs & boot ---------------- */

function showTab(name) {
  $("#tab-map").classList.toggle("on", name === "map");
  $("#tab-history").classList.toggle("on", name === "history");
  $("#view-map").style.display = name === "map" ? "" : "none";
  $("#view-history").style.display = name === "history" ? "" : "none";
  if (name === "history") renderHistory();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#park-select").addEventListener("change", (e) => pickPark(e.target.value));
  $("#suggest-btn").addEventListener("click", suggestNow);
  $("#reset-view").addEventListener("click", () => state.map?.resetView());
  $("#tab-map").addEventListener("click", () => showTab("map"));
  $("#tab-history").addEventListener("click", () => showTab("history"));
  $("#mode-toggle").addEventListener("change", (e) => {
    if (e.target.checked) startGps(); else stopGps();
    setBanner(e.target.checked ? "Live GPS mode — works on-site over HTTPS." : "Demo mode — tap trails to walk.");
  });
  $("#hint-close").addEventListener("click", () => $("#hint-box").classList.remove("show"));
  pickPark("redmountain");

  // debug: ?autotest drives a full course end-to-end (for headless checks)
  if (new URLSearchParams(location.search).has("autotest")) {
    setTimeout(() => {
      try {
        setCar(Object.entries(state.park.nodes).find(([, n]) => n.parking)[0]);
        const ids = Object.keys(state.park.nodes);
        const mid = state.park.nodes[ids[Math.floor(ids.length / 2)]];
        state.pos = { x: mid.x, y: mid.y };
        suggestNow();
        if (!state.candidates.length) { setBanner("AUTOTEST: no candidates"); return; }
        startAdventure(state.candidates[0]);
        const c = state.adventure.cand;
        for (const ctl of c.controls) {
          state.pos = { x: ctl.f.x, y: ctl.f.y };
          checkArrivals();
        }
        state.pos = { x: c.finishPt.x, y: c.finishPt.y };
        checkArrivals();
        setBanner((state.adventure.finished ? "AUTOTEST PASS — " : "AUTOTEST INCOMPLETE — ") + $("#banner").textContent);
      } catch (e) {
        setBanner("AUTOTEST FAIL: " + e.message);
      }
    }, 400);
  }
});
