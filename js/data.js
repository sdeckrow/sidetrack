/* Sidetrack — park data.
 *
 * Each park is a stylized orienteering-map model of the real place:
 * a trail graph (nodes + edges with distance/climb/nav ratings), points
 * of interest with progressive hints, and decorative terrain (contours,
 * water, vegetation) drawn in map coordinates (viewBox 1000 x 620).
 *
 * Trail geometry is hand-modeled and approximate — good for choosing and
 * navigating adventures, not survey-grade. `geo` maps real lat/lng into
 * map coordinates so live GPS roughly lines up on-site.
 */

const TAGS = {
  mines:     "Mining history",
  history:   "Ruins & relics",
  overlook:  "Big views",
  ridge:     "Ridgelines",
  water:     "Lakes & creeks",
  waterfall: "Waterfalls",
  wildlife:  "Wildlife",
  structure: "Cool structures",
  quirky:    "Quirky finds",
  quiet:     "Quiet corners",
};

const PARKS = {

  /* ------------------------------------------------------------------ */
  redmountain: {
    id: "redmountain",
    name: "Red Mountain Park",
    tagline: "Iron-ore ridge, mine ruins & treehouses",
    pxPerMile: 330,
    geo: { latMin: 33.443, latMax: 33.467, lngMin: -86.882, lngMax: -86.836 },

    nodes: {
      P:  { x: 868, y: 128, name: "Main Trailhead", parking: true },
      T:  { x: 916, y: 184, name: "Adventure Tower spur" },
      A:  { x: 812, y: 186, name: "BMRR junction" },
      M:  { x: 716, y: 134, name: "Riley Bethea spur" },
      C:  { x: 756, y: 210, name: "Ike Maybin junction" },
      L:  { x: 612, y: 164, name: "SkyHy spur" },
      B:  { x: 692, y: 238, name: "Eureka junction" },
      D:  { x: 648, y: 330, name: "Eureka Mine site" },
      E:  { x: 556, y: 270, name: "Redding junction" },
      F:  { x: 516, y: 352, name: "Hoist House site" },
      G:  { x: 428, y: 424, name: "Grace's Gap" },
      H:  { x: 414, y: 296, name: "Smythe junction" },
      I:  { x: 352, y: 398, name: "Ishkooda mine site" },
      J:  { x: 276, y: 330, name: "Songo junction" },
      K:  { x: 196, y: 404, name: "Rattlesnake point" },
    },

    edges: [
      { a: "P", b: "A", trail: "BMRR South",        miles: 0.20, climb: 20,  nav: 1 },
      { a: "P", b: "T", trail: "Tower Spur",        miles: 0.15, climb: 10,  nav: 1 },
      { a: "A", b: "C", trail: "BMRR South",        miles: 0.25, climb: 10,  nav: 1 },
      { a: "C", b: "M", trail: "Treehouse Spur",    miles: 0.30, climb: 60,  nav: 2 },
      { a: "M", b: "P", trail: "Treehouse Loop",    miles: 0.35, climb: 30,  nav: 1 },
      { a: "C", b: "B", trail: "BMRR South",        miles: 0.25, climb: 15,  nav: 1 },
      { a: "C", b: "L", trail: "Ike Maybin",        miles: 0.55, climb: 90,  nav: 2 },
      { a: "L", b: "E", trail: "SkyHy Connector",   miles: 0.50, climb: 70,  nav: 2 },
      { a: "B", b: "D", trail: "Eureka Mines",      miles: 0.40, climb: 110, nav: 2 },
      { a: "B", b: "E", trail: "BMRR South",        miles: 0.50, climb: 20,  nav: 1 },
      { a: "D", b: "F", trail: "Mine Ridge",        miles: 0.45, climb: 60,  nav: 3 },
      { a: "E", b: "F", trail: "Redding",           miles: 0.35, climb: 80,  nav: 1 },
      { a: "F", b: "G", trail: "Ishkooda",          miles: 0.50, climb: 100, nav: 2 },
      { a: "E", b: "H", trail: "BMRR South",        miles: 0.55, climb: 25,  nav: 1 },
      { a: "H", b: "G", trail: "Grace's Gap Conn.", miles: 0.45, climb: 90,  nav: 2 },
      { a: "H", b: "I", trail: "Smythe",            miles: 0.50, climb: 70,  nav: 2 },
      { a: "I", b: "G", trail: "Ishkooda",          miles: 0.40, climb: 40,  nav: 2 },
      { a: "H", b: "J", trail: "BMRR West",         miles: 0.55, climb: 20,  nav: 1 },
      { a: "J", b: "I", trail: "Songo",             miles: 0.45, climb: 60,  nav: 2 },
      { a: "J", b: "K", trail: "Rattlesnake Ridge", miles: 0.60, climb: 120, nav: 3 },
    ],

    pois: [
      {
        id: "eureka", node: "D", name: "Eureka Mine #13",
        tags: ["mines", "history"], offTrail: false,
        blurb: "Collapsed adit and ore-crusher footings from the iron days. The cut in the hillside is still sharp.",
        hints: [
          "Miners walked uphill to work — so will you. Leave the flat rail bed behind.",
          "Listen for the hollow under the ridge: the trail bends around an old cut in the rock.",
          "Rusted iron in the leaf litter means you're a stone's throw away.",
        ],
      },
      {
        id: "hoist", node: "F", name: "Redding Hoist House",
        tags: ["history", "structure", "mines"], offTrail: false,
        blurb: "Brick shell of the engine house that once hauled ore cars up the slope. Best ruin in the park.",
        hints: [
          "Engines need water and a slope. Find where the climbing trail crosses the old work road.",
          "Brick doesn't grow in forests — watch for a right angle among the trees.",
          "If you can see daylight through arched windows, you've done it.",
        ],
      },
      {
        id: "gracesgap", node: "G", name: "Grace's Gap Overlook",
        tags: ["overlook", "ridge"], offTrail: false,
        blurb: "The classic Red Mountain view south over the valley. Sunset spot.",
        hints: [
          "Gaps are low points in ridges. Aim for where two climbing trails meet.",
          "When the trees start thinning on your left, keep going a little farther.",
          "The bench is facing the wrong way for you to miss it.",
        ],
      },
      {
        id: "ishkooda", node: "I", name: "Ishkooda Mine #14",
        tags: ["mines", "history", "quiet"], offTrail: true,
        blurb: "Quieter sister of Eureka — sealed portal, spoil heaps, and almost nobody around.",
        hints: [
          "The crowds stop at the gap. The mines don't.",
          "Spoil heaps make lumpy ground — when the forest floor turns to waves, slow down.",
          "The portal faces the morning sun.",
        ],
      },
      {
        id: "skyhy", node: "L", name: "SkyHy Treehouse",
        tags: ["quirky", "structure", "overlook"], offTrail: false,
        blurb: "A proper grown-up treehouse perched off the Ike Maybin trail. Climb up, look out.",
        hints: [
          "Not everything worth finding is on the ground.",
          "Take the trail that won't stop switchbacking.",
          "Look up before you look around.",
        ],
      },
      {
        id: "riley", node: "M", name: "Riley Bethea Treehouse",
        tags: ["quirky", "structure"], offTrail: false,
        blurb: "The close-in treehouse — a quick deck in the canopy, great with kids.",
        hints: [
          "This one hides close to home.",
          "Follow the spur that climbs away from the rail bed near the trailhead.",
          "Wooden stairs in a forest are rarely an accident.",
        ],
      },
      {
        id: "tower", node: "T", name: "Kaul Adventure Tower",
        tags: ["quirky", "structure"], offTrail: false,
        blurb: "The 80-foot climbing tower by the trailhead. Zero navigation glory, maximum photo.",
        hints: [
          "You could probably see this one from your car if you squinted.",
          "It's the tallest thing in the park that isn't a tree.",
        ],
      },
      {
        id: "rattlesnake", node: "K", name: "Rattlesnake Outcrop",
        tags: ["ridge", "quiet", "overlook"], offTrail: true,
        blurb: "Sandstone outcrop at the lonely west end of the ridge. Earn-your-view territory.",
        hints: [
          "Go west until the trail forgets it's a trail.",
          "Ridges narrow before they end — stay on the spine.",
          "Bare rock underfoot means stop and turn around: that's the view.",
        ],
      },
    ],

    labels: [
      { x: 700, y: 260, rot: -12, text: "BMRR South" },
      { x: 340, y: 312, rot: -8,  text: "BMRR West" },
      { x: 672, y: 192, rot: -28, text: "Ike Maybin" },
      { x: 470, y: 308, rot: 42,  text: "Redding" },
      { x: 392, y: 372, rot: 30,  text: "Smythe" },
      { x: 240, y: 358, rot: 28,  text: "Rattlesnake Ridge" },
    ],

    // decorative terrain in map coords
    ridges: [
      { cx: 520, cy: 300, rx: 380, ry: 110, rot: -14, rings: 5 },
      { cx: 250, cy: 380, rx: 140, ry: 60,  rot: -18, rings: 3 },
    ],
    water: [
      { type: "creek", pts: [[60, 540], [300, 500], [560, 470], [820, 430], [990, 410]] },
    ],
    veg: [
      { fill: "green",  pts: [[120, 180], [260, 140], [380, 200], [300, 280], [160, 260]] },
      { fill: "yellow", pts: [[820, 60], [950, 80], [960, 160], [870, 150]] },
      { fill: "green",  pts: [[520, 480], [680, 450], [760, 520], [600, 560], [480, 540]] },
    ],
  },

  /* ------------------------------------------------------------------ */
  oakmountain: {
    id: "oakmountain",
    name: "Oak Mountain State Park",
    tagline: "Double ridges, Peavine Falls & King's Chair",
    pxPerMile: 260,
    geo: { latMin: 33.295, latMax: 33.368, lngMin: -86.792, lngMax: -86.698 },

    nodes: {
      P1: { x: 802, y: 128, name: "North Trailhead", parking: true },
      WC: { x: 742, y: 104, name: "Wildlife Center" },
      TT: { x: 860, y: 152, name: "Treetop boardwalk" },
      F:  { x: 588, y: 176, name: "Foothills junction" },
      G:  { x: 472, y: 140, name: "Tranquility Lake" },
      LK: { x: 636, y: 104, name: "Double Oak dam" },
      A:  { x: 648, y: 226, name: "Maggie's Glen" },
      B:  { x: 716, y: 300, name: "King's Chair junction" },
      KC: { x: 786, y: 336, name: "King's Chair" },
      C:  { x: 596, y: 332, name: "Shackleford Point" },
      D:  { x: 508, y: 352, name: "Blue–White connector" },
      H:  { x: 414, y: 392, name: "South Rim overlook" },
      R:  { x: 388, y: 302, name: "Red trail crossing" },
      E:  { x: 304, y: 424, name: "Peavine junction" },
      PF: { x: 268, y: 478, name: "Peavine Falls" },
      P2: { x: 230, y: 416, name: "Peavine Trailhead", parking: true },
    },

    edges: [
      { a: "P1", b: "WC", trail: "Terrace Walk",        miles: 0.15, climb: 10,  nav: 1 },
      { a: "P1", b: "TT", trail: "Treetop Boardwalk",   miles: 0.20, climb: 20,  nav: 1 },
      { a: "P1", b: "A",  trail: "White (Shackleford)", miles: 0.55, climb: 90,  nav: 1 },
      { a: "A",  b: "F",  trail: "Yellow (Foothills)",  miles: 0.45, climb: 40,  nav: 2 },
      { a: "F",  b: "G",  trail: "Lakeside",            miles: 0.50, climb: 20,  nav: 1 },
      { a: "F",  b: "LK", trail: "Lakeshore",           miles: 0.40, climb: 10,  nav: 1 },
      { a: "LK", b: "P1", trail: "Campground Path",     miles: 0.55, climb: 15,  nav: 1 },
      { a: "A",  b: "B",  trail: "White (Shackleford)", miles: 0.65, climb: 160, nav: 2 },
      { a: "B",  b: "KC", trail: "King's Chair Spur",   miles: 0.25, climb: 60,  nav: 2 },
      { a: "B",  b: "C",  trail: "White (Shackleford)", miles: 0.55, climb: 80,  nav: 2 },
      { a: "C",  b: "D",  trail: "White (Shackleford)", miles: 0.45, climb: 40,  nav: 2 },
      { a: "D",  b: "H",  trail: "Blue (South Rim)",    miles: 0.55, climb: 70,  nav: 2 },
      { a: "D",  b: "R",  trail: "Connector",           miles: 0.40, climb: 50,  nav: 2 },
      { a: "R",  b: "G",  trail: "Red (Double Oak)",    miles: 0.65, climb: 80,  nav: 2 },
      { a: "H",  b: "E",  trail: "Blue (South Rim)",    miles: 0.60, climb: 60,  nav: 2 },
      { a: "R",  b: "E",  trail: "Red (Double Oak)",    miles: 0.55, climb: 70,  nav: 2 },
      { a: "E",  b: "PF", trail: "Peavine Falls",       miles: 0.30, climb: 90,  nav: 2 },
      { a: "E",  b: "P2", trail: "Peavine Branch",      miles: 0.25, climb: 20,  nav: 1 },
    ],

    pois: [
      {
        id: "peavine", node: "PF", name: "Peavine Falls",
        tags: ["waterfall", "water"], offTrail: false,
        blurb: "65-foot falls in a rock amphitheater. Roars after rain, trickles in August — beautiful either way.",
        hints: [
          "Water only ever does one thing. Go down with it.",
          "When the trail turns to rock steps, you're in the gorge.",
          "You'll hear it before you see it. Follow your ears, not your feet.",
        ],
      },
      {
        id: "cascades", node: "PF", name: "Lower Cascades",
        tags: ["water", "quiet"], offTrail: true,
        blurb: "Below the main falls the creek stair-steps through boulders. Most people never scramble down.",
        hints: [
          "Everyone stops at the big one. Don't.",
          "Downstream, the creek keeps performing for a smaller audience.",
          "Pick your way along the boulders on the drier bank.",
        ],
      },
      {
        id: "kingschair", node: "KC", name: "King's Chair",
        tags: ["overlook", "ridge"], offTrail: false,
        blurb: "Rock throne on the ridge crest — the best view in any Birmingham park, full stop.",
        hints: [
          "Kings sit high. Climb until the ridge runs out of up.",
          "Take the spur that dead-ends — that's the whole point of it.",
          "If your stomach drops a little, sit down. You've arrived.",
        ],
      },
      {
        id: "treetop", node: "TT", name: "Treetop Nature Trail",
        tags: ["wildlife", "quirky"], offTrail: false,
        blurb: "Boardwalk past rehabilitated owls, hawks and vultures that live here for keeps.",
        hints: [
          "This trail has residents, and they're watching you first.",
          "Boardwalks creak. Listen for yours near the trailhead.",
        ],
      },
      {
        id: "wildlife", node: "WC", name: "Alabama Wildlife Center",
        tags: ["wildlife"], offTrail: false,
        blurb: "The state's oldest wildlife rehab center — songbird nursery viewing in spring.",
        hints: [
          "Injured birds check in near where the cars do.",
          "Follow the building, not the woods, this once.",
        ],
      },
      {
        id: "maggies", node: "A", name: "Maggie's Glen",
        tags: ["quiet", "water"], offTrail: false,
        blurb: "Creekside hollow with a bench and a footbridge — the park's favorite resting spot.",
        hints: [
          "Glens hide where ridges pinch a creek.",
          "Two trails shake hands at the bottom of the hill.",
          "The bench by the bridge is the giveaway.",
        ],
      },
      {
        id: "shackleford", node: "C", name: "Shackleford Point",
        tags: ["ridge", "quiet"], offTrail: true,
        blurb: "The quiet high point of the white trail's namesake ridge. No sign, no rail — just the top.",
        hints: [
          "Highest isn't always loudest. This summit doesn't advertise.",
          "Stay on the spine until everything else is downhill.",
          "A modest pile of rocks marks immodest effort.",
        ],
      },
      {
        id: "southrim", node: "H", name: "South Rim Overlook",
        tags: ["overlook", "ridge"], offTrail: false,
        blurb: "Ledges on the blue trail looking back at the opposite ridge — King's Chair's mirror view.",
        hints: [
          "To admire a ridge, stand on the other one.",
          "The blue trail walks the edge — watch your left.",
          "Bare ledges, big air, no fence.",
        ],
      },
      {
        id: "tranquility", node: "G", name: "Tranquility Lake",
        tags: ["water", "quiet"], offTrail: false,
        blurb: "The small still lake under the dam side. Herons, turtles, glassy reflections at dawn.",
        hints: [
          "The name is a promise. Walk until the noise stops.",
          "Flat water hides behind the busy lake.",
          "Find the bank where the trail and the shoreline agree.",
        ],
      },
      {
        id: "dam", node: "LK", name: "Double Oak Dam",
        tags: ["water", "structure"], offTrail: false,
        blurb: "Walk the dam crest between the big lake and the spillway — best skipping stones in the park.",
        hints: [
          "Lakes this tidy were built, not born. Find the straight edge.",
          "Follow the shoreline toward the sound of falling water.",
        ],
      },
    ],

    labels: [
      { x: 680, y: 262, rot: 38,  text: "White — Shackleford" },
      { x: 470, y: 380, rot: 14,  text: "Blue — South Rim" },
      { x: 360, y: 252, rot: -30, text: "Red — Double Oak" },
      { x: 524, y: 158, rot: -6,  text: "Lakeside" },
      { x: 282, y: 452, rot: 40,  text: "Peavine Falls" },
    ],

    ridges: [
      { cx: 560, cy: 320, rx: 360, ry: 90,  rot: 24, rings: 5 },
      { cx: 430, cy: 200, rx: 260, ry: 60,  rot: 24, rings: 3 },
      { cx: 300, cy: 470, rx: 160, ry: 55,  rot: 24, rings: 3 },
    ],
    water: [
      { type: "lake",  pts: [[560, 60], [680, 50], [740, 80], [700, 120], [600, 130], [540, 100]] },
      { type: "lake",  pts: [[430, 110], [480, 100], [500, 130], [460, 155], [420, 140]] },
      { type: "creek", pts: [[268, 478], [240, 540], [190, 590]] },
      { type: "creek", pts: [[648, 226], [600, 170], [560, 110]] },
    ],
    veg: [
      { fill: "yellow", pts: [[760, 60], [900, 70], [930, 140], [820, 170], [740, 130]] },
      { fill: "green",  pts: [[100, 250], [240, 210], [320, 280], [240, 350], [120, 330]] },
      { fill: "green",  pts: [[640, 420], [800, 400], [880, 470], [760, 540], [620, 500]] },
    ],
  },
};

if (typeof module !== "undefined") module.exports = { PARKS, TAGS };
