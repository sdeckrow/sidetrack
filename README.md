# Sidetrack 🥾

*Your hike, with a plot twist.*

A web app for **Red Mountain Park** and **Oak Mountain State Park** in
Birmingham, AL. You go for a hike; Sidetrack asks how long you want to be
out, watches where you're heading, picks something fun just off your path —
a mine ruin, a waterfall, a rock throne — and turns the rest of your hike
into a small orienteering course: start triangle where you are, a control
circle at the find, and a double-circle finish **back on a trail somewhere
new in the park**. Sometimes the finish is your car; usually it isn't —
but the walk home is always budgeted into your time window and drawn as a
faint dashed leg, so you're never stranded. No compass, no turn-by-turn,
no blue dot (unless you ask for the spoiler). Hints on demand that nudge
without giving it away.

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
4. Say **how long you're out for** (45 min to all day) and hit
   **Suggest adventures**: you get options graded by **length**
   (short / medium / long), **effort** (easy / moderate / hard, from
   distance + climb), and **navigation difficulty** (★–★★★, from trail
   faintness, junction count, and off-trail controls). Each course ends
   at a trail node somewhere new in the park — occasionally your car —
   chosen so that *course + the eventual walk back to your car* fits your
   time window. Cards show where you'll come out, the walk-home distance,
   and an all-in time estimate.
5. Start one and your live dot disappears — that's the game. Ask for
   **hints**: they escalate from cryptic to warmer/colder to
   distance bands, never coordinates. "Show me (spoiler)" is there if you
   surrender.
6. Finish back on trail, rate the adventure, and Sidetrack learns: ratings
   feed tag weights (mines, overlooks, waterfalls, quirky structures…)
   that bias future suggestions, and places you've been get a novelty
   penalty so it keeps showing you new corners. History tab shows your
   log and taste profile. Everything stays in `localStorage` on your
   device — no accounts, no server.

## How it works

| File | What it does |
|---|---|
| `js/data.js` | **Generated — do not edit.** Both parks built from real survey data: OSM trail geometry (every bend, real names), USGS contours, water, roads, parking, park boundary; POIs with progressive hints anchored to real coordinates |
| `js/engine.js` | Dijkstra routing, route classification, heading prediction (no U-turns), suggestion scoring, preference learning, hint logic, GPS→map projection |
| `js/map.js` | Orienteering map renderer: ISOM-ish colors (brown contours, blue water, yellow open land, black dashed trails), purple course overlay, scale bar, pan/zoom |
| `js/app.js` | UI state machine, demo walking, GPS tracking, history |

## Map data

The maps are built from real survey data:

- **Trails, water, roads, parking, boundaries** — © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- **Contours** — USGS 3DEP elevation via the AWS Terrain Tiles open dataset

To rebuild (e.g. after OSM improves the parks, or to edit POIs in
`tools/park-content.mjs`):

```sh
node tools/fetch-osm.mjs        # trail/water/parking geometry → tools/raw/
node tools/fetch-elevation.mjs  # elevation tiles → tools/raw/tiles/
node tools/build-mapdata.mjs    # → js/data.js
```

## Honest caveats

- OSM trail data is community-surveyed: excellent in these parks, but not
  gospel. Don't use this as your only navigation in the backcountry;
  carry the park's official map too.
- GPS alignment uses an equirectangular projection over each park's
  bounding box — good registration at park scale, not survey-grade.
- Off-trail suggestions assume park rules allow it where marked — check
  signage; some areas (mine portals especially) are sealed for good reason.
