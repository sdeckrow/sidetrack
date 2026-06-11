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
  state.map.setCar(park.nodes[nodeId]);
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
  const waypoints = [{ x: state.pos.x, y: state.pos.y, node: null }];
  for (const id of ids) waypoints.push({ x: park.nodes[id].x, y: park.nodes[id].y, node: id });
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

/* ---------------- suggestions & adventures ---------------- */

const PACE_MPH = 2; // unhurried hiking pace, poking-around time included

function budgetMiles() {
  return parseFloat($("#time-select").value) * PACE_MPH;
}

function suggestNow() {
  if (!state.park || !state.carId || !state.pos) {
    setBanner("Pick where you parked first — tap a P on the map.");
    return;
  }
  const hereNode = nearestNode(state.park, state.pos.x, state.pos.y);
  const ahead = predictAhead(state.park, state.adj, state.recentNodes);
  const budget = budgetMiles();
  state.candidates = suggest(state.park, state.adj, hereNode, state.carId, state.prefs, ahead, budget);
  state.overBudget = false;
  if (!state.candidates.length && isFinite(budget)) {
    // nothing fits the window — offer the closest overruns rather than nothing
    state.candidates = suggest(state.park, state.adj, hereNode, state.carId, state.prefs, ahead, budget * 1.6);
    state.overBudget = state.candidates.length > 0;
  }
  renderPanel();
  if (state.overBudget) {
    setBanner("Nothing quite fits that time window from here — these run a little over.");
  } else if (state.candidates.length) {
    setBanner("Each course ends back on a trail — the faint dashed line is your eventual walk to the car.");
  }
}

function startAdventure(cand) {
  state.adventure = {
    cand,
    startedAt: Date.now(),
    found: false,
    hintIndex: 0,
    distAtLastHint: null,
    finished: false,
  };
  state.showYou = false; // ranger mode: no live dot, that's the game
  drawAdventure();
  renderPanel();
  const finishName = state.park.nodes[cand.finishId].name;
  setBanner(cand.endsAtCar
    ? `Course set: find ${cand.poi.name}, then come out right at your car. No dot, no compass — just you and the map. Ask for hints if you need them.`
    : `Course set: find ${cand.poi.name}, then come out at ${finishName} — from there it's ${cand.homeMiles.toFixed(1)} mi back to the car whenever you're ready. Ask for hints if you need them.`);
}

function drawAdventure() {
  const a = state.adventure;
  const park = state.park;
  const poiNode = park.nodes[a.cand.poi.node];
  const start = { x: state.pos.x, y: state.pos.y };
  const homePts = a.cand.endsAtCar ? null : a.cand.homeIds.map(id => park.nodes[id]);
  state.map.drawCourse(
    start,
    [{ x: poiNode.x, y: poiNode.y, found: a.found }],
    park.nodes[a.cand.finishId],
    homePts,
  );
  updateYou();
}

function distMilesTo(nodeId) {
  const n = state.park.nodes[nodeId];
  return Math.hypot(n.x - state.pos.x, n.y - state.pos.y) / state.park.pxPerMile;
}

function checkArrivals() {
  const a = state.adventure;
  if (!a) return;
  if (!a.found && distMilesTo(a.cand.poi.node) < 0.05) {
    a.found = true;
    drawAdventure();
    renderPanel();
    const where = a.cand.endsAtCar ? "your car" : state.park.nodes[a.cand.finishId].name;
    setBanner(`Control found: ${a.cand.poi.name}! ${a.cand.poi.blurb} Now find your way out to ${where} — that's the double circle.`, true);
  } else if (a.found && !a.finished && distMilesTo(a.cand.finishId) < 0.05) {
    a.finished = true;
    renderPanel();
    setBanner(a.cand.endsAtCar
      ? "Out at your car — course complete! How was it?"
      : `Back on trail at ${state.park.nodes[a.cand.finishId].name} — course complete! Your car is ${a.cand.homeMiles.toFixed(1)} mi away along the dashed line, no rush. How was it?`, true);
  }
}

function giveHint() {
  const a = state.adventure;
  if (!a) return;
  const target = a.found ? a.cand.finishId : a.cand.poi.node;
  const dNow = distMilesTo(target);
  let text;
  if (a.found) {
    text = dNow < 0.1 ? "The finish is close enough to smell. Almost there."
      : "Work out which trail the double circle sits on, then find that trail. The finish hasn't moved; your confidence shouldn't either.";
  } else {
    text = hintFor(a.cand.poi, a.hintIndex, dNow, a.distAtLastHint);
    a.hintIndex++;
  }
  a.distAtLastHint = dNow;
  $("#hint-text").textContent = text;
  $("#hint-box").classList.add("show");
}

