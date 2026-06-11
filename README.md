# Sidetrack 🥾

*Your hike, with a plot twist.*

A web app for **Red Mountain Park** and **Oak Mountain State Park** in
Birmingham, AL. You go for a hike; Sidetrack watches where you're heading,
picks something fun just off your path — a mine ruin, a waterfall, a rock
throne — and turns the rest of your hike into a small orienteering course:
start triangle where you are, a control circle at the find, a double circle
back at your car. No compass, no turn-by-turn, no blue dot (unless you ask
for the spoiler). Hints on demand that nudge without giving it away.

## Run it

It's a static site — no build, no server-side anything:

```sh
cd sidetrack
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser. For live GPS on-site it must be
served over **HTTPS** (e.g. GitHub Pages) — browsers won't give location to
insecure pages.

## How to use it

1. **Pick a park**, then tap the **P** square on the map where you parked.
2. **Demo mode** (default): tap anywhere on a trail and your dot walks
   there at fast-forward speed — great for trying it from the couch.
   **Live GPS** toggle: uses real position when you're actually at the park.
3. Hike a bit. When you pass junctions, Sidetrack predicts your heading
   and flags interesting things "on your way."
4. Hit **Suggest adventures**: you get options graded by
   **length** (short / medium / long), **effort** (easy / moderate / hard,
   from distance + climb), and **navigation difficulty** (★–★★★, from
   trail faintness, junction count, and off-trail finishes). Every route
   ends back at your car.
5. Start one and your live dot disappears — that's the game. Ask for
   **hints**: they escalate from cryptic to warmer/colder to
   distance bands, never coordinates. "Show me (spoiler)" is there if you
   surrender.
6. Finish at the car, rate the adventure, and Sidetrack learns: ratings
   feed tag weights (mines, overlooks, waterfalls, quirky structures…)
   that bias future suggestions, and places you've been get a novelty
   penalty so it keeps showing you new corners. History tab shows your
   log and taste profile. Everything stays in `localStorage` on your
   device — no accounts, no server.

## How it works

| File | What it does |
|---|---|
| `js/data.js` | Both parks as trail graphs (nodes/edges with miles, climb, nav rating), POIs with progressive hints, decorative terrain |
| `js/engine.js` | Dijkstra routing, route classification, heading prediction (no U-turns), suggestion scoring, preference learning, hint logic, GPS→map projection |
| `js/map.js` | Hand-drawn orienteering map renderer: SVG with turbulence-displaced "wobbly ink" strokes, contour rings, ISOM-ish colors, purple course overlay, pan/zoom |
| `js/app.js` | UI state machine, demo walking, GPS tracking, history |

## Honest caveats

- **Trail geometry is hand-modeled and approximate.** Real trail names and
  real places, but stylized layout — it's an orienteering sketch map, not
  survey data. Don't use it as your only navigation in the backcountry;
  carry the park's official map too.
- GPS alignment uses a simple linear lat/lng projection; expect
  rough, not perfect, registration on-site.
- Off-trail suggestions assume park rules allow it where marked — check
  signage; some areas (mine portals especially) are sealed for good reason.
