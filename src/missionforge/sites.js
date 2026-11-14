const analog = "https://science.nasa.gov/solar-system/analog-explorer/";
const field = "https://astrobiology.nasa.gov/research-locations/";
const records = [
  [
    "atacama",
    "Atacama Desert",
    "Chile",
    "Hyperarid desert",
    "Salt flats and gravel plains",
    "Extreme dryness and strong UV exposure",
    -24.09,
    -69.86,
    86,
    72,
    90,
    analog,
  ],
  [
    "iceland",
    "Icelandic Highlands",
    "Iceland",
    "Volcanic highlands",
    "Basaltic lava and volcanic sand",
    "Unstable surfaces and rapid weather changes",
    65.05,
    -16.75,
    66,
    60,
    99,
    analog,
  ],
  [
    "haughton",
    "Haughton Crater",
    "Canada",
    "Impact structure",
    "Impact breccia and polar desert",
    "Seasonal access and severe cold",
    75.38,
    -89.67,
    98,
    25,
    96,
    "https://science.nasa.gov/solar-system/planetary-analogs/10-things-to-know-about-planetary-analogs/",
  ],
  [
    "death",
    "Death Valley",
    "United States",
    "Dune field",
    "Aeolian dunes and stony alluvial fans",
    "Extreme heat and exposure",
    35.69,
    -116.37,
    58,
    88,
    86,
    "https://ntrs.nasa.gov/citations/20260000452",
  ],
  [
    "mcmurdo",
    "McMurdo Dry Valleys",
    "Antarctica",
    "Polar desert",
    "Ice-cemented ground and glacial sediment",
    "Polar cold and restricted access",
    -77.72,
    162.27,
    100,
    12,
    95,
    field,
  ],
  [
    "mauna",
    "Mauna Loa",
    "United States",
    "Volcanic shield",
    "High-altitude basaltic lava fields",
    "Volcanic terrain and altitude",
    19.6,
    -155.49,
    72,
    68,
    94,
    "https://www.hi-seas.org/",
  ],
];
export const sites = records.map(
  ([
    id,
    name,
    country,
    type,
    surface,
    hazard,
    lat,
    lon,
    isolation,
    access,
    geology,
    source,
  ]) => ({
    id,
    name,
    country,
    type,
    surface,
    hazard,
    lat,
    lon,
    isolation,
    access,
    geology,
    source,
  }),
);
export const profiles = [
  "Long-duration habitat",
  "Rover exploration",
  "Geological research",
  "Solar-powered operations",
  "Isolated crew endurance",
  "Extreme climate testing",
  "Autonomous systems",
];
const weights = [
  [3, 2, 3, 2, 2],
  [2, 5, 1, 2, 2],
  [1, 8, 1, 1, 1],
  [1, 1, 8, 1, 1],
  [1, 1, 1, 9, 1],
  [6, 1, 1, 3, 1],
  [1, 4, 2, 5, 1],
];
export const factors = [
  "Climate match",
  "Geology",
  "Solar resource",
  "Isolation",
  "Field access",
  "Thermal operating margin",
];
const bound = (n) => Math.max(0, Math.min(100, n));
export const coords = (s) =>
  [s.lat, s.lon]
    .map(
      (n, i) =>
        Math.abs(n).toFixed(2) +
        "° " +
        (i ? (n < 0 ? "W" : "E") : n < 0 ? "S" : "N"),
    )
    .join("  /  ");
export function rank(site, climate, profile = 0, query = "", priority = 1) {
  const p = climate?.properties?.parameter;
  const annual = (k) =>
    Number.isFinite(p?.[k]?.ANN) && p[k].ANN > -900 ? p[k].ANN : null;
  const t = annual("T2M"),
    rain = annual("PRECTOTCORR"),
    sun = annual("ALLSKY_SFC_SW_DWN");
  const cold = /cold|polar|freez/i.test(query) || profile === 5;
  const temp =
    t === null ? null : bound(100 - Math.abs(t - (cold ? -17 : 14)) * 2.2);
  const arid = rain === null ? null : bound(100 - rain * 25);
  const climateFit = temp === null || arid === null ? null : (temp + arid) / 2;
  const scores = [
    climateFit,
    site.geology ?? null,
    sun === null ? null : bound((sun / 7.5) * 100),
    site.isolation ?? null,
    site.access ?? null,
    t === null ? null : bound(100 - Math.max(0, Math.abs(t - 15) - 10) * 3),
  ];
  const w = [...weights[profile], profile === 0 ? 2 : 1];
  w[0] *= priority;
  if (/dry|arid|cold/i.test(query)) w[0] += 5;
  if (/solar/i.test(query)) w[2] += 5;
  if (/remote|isolat/i.test(query)) w[3] += 5;
  if (/volcan|basalt/i.test(query)) {
    w[1] += 8;
    if (scores[1] !== null) scores[1] = /volcan/i.test(site.type) ? 100 : 45;
  }
  if (/rock|geolog|rover/i.test(query)) w[1] += 2;
  const total = w.reduce((a, b) => a + b, 0);
  const available = w.reduce((a, b, i) => a + (scores[i] === null ? 0 : b), 0);
  return {
    score: available
      ? Math.round(
          scores.reduce((a, b, i) => a + (b ?? 0) * w[i], 0) / available,
        )
      : null,
    scores,
    w,
    coverage: available / total,
  };
}
export function interpret(q, current) {
  if (/geolog|sample|volcan/i.test(q)) return 2;
  if (/habitat|shelter/i.test(q)) return 0;
  if (/rover|robot/i.test(q)) return 1;
  if (/solar/i.test(q)) return 3;
  if (/endurance|isolat/i.test(q)) return 4;
  if (/extreme|cold/i.test(q)) return 5;
  if (/autonom/i.test(q)) return 6;
  return current;
}
