/* Hand-authored park content: names, taglines, POIs with hints.
 *
 * Geometry is NOT in here — build-mapdata.mjs fetches real trail/terrain
 * data and resolves each POI's `anchor` to real coordinates:
 *   { lat, lng }          a real OSM node we found (mine portals, falls…)
 *   { trail: "name" }     midpoint of the named trail
 *   { water: "name" }     centroid of the named lake
 * Everything in js/data.js is generated; edit THIS file and rebuild.
 */

export const TAGS = {
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

export const PARK_CONTENT = {
  redmountain: {
    name: "Red Mountain Park",
    tagline: "Iron-ore ridge, mine ruins & treehouses",
    // main visitor lot off Frankfurt Drive isn't mapped in OSM yet —
    // declare it here so the game has the real entrance
    trailheads: [{ name: "Main Trailhead (Frankfurt Dr)", lat: 33.446, lng: -86.8625 }],
    pois: [
      {
        id: "eureka", anchor: { trail: "Eureka Mines Trail" },
        name: "Eureka Mines", tags: ["mines", "history"], offTrail: false,
        blurb: "Collapsed adits and ore-crusher footings from the iron days. The cut in the hillside is still sharp.",
        hints: [
          "Miners walked uphill to work — so will you. Leave the flat rail bed behind.",
          "Listen for the hollow under the ridge: the trail bends around an old cut in the rock.",
          "Rusted iron in the leaf litter means you're a stone's throw away.",
        ],
      },
      {
        id: "mine13", anchor: { lat: 33.4537, lng: -86.8604 },
        name: "Ishkooda Mine #13", tags: ["mines", "history"], offTrail: false,
        blurb: "A sealed portal with its own short trail — the #13 Mine Trail exists for exactly one reason.",
        hints: [
          "Some trails are named after their destination. Read the map's fine print.",
          "Head for where the mine trail dead-ends against the ridge.",
          "A portal faces you square-on at the end. That's it.",
        ],
      },
      {
        id: "ishkooda14", anchor: { lat: 33.4568, lng: -86.8565 },
        name: "Ishkooda Mine #14", tags: ["mines", "history", "quiet"], offTrail: true,
        blurb: "Quieter sister of the big mines — sealed portal, spoil heaps, and almost nobody around.",
        hints: [
          "The crowds stop at the overlooks. The mines don't.",
          "Spoil heaps make lumpy ground — when the forest floor turns to waves, slow down.",
          "The portal faces the morning sun.",
        ],
      },
      {
        id: "hoist", anchor: { lat: 33.4413, lng: -86.8798 },
        name: "Redding Hoist House", tags: ["history", "structure", "mines"], offTrail: false,
        blurb: "Brick shell of the engine house that once hauled ore cars up the slope. Best ruin in the park.",
        hints: [
          "Engines need water and a slope. Find where the climbing trail crosses the old work road.",
          "Brick doesn't grow in forests — watch for a right angle among the trees.",
          "If you can see daylight through arched windows, you've done it.",
        ],
      },
      {
        id: "gracesgap", anchor: { lat: 33.4643, lng: -86.8457 },
        name: "Grace's Gap Overlook", tags: ["overlook", "ridge"], offTrail: false,
        blurb: "The classic Red Mountain view over the valley. Sunset spot.",
        hints: [
          "Gaps are low points in ridges. Aim for where the climbing trails meet.",
          "When the trees start thinning on your left, keep going a little farther.",
          "The bench is facing the wrong way for you to miss it.",
        ],
      },
      {
        id: "ishkoodaview", anchor: { lat: 33.4487, lng: -86.8730 },
        name: "Ishkooda Overlook", tags: ["overlook", "ridge", "quiet"], offTrail: false,
        blurb: "The overlook the trailhead crowds never reach — same valley, none of the company.",
        hints: [
          "Same ridge, farther down the spine. Most people turn around too early.",
          "Pass the mines and keep believing.",
          "The view opens to the southwest. So should you.",
        ],
      },
      {
        id: "ebsco", anchor: { lat: 33.4392, lng: -86.8860 },
        name: "Ebsco Overlook", tags: ["overlook", "quiet"], offTrail: false,
        blurb: "Twin platforms at the far west end of the park. Earn-your-view territory.",
        hints: [
          "Go west until the map runs out of west.",
          "Two overlooks share a ridge end — find either and you've found both.",
          "Bare sky through the trees ahead means stop walking and look.",
        ],
      },
      {
        id: "springgap", anchor: { lat: 33.4454, lng: -86.8753 },
        name: "Spring Gap", tags: ["ridge", "quiet"], offTrail: false,
        blurb: "A true saddle on the ridge — the quiet crossing point where four ways meet and nobody lingers.",
        hints: [
          "Water crosses ridges at their lowest points. So do trails.",
          "Walk the spine until it dips and the wind changes.",
          "Where everything intersects, you've arrived — the point is the pause.",
        ],
      },
      {
        id: "skyhy", anchor: { trail: "Skyhy Ridge Walk" },
        name: "SkyHy Treehouse", tags: ["quirky", "structure", "overlook"], offTrail: false,
        blurb: "A proper grown-up treehouse perched on the ridge walk. Climb up, look out.",
        hints: [
          "Not everything worth finding is on the ground.",
          "Take the ridge walk that won't stop climbing.",
          "Look up before you look around.",
        ],
      },
      {
        id: "treehouse", anchor: { trail: "Rushing Rendezvous Treehouse Rope Bridge" },
        name: "Rushing Rendezvous Treehouse", tags: ["quirky", "structure"], offTrail: false,
        blurb: "The treehouse with its own rope bridge — a deck in the canopy, great with kids.",
        hints: [
          "This one hides close to home.",
          "Bridges usually cross water. This one crosses air.",
          "Wooden stairs in a forest are rarely an accident.",
        ],
      },
    ],
  },

  oakmountain: {
    name: "Oak Mountain State Park",
    tagline: "Double ridges, Peavine Falls & King's Chair",
    pois: [
      {
        id: "peavine", anchor: { lat: 33.3057, lng: -86.7566 },
        name: "Peavine Falls", tags: ["waterfall", "water"], offTrail: false,
        blurb: "65-foot falls in a rock amphitheater. Roars after rain, trickles in August — beautiful either way.",
        hints: [
          "Water only ever does one thing. Go down with it.",
          "When the trail turns to rock steps, you're in the gorge.",
          "You'll hear it before you see it. Follow your ears, not your feet.",
        ],
      },
      {
        id: "cascades", anchor: { lat: 33.3045, lng: -86.7572 },
        name: "Lower Cascades", tags: ["water", "quiet"], offTrail: true,
        blurb: "Below the main falls the creek stair-steps through boulders. Most people never scramble down.",
        hints: [
          "Everyone stops at the big one. Don't.",
          "Downstream, the creek keeps performing for a smaller audience.",
          "Pick your way along the boulders on the drier bank.",
        ],
      },
      {
        id: "kingschair", anchor: { lat: 33.3471, lng: -86.6927 },
        name: "King's Chair", tags: ["overlook", "ridge"], offTrail: false,
        blurb: "Rock throne on the ridge crest — the best view in any Birmingham park, full stop.",
        hints: [
          "Kings sit high. Climb until the ridge runs out of up.",
          "Take the spur that dead-ends — that's the whole point of it.",
          "If your stomach drops a little, sit down. You've arrived.",
        ],
      },
      {
        id: "eaglesnest", anchor: { lat: 33.3593, lng: -86.6981 },
        name: "Eagle's Nest Overlook", tags: ["overlook", "ridge", "quiet"], offTrail: false,
        blurb: "The northeast ridge's answer to King's Chair — fewer feet, same air.",
        hints: [
          "Two ridges, two thrones. This is the other one.",
          "Follow the crest northeast past where most people turn back.",
          "When the rock opens up underfoot, claim the nest.",
        ],
      },
      {
        id: "peavinegorge", anchor: { trail: "Peavine Gorge Overlook" },
        name: "Peavine Gorge Overlook", tags: ["overlook", "quiet"], offTrail: false,
        blurb: "Look *down* on the falls' gorge from the rim instead of up from the bottom.",
        hints: [
          "There are two ways to see a waterfall. This is the one without wet shoes.",
          "Walk the rim, not the gorge.",
          "The drop on your left is the point.",
        ],
      },
      {
        id: "johnson", anchor: { lat: 33.3062, lng: -86.7750 },
        name: "Johnson Mountain", tags: ["ridge", "quiet"], offTrail: false,
        blurb: "The park's forgotten summit, off on its own spur. No sign, no rail — just the top.",
        hints: [
          "Highest isn't always loudest. This summit doesn't advertise.",
          "Stay on the spine until everything else is downhill.",
          "A modest pile of rocks marks immodest effort.",
        ],
      },
      {
        id: "ccc", anchor: { lat: 33.3438, lng: -86.7247 },
        name: "Christian Camp Ruins", tags: ["history", "quiet", "structure"], offTrail: true,
        blurb: "Stone foundations of an old camp the forest is slowly reclaiming — plaques, chimneys, and CCC-era campsites nearby.",
        hints: [
          "The forest keeps old floor plans longer than you'd think.",
          "Look for right angles where the lake used to host summers.",
          "Two plaques tell the story, if you can find them both.",
        ],
      },
      {
        id: "maggies", anchor: { lat: 33.3468, lng: -86.7121 },
        name: "Maggie's Glen", tags: ["quiet", "water"], offTrail: false,
        blurb: "Creekside hollow with a bench and a footbridge — the park's favorite resting spot.",
        hints: [
          "Glens hide where ridges pinch a creek.",
          "Two trails shake hands at the bottom of the hill.",
          "The bench by the bridge is the giveaway.",
        ],
      },
      {
        id: "treetop", anchor: { trail: "Treetop Trail" },
        name: "Treetop Nature Trail", tags: ["wildlife", "quirky"], offTrail: false,
        blurb: "Boardwalk past rehabilitated owls, hawks and vultures that live here for keeps.",
        hints: [
          "This trail has residents, and they're watching you first.",
          "Boardwalks creak. Listen for yours near the wildlife center.",
        ],
      },
      {
        id: "oldlake", anchor: { water: "Old Lake" },
        name: "Old Lake", tags: ["water", "quiet", "history"], offTrail: false,
        blurb: "The small, older lake the summer camps were built around. Herons, turtles, glassy reflections at dawn.",
        hints: [
          "Before the big lake, there was this one.",
          "Flat water hides behind the busy lake.",
          "Find the bank where the trail and the shoreline agree.",
        ],
      },
    ],
  },
};