function finishAdventure(rating) {
  const a = state.adventure;
  recordOutcome(state.prefs, a.cand.poi, rating);
  state.history.unshift({
    date: new Date().toISOString().slice(0, 10),
    park: state.park.name,
    poi: a.cand.poi.name,
    tags: a.cand.poi.tags,
    miles: a.cand.stats.miles,
    cls: a.cand.cls,
    rating,
  });
  save();
  const cand = a.cand;
  state.adventure = null;
  state.candidates = [];
  state.showYou = true;
  state.map.clearCourse();
  if (!cand.endsAtCar) state.map.previewRoute(cand.homeIds); // leave the way home on the map
  updateYou();
  renderPanel();
  const taste = topTastes(state.prefs);
  const learned = taste.length
    ? `I'm noticing you like: ${taste.map(t => TAGS[t].toLowerCase()).join(", ")}. Next suggestions will lean that way.`
    : "A few more adventures and I'll start learning your taste.";
  setBanner(cand.endsAtCar
    ? `Logged it. ${learned}`
    : `Logged it — the highlighted route is your ${cand.homeMiles.toFixed(1)} mi walk back to the car. Or hit “Suggest adventures” and turn it into another one. ${learned}`);
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
      ? "Hike a little, or hit “Suggest adventures” when you're ready to wander."
      : "Tap the map where you parked (the P squares) to get started.";
    panel.appendChild(p);
    return;
  }

  for (const c of state.candidates) {
    const card = document.createElement("div");
    card.className = "card";
    const finishName = state.park.nodes[c.finishId].name;
    card.innerHTML = `
      <div class="card-head">
        <h3>${c.poi.name}</h3>
        ${c.onYourWay ? '<span class="chip way">on your way</span>' : ""}
      </div>
      <p class="blurb">${c.poi.blurb}</p>
      <p class="finish-line">${c.endsAtCar
        ? "Comes out right at your car."
        : `Comes out at <b>${finishName}</b> — then ${c.homeMiles.toFixed(1)} mi back to the car when you're ready.`}</p>
      <div class="badges">
        <span class="chip len-${c.cls.len}">${LEN_LABEL[c.cls.len]} · ${c.stats.miles.toFixed(1)} mi</span>
        <span class="chip eff-${c.cls.effort}">${EFFORT_LABEL[c.cls.effort]} · ${Math.round(c.stats.climb)} ft</span>
        <span class="chip nav">Nav ${NAV_STARS(c.cls.nav)}</span>
        ${c.poi.offTrail ? '<span class="chip off">off-trail control</span>' : ""}
        <span class="chip">${((c.stats.miles + c.homeMiles) / PACE_MPH * 60).toFixed(0)} min all-in</span>
      </div>
      <div class="card-actions">
        <button class="btn ghost preview">Peek route</button>
        <button class="btn primary go">Make it an adventure</button>
      </div>`;
    card.querySelector(".preview").addEventListener("click", () => state.map.previewRoute(c.ids));
    card.querySelector(".go").addEventListener("click", () => startAdventure(c));
    panel.appendChild(card);
  }
}

function renderAdventurePanel(panel) {
  const a = state.adventure;
  const card = document.createElement("div");
  card.className = "card active-adventure";

  if (a.finished) {
    card.innerHTML = `
      <h3>Course complete 🏁</h3>
      <p class="blurb">${a.cand.poi.name}, found and finished. Rate it so I learn:</p>
      <div class="card-actions rate">
        <button class="btn rate-btn" data-r="2">🤩 Loved it</button>
        <button class="btn rate-btn" data-r="1">🙂 Good</button>
        <button class="btn rate-btn" data-r="-1">😐 Meh</button>
      </div>`;
    card.querySelectorAll(".rate-btn").forEach(b =>
      b.addEventListener("click", () => finishAdventure(parseInt(b.dataset.r, 10))));
  } else {
    const finishName = state.park.nodes[a.cand.finishId].name;
    const finishLabel = a.cand.endsAtCar ? "your car" : finishName;
    card.innerHTML = `
      <h3>${a.found ? `Leg 2 — out at ${finishLabel}` : `Control 1 — ${a.cand.poi.name}`}</h3>
      <p class="blurb">${a.found
        ? `You found it. Now navigate to the double circle${a.cand.endsAtCar
            ? " — it's your car."
            : ` at ${finishName}. The faint dashed line from there is your eventual walk home (${a.cand.homeMiles.toFixed(1)} mi).`}`
        : "Navigate to the circle on the map. Your position is hidden; that's the fun part."}</p>
      <div class="badges">
        <span class="chip">${a.cand.stats.miles.toFixed(1)} mi course</span>
        ${a.cand.endsAtCar ? "" : `<span class="chip">+${a.cand.homeMiles.toFixed(1)} mi home later</span>`}
        <span class="chip nav">Nav ${NAV_STARS(a.cand.cls.nav)}</span>
      </div>
      <div class="card-actions">
        <button class="btn primary hint">Give me a hint</button>
        <button class="btn ghost spoiler">${state.showYou ? "Hide me" : "Show me (spoiler)"}</button>
        <button class="btn ghost abandon">Abandon</button>
        ${state.mode === "demo" && !a.found ? '<button class="btn ghost found-demo">I found it</button>' : ""}
        ${state.mode === "demo" && a.found ? '<button class="btn ghost found-demo">I\'m at the finish</button>' : ""}
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
      const target = a.found ? a.cand.finishId : a.cand.poi.node;
      if (distMilesTo(target) < 0.12) {
        const n = state.park.nodes[target];
        state.pos = { x: n.x, y: n.y };
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
      <p class="muted">${h.date} · ${h.park} · ${h.miles.toFixed(1)} mi ·
        ${LEN_LABEL[h.cls.len]} / ${EFFORT_LABEL[h.cls.effort]} / Nav ${NAV_STARS(h.cls.nav)}</p>`;
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
});
