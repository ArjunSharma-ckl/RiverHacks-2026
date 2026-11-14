import { stations, prepareDuties, assignDuty, dutyPose } from "./duties.js";
import morphdom from "morphdom";
import "./design.css";
import { sites, profiles, coords, rank, interpret, factors } from "./sites.js";
import {
  SOL,
  roles,
  roster,
  start,
  advance,
  generation,
  failures,
  medicalCases,
  inject,
  respond,
  vitals,
  log,
} from "./simulation.js";
const app = document.querySelector("#app"),
  atlas = document.querySelector("#atlas"),
  notice = document.querySelector("#notice");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (act, label, cls = "") =>
  `<button class="${cls}" data-act="${act}">${label}</button>`;
const opts = (values, selected) =>
  values
    .map(
      (v) =>
        `<option${String(v) === String(selected) ? " selected" : ""}>${esc(v)}</option>`,
    )
    .join("");
const select = (id, label, values, value) =>
  `<label class="field">${label}<select id="${id}">${opts(values, value)}</select></label>`;
const num = (id, label, value, min, max, step = 1) =>
  `<label class="field">${label}<input id="${id}" type="number" required min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const line = (a, b) =>
  `<div class="line"><strong>${a}</strong><span>${b}</span></div>`;
const bar = (n) =>
  `<span class="chart"><i style="width:${Math.max(0, Math.min(100, n))}%"></i></span>`;
const label = (s) => `<span class="eyebrow"><i class="tick"></i>${s}</span>`;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "Unavailable");
const photo = (s) =>
  sites.some((x) => x.id === s.id)
    ? `<img alt="Satellite view of ${s.name}" src="/assets/mission/${s.id}.jpg">`
    : "";
const cache = {},
  obs = new Map();
let crewIndex = 0;
let cameraPreset = "Overview";
let site = sites[0],
  profile = 0,
  query = "",
  priority = 1,
  compare = "iceland",
  page = "",
  scene,
  mission,
  playing = false,
  speed = 1,
  tab = "Systems",
  incident = "solar",
  medical = medicalCases[0],
  sensor = "VIIRS_NOAA20_NRT",
  equip = "",
  measurement = "",
  research = "",
  researchResults = [],
  mapMode = "Detail imagery",
  timer,
  observationVersion = 0;
let cfg = {
  crew: 4,
  days: 7,
  array: 8,
  battery: 48,
  load: 1.8,
  water: 64,
  oxygen: 36,
  parts: 3,
  rover: true,
  backup: true,
  roles: [...roles, "Systems engineer", "Geologist"],
  mode: "Earth analog test",
  objective: "Habitat endurance and rover exploration",
};
try {
  const saved = JSON.parse(localStorage.getItem("missionforge-v1"));
  if (saved?.cfg) {
    cfg = saved.cfg;
    site = saved.site;
    profile = saved.profile ?? 0;
    mission = saved.mission;
  }
} catch {}
function save() {
  try {
    localStorage.setItem(
      "missionforge-v1",
      JSON.stringify({ cfg, site, mission, profile }),
    );
  } catch {}
}
function toast(s) {
  notice.textContent = s;
  clearTimeout(timer);
  timer = setTimeout(() => (notice.textContent = ""), 4000);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(28000) });
  if (!r.ok) throw Error();
  return r.json();
}
await Promise.all(
  sites.map(async (s) => {
    try {
      cache[s.id] = await json("/data/" + s.id + ".json");
    } catch {}
  }),
);
const ranking = (s) => rank(s, cache[s.id], profile, query, priority);
const ranked = () =>
  [...sites].sort(
    (a, b) => (ranking(b).score ?? -1) - (ranking(a).score ?? -1),
  );
const annual = (s, k) => {
  const n = cache[s.id]?.properties?.parameter?.[k]?.ANN;
  return Number.isFinite(n) && n > -900 ? n : null;
};
const units = { battery: "kWh", oxygen: "kg", water: "L", food: "kg" };
const resourceName = {
  battery: "Battery",
  oxygen: "Oxygen",
  water: "Water",
  food: "Food",
};
const current = () => obs.get(site.id) || {};
function lensContent() {
  return ["Helmet", "Follow crew"].includes(cameraPreset) && page === "control"
    ? `<div><b>${cameraPreset === "Helmet" ? "HELMET CAM" : "CHASE CAM"}　/　${roster[crewIndex]}</b><span>${dutyPose(mission, crewIndex).status} · ${vitals(mission, crewIndex).pulse} BPM</span></div>${btn("overviewCamera", "Exit camera")}`
    : "";
}
const viewport = () =>
  `<div class="viewport"><div class="crew-lens">${lensContent()}</div><span class="maptag">${page === "control" ? "Surface operations" : "Earth observation"}</span>${page === "home" || page === "discover" ? "" : btn("skip", "Skip camera flight", "skip")}<div class="zoom">${btn("zoomIn", "+")}<button data-act="zoomOut" aria-label="Zoom out">−</button></div>${equip ? `<div class="scene-note">${esc(equip)}</div>` : ""}</div>`;
function home() {
  return `<section class="hero">${viewport()}<div class="heroText">${label("Earth-to-Mars mission preparation")}<h1>Find Earth.<br><em>Prepare for Mars.</em></h1><p>Discover Mars analog sites on Earth, establish a research habitat, and put your crew to the test.</p><div class="actions"><a class="primary" href="#discover">Find a Mars analog site　→</a><a class="quiet" href="#mission">Explore simulation ↗</a></div></div><div class="mapfoot">WGS 84　 /　 NASA BLUE MARBLE</div></section><section class="catalog"><div class="sectionhead"><div>${label("Terrestrial analogs")}<h2>Field site atlas</h2></div>${btn("discover", "Explore all 6 sites　→")}</div><div class="cardgrid">${[sites[0], sites[1], sites[2]].map((s) => `<button class="card" data-act="site:${s.id}"><div class="imageband">${photo(s)}<span class="tag">${s.type.toUpperCase()}</span></div><div class="cardfoot"><div><small>${s.country.toUpperCase()}</small><h3>${s.name}</h3></div><b>↗</b></div></button>`).join("")}</div><div class="foot"><small>Earth is our proving ground.</small><small>Imagery © Esri and contributors</small></div></section>`;
}
function reasoning(s) {
  const r = ranking(s),
    total = r.w.reduce((sum, w, i) => sum + (r.scores[i] === null ? 0 : w), 0);
  if (!total) return "Environmental inputs unavailable.";
  const entries = r.scores.flatMap((value, i) =>
    value === null
      ? []
      : [
          {
            i,
            points: (value * r.w[i]) / total,
            loss: ((100 - value) * r.w[i]) / total,
          },
        ],
  );
  const best = entries.slice().sort((a, b) => b.points - a.points)[0],
    limit = entries.slice().sort((a, b) => b.loss - a.loss)[0];
  const observations = [
    fmt(annual(s, "T2M")) +
      " °C mean, " +
      fmt(annual(s, "PRECTOTCORR"), 2) +
      " mm/day rain",
    s.surface,
    fmt(annual(s, "ALLSKY_SFC_SW_DWN"), 2) + " kWh/m²/day",
    s.isolation + "/100 field estimate",
    s.access + "/100 field estimate",
    fmt(annual(s, "T2M")) + " °C mean",
  ];
  return (
    factors[best.i] +
    " contributes " +
    fmt(best.points) +
    " points (" +
    observations[best.i] +
    "). " +
    (limit.loss > 0.05
      ? factors[limit.i] +
        " costs " +
        fmt(limit.loss) +
        " points relative to a perfect match."
      : "All available criteria meet their targets.")
  );
}
function rows() {
  return ranked()
    .map(
      (s) =>
        `<button class="row" data-act="site:${s.id}">${photo(s)}<span><strong>${s.name}</strong><small>${s.country} · ${s.type}</small><span class="score-reason">${esc(reasoning(s))}</span></span><b>${ranking(s).score ?? "—"}</b></button>`,
    )
    .join("");
}
function discover() {
  return `${label("Site atlas / Discovery")}<h1>Find a field site</h1><p>Rank terrestrial environments against your mission requirements.</p><label class="field">Mission description<input id="query" value="${esc(query)}" placeholder="e.g. A cold volcanic site for rover testing"></label><div class="fields">${select("profile", "Mission profile", profiles, profiles[profile])}${select("priority", "Climate weight", ["Standard", "Double", "Triple"], ["Standard", "Double", "Triple"][priority - 1])}</div><div class="headrow"><h2>Candidate sites</h2><small>Suitability / 100</small></div><p class="note">Scores use the selected mission weights. Each row shows its largest contribution and largest deduction.</p><div id="rankings">${rows()}</div><p class="note">Derived estimates · NASA POWER climate normals and editorial field criteria.</p>${btn("manual", "Evaluate a point on the globe")}</div>`;
}
function breakdown(s) {
  const r = ranking(s);
  return factors
    .map(
      (f, i) =>
        `${line(f, `${r.scores[i] === null ? "Unavailable" : Math.round(r.scores[i]) + " / 100"} · weight ${r.w[i]}`)}${bar(r.scores[i] ?? 0)}`,
    )
    .join("");
}
function coverage(s) {
  const r = ranking(s);
  return Math.round(r.coverage * 100) + "% of weighted criteria available";
}
function terrainText() {
  const t = current().terrain;
  return t
    ? `${fmt(t.height, 0)} m / ${fmt(t.slope)}°`
    : "Terrain samples unavailable";
}
function inspect() {
  const o = current(),
    power = o.power,
    fire = o.fires,
    other = sites.find((s) => s.id === compare) || sites[1];
  return `${btn("discover", "← Candidate sites", "back")}${label(site.country + " / Site inspection")}<h1>${site.name}</h1><small>${coords(site)}</small><p>${site.surface}. ${site.hazard}.</p><div class="actions">${btn("design", "Establish research habitat　→", "primary")}</div><h2>Site suitability</h2>${line(profiles[profile], (ranking(site).score ?? "—") + " / 100")}<details><summary>Scoring factors and comparison</summary><small> · relative suitability model</small>${breakdown(site)}${select(
    "compare",
    "Compare with",
    sites.filter((s) => s.id !== site.id).map((s) => s.name),
    other.name,
  )}${line(other.name, (ranking(other).score ?? "—") + " / 100")}${breakdown(other)}<small>Climate and solar use POWER normals. Geology, isolation and access are editorial estimates. Hazards require independent assessment.</small></details><h2>Environmental profile</h2><small>NASA POWER · Historical climatology, 2001–2025</small>${line("Annual mean temperature", fmt(annual(site, "T2M")) + " °C")}${line("Solar resource", fmt(annual(site, "ALLSKY_SFC_SW_DWN"), 2) + " kWh/m²/day")}${line("Precipitation", fmt(annual(site, "PRECTOTCORR"), 2) + " mm/day")}${line("Wind", fmt(annual(site, "WS2M")) + " m/s")}${line("Elevation / slope", terrainText())}<div class="pills">${btn("imagery", mapMode)}${btn("measure", "Measure distance")}${btn("move", "Choose deployment point")}</div><span class="note">${esc(measurement)}</span><details><summary>Recent surface readings</summary>${power?.values ? `<small>NASA POWER · ${esc(power.date)}</small>` + power.values.map((v) => line(esc(v.label), esc(v.value) + " " + esc(v.unit))).join("") : o.power === null ? "Daily readings unavailable." : "Retrieving NASA POWER readings…"}</details><details><summary>FireWatch and regional events</summary>${select("sensor", "FIRMS sensor", ["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"], sensor)}<p>${fire?.detections ? `${fire.detections.length} detections returned in the regional 10° window, last 24 hours.` : fire === null ? "FIRMS unavailable. A configured key and upstream access are required." : "Retrieving FIRMS observations…"}</p>${(
    fire?.detections ?? []
  )
    .slice(0, 12)
    .map((p) =>
      line(
        esc(p.date) + " " + esc(p.time) + " UTC",
        `${fmt(p.latitude, 2)}, ${fmt(p.longitude, 2)} · ${esc(p.confidence)}`,
      ),
    )
    .join(
      "",
    )}<small>Detection coverage varies. An empty result cannot establish site safety.</small><h3>EONET · within 500 km</h3>${o.events?.map((e) => line(esc(e.title), esc(e.date?.slice(0, 10)))).join("") ?? (o.events === null ? "Event feed unavailable." : "Retrieving events…")}${o.events?.length === 0 ? "No regional events returned." : ""}</details><details><summary>Research evidence</summary><a href="${site.source}" target="_blank" rel="noopener">Field research reference ↗</a><label class="field">Research question<input id="research" maxlength="170" value="${esc(research)}" placeholder="Why test rovers at this site?"></label>${btn("research", "Search publications")}${researchResults.map((r) => `<p><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a><br>${esc(r.snippet)}</p>`).join("")}</details>`;
}
function design() {
  return `${btn("inspect", "← Site inspection", "back")}${label("MF-001 / Mission design")}<h1>Configure expedition</h1><p>${site.name} · ${coords(site)}</p><form id="config"><div class="fields">${num("crew", "Crew members", cfg.crew, 1, 6)}${num("days", "Duration (sols)", cfg.days, 3, 30)}${select("mode", "Environment", ["Earth analog test", "Mars projection"], cfg.mode)}${select("objective", "Objective", ["Habitat endurance and rover exploration", "Geological survey", "Crew survival", "Equipment reliability"], cfg.objective)}</div><details open><summary>Habitat and equipment</summary><div class="fields">${[
    ["array", "Array rating (kW)", 1, 40],
    ["battery", "Battery capacity (kWh)", 1, 300],
    ["load", "Habitat load (kW)", 0.1, 10],
    ["water", "Water (L)", 1, 700],
    ["oxygen", "Oxygen (kg)", 1, 300],
    ["parts", "Repair spares", 0, 20],
  ]
    .map(([id, l, min, max]) =>
      num(id, l, cfg[id], min, max, id === "load" ? 0.1 : 1),
    )
    .join(
      "",
    )}</div>${["rover", "backup"].map((k) => `<label><input id="${k}" type="checkbox" ${cfg[k] ? "checked" : ""}> ${k === "rover" ? "Robotic rover" : "Backup power"}</label>　`).join("")}</details><details><summary>Crew manifest</summary><div class="fields">${roster
    .slice(0, cfg.crew)
    .map((name, i) => select("role" + i, name, roles, cfg.roles[i]))
    .join(
      "",
    )}</div></details><small>Solar input ${fmt(annual(site, "ALLSKY_SFC_SW_DWN") ?? 5, 2)} kWh/m²/day · ${annual(site, "ALLSKY_SFC_SW_DWN") === null ? "demo assumption" : "POWER climatology"}. Mars projection scales available solar energy.</small><div class="actions"><button class="primary" type="submit">Launch mission　→</button></div></form>`;
}
const metrics = (m) =>
  Object.entries(m.resources)
    .map(
      ([k, v]) =>
        `<div class="metric"><small>${resourceName[k]}</small><b>${fmt(v)} <small>${units[k]}</small></b>${bar((v / m.initial[k]) * 100)}</div>`,
    )
    .join("");
function spark(vals) {
  if (vals.length < 2) return "<small>Collecting samples</small>";
  const data = vals.slice(-36),
    lo = Math.min(...data) - 1,
    hi = Math.max(...data) + 1;
  return `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="Trend from ${fmt(data[0])} to ${fmt(data.at(-1))}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${data.map((v, i) => `${(i * 119) / (data.length - 1)},${26 - ((v - lo) / (hi - lo)) * 24}`).join(" ")}"/></svg>`;
}
function pulseMonitor(m, i) {
  const v = vitals(m, i),
    alert = v.status !== "Nominal",
    live = page === "control" && playing && m.outcome === "In progress";
  const beat = "l 11 0 3 -2 4 2 4 0 2 4 3 -22 3 33 3 -17 3 2 4 0 4 -4 5 4 11 0";
  return `<section class="pulse-monitor ${alert ? "attention" : ""}"><header><small>ASTRA / SUIT TELEMETRY</small><small>${live ? "STREAMING" : "HOLD"} · SIMULATED</small></header><div class="pulse-body"><div><strong>${v.pulse}</strong><small>BPM</small></div><svg viewBox="0 0 260 64" role="img" aria-label="Synthetic heartbeat at ${v.pulse} beats per minute"><g style="--beat:${60 / v.pulse}s;animation-play-state:${live ? "running" : "paused"}"><path d="M0 33 ${Array(7).fill(beat).join(" ")}"/></g></svg></div><footer><b>${v.name}</b><span>SpO₂ ${v.spo2}%　·　${v.status}</span></footer></section>`;
}
function crewControls(m) {
  prepareDuties(m);
  crewIndex = Math.min(crewIndex, m.cfg.crew - 1);
  const duty = m.duties[crewIndex],
    station = stations[duty.key];
  return `<section class="crew-ops"><h2>Crew operations</h2><div class="fields">${select("operator", "Astronaut", roster.slice(0, m.cfg.crew), roster[crewIndex])}${select(
    "workorder",
    "Assignment",
    Object.values(stations).map((s) => s.task),
    station.task,
  )}</div>${line(station.name, dutyPose(m, crewIndex).status)}<div class="actions pills">${btn("helmet", "Helmet view")}${btn("follow", "Follow astronaut")}${btn("overviewCamera", "Station overview")}</div></section>`;
}
function workTotals(m) {
  prepareDuties(m);
  return (
    "<h2>Station output</h2>" +
    line(
      "Material stocks",
      fmt(m.inventory.regolith, 0) +
        " kg regolith / " +
        m.inventory.components +
        " components",
    ) +
    line("Greenhouse construction", m.construction + "/4 sections") +
    '<p class="note">Mine 8 kg → fabricate a component using 2 kWh → build a section. Four sections complete the greenhouse.</p>' +
    Object.entries(stations)
      .map(([k, s]) =>
        line(
          s.output,
          fmt(m.production[k], k === "water" ? 2 : 0) + " " + s.unit,
        ),
      )
      .join("")
  );
}
function astra(m) {
  return `<h2>ASTRA crew health</h2>${pulseMonitor(m, Math.min(crewIndex, m.cfg.crew - 1))}<small>Simulated training telemetry · ${m.medkits} medical kits</small>${roster
    .slice(0, m.cfg.crew)
    .map((_, i) => {
      const v = vitals(m, i);
      return `<details ${i === 0 ? "open" : ""}><summary>${v.name} · ${v.status}</summary><p>${v.role}</p>${line("Heart rate / SpO₂", `${v.pulse} bpm / ${v.spo2}%`)}${line("Temperature / hydration", `${v.temp} °C / ${v.hydration}%`)}${line("Fatigue / sleep", `${v.fatigue}% / ${v.sleep} h`)}${i === 0 ? spark(m.history.map((x) => x.hr)) : ""}</details>`;
    })
    .join("")}`;
}
function control() {
  const m = mission;
  prepareDuties(m);
  return `${label("MF-001 / Mission control")}<h1>${site.id === "atacama" ? "Atacama Habitat Expedition" : site.name + " Expedition"}</h1><p>${m.cfg.mode} · ${m.cfg.crew} crew · ${m.cfg.days} sols</p>${line("Mission clock", `SOL ${Math.floor(m.h / SOL) + 1} · ${fmt(m.h, 1)} h elapsed`)}<div class="actions pills">${btn("play", playing ? "Pause" : "Resume")}${btn("hour", "+1 hour")}${btn("sol", "+1 sol")}${btn("speed", speed + "× speed")}${btn("report", "View report ↗")}</div>${crewControls(m)}<div class="metrics">${metrics(m)}</div><div class="pills">${["Systems", "ASTRA", "Log"].map((t) => btn("tab:" + t, (t === tab ? "● " : "") + t)).join("")}</div>${Object.keys(
    m.active,
  )
    .map(
      (id) =>
        `<div class="alert"><strong>${failures[id][0]}</strong><p>${id === "medical" ? esc(m.health) + " · K. Rivera" : "System affected"}</p><div class="pills">${failures[
          id
        ]
          .slice(1)
          .map((v, i) => btn("response:" + id + ":" + (i + 1), v))
          .join("")}</div></div>`,
    )
    .join(
      "",
    )}${tab === "ASTRA" ? astra(m) : tab === "Log" ? timeline(m) : `${workTotals(m)}<h2>Surface systems</h2>${line("Solar generation", fmt(generation(m), 2) + " kW mean")}${line("Habitat demand", fmt(m.cfg.load * m.load, 2) + " kW")}${line("Rover", m.cfg.rover ? (m.active.rover ? "Disabled" : m.traverse ? "Traversing" : "Parked") + " · " + fmt(m.km) + " km" : "Not deployed")}${line("Rover battery", m.cfg.rover ? fmt(((m.roverEnergy ?? 2.4) / 2.4) * 100, 0) + "%" : "Not deployed")}${line("Communications", m.active.comms ? "Interrupted" : "Online")}${line("Repair inventory", m.parts + " spares")}${m.cfg.rover ? btn("traverse", m.traverse ? "Park rover" : "Begin rover traverse") : ""}`}<h2>Scenario controls</h2><div class="fields">${select(
    "incident",
    "Inject failure",
    Object.entries(failures)
      .filter(([k]) => k !== "rover" || cfg.rover)
      .map(([, v]) => v[0]),
    failures[incident][0],
  )}${incident === "medical" ? select("medical", "Training scenario", medicalCases, medical) : ""}</div>${btn("inject", "Trigger incident")}${select("camera", "Camera preset", ["Overview", "Habitat", ...(cfg.rover ? ["Rover"] : []), "Helmet", "Follow crew", "Tactical"], cameraPreset)}<small>Simulated systems · ${m.outcome}</small>`;
}
function timeline(m) {
  return `<h2>Incident timeline</h2>${m.logs
    .slice()
    .reverse()
    .map((l) => line(esc(l.msg), fmt(l.h) + " h"))
    .join("")}`;
}
function report() {
  const m = mission;
  return `<article class="sheet">${label("MF-001 / After-action report")}<h1>${site.name} expedition</h1><p>${esc(m.cfg.objective)} · ${m.cfg.mode} · ${m.cfg.crew} crew</p>${line("Mission outcome", m.outcome)}${line("Elapsed / planned duration", fmt(m.h / SOL, 2) + " / " + m.cfg.days + " sols")}${line("Rover operations", fmt(m.km, 2) + " km")}${line("Energy generated / demanded", fmt(m.generated) + " / " + fmt(m.used) + " kWh")}${line("Objective status", m.outcome === "Planned duration reached" && (!/rover|geolog/i.test(m.cfg.objective) || m.km > 0) ? "Achieved" : "Open")}${workTotals(m)}<h2>Resource balance</h2><table><thead><tr><th>Reserve</th><th>Initial</th><th>Final</th><th>Net change</th></tr></thead><tbody>${Object.entries(
    m.resources,
  )
    .map(
      ([k, v]) =>
        `<tr><td>${resourceName[k]} (${units[k]})</td><td>${fmt(m.initial[k])}</td><td>${fmt(v)}</td><td>${fmt(v - m.initial[k])}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${line("Battery trend", spark(m.history.map((v) => v.battery)))}${timeline(m)}${astra(m)}<p>Deterministic training model. Mean daily irradiance, constant crew demand and simplified health relationships. Mars gravity, radiation and atmospheric exposure are outside this model.</p><div class="actions">${btn("export", "Export report", "primary")}${btn("control", "Return to mission")}${btn("retry", "Retry mission")}${btn("design", "Revise configuration")}${btn("discover", "Compare another site")}</div></article>`;
}
function render() {
  const holder = document.createDocumentFragment();
  holder.append(atlas);
  const mode = page === "control";
  document.body.classList.toggle("dark", mode);
  document.title =
    "MissionForge | " +
    {
      home: "Earth analog atlas",
      discover: "Site discovery",
      inspect: site.name,
      design: "Mission design",
      control: "Mission control",
      report: "After-action report",
    }[page];
  document
    .querySelectorAll(".mast nav a")
    .forEach((a) =>
      a.classList.toggle(
        "active",
        a.hash ===
          "#" +
            (page === "home"
              ? "home"
              : ["inspect", "discover"].includes(page)
                ? "discover"
                : "mission"),
      ),
    );
  if (page === "home") app.innerHTML = home();
  else if (page === "report") app.innerHTML = report();
  else {
    const content = { discover, inspect, design, control }[page];
    app.innerHTML = `<section class="layout"><div class="panel">${content()}</div>${viewport()}</section>`;
  }
  const dest = app.querySelector(".viewport");
  if (dest) dest.prepend(atlas);
  else {
    atlas.hidden = true;
    document.body.append(atlas);
  }
  atlas.hidden = !dest;
}
function update() {
  const panel = app.querySelector(".panel");
  if (!panel) {
    render();
    return;
  }
  const content = { discover, inspect, design, control }[page];
  morphdom(panel, '<div class="panel">' + content() + "</div>", {
    onBeforeElUpdated(oldEl, newEl) {
      if (oldEl.tagName === "DETAILS") newEl.open = oldEl.open;
      if (
        oldEl === document.activeElement &&
        ["INPUT", "SELECT"].includes(oldEl.tagName)
      )
        return false;
      return !oldEl.isEqualNode(newEl);
    },
  });
  const lens = app.querySelector(".crew-lens");
  if (lens) lens.innerHTML = lensContent();
  const sceneNote = app.querySelector(".scene-note");
  if (equip) {
    const el = sceneNote ?? document.createElement("div");
    el.className = "scene-note";
    el.textContent = equip;
    app.querySelector(".viewport").append(el);
  }
}
function go(name) {
  if (location.hash === "#" + name) route();
  else location.hash = name;
}
function displayScene() {
  if (!scene) return;
  if (["home", "discover"].includes(page)) scene.overview();
  else if (page === "inspect") scene.inspect(site);
  else if (["design", "control"].includes(page)) {
    scene.place(site, cfg);
    if (page === "control") scene.sync(mission, playing ? speed : 0);
  }
}
function route() {
  const target = location.hash.slice(1);
  page = [
    "home",
    "discover",
    "inspect",
    "design",
    "control",
    "report",
  ].includes(target)
    ? target
    : target === "mission"
      ? mission
        ? "control"
        : "design"
      : "home";
  if (!mission && ["control", "report"].includes(page)) page = "design";
  if (page !== "control") {
    playing = false;
    scene?.detach();
    cameraPreset = "Overview";
  }
  if (mission && ["control", "report"].includes(page)) {
    site = mission.cfg.site;
    cfg = structuredClone(mission.cfg);
  }
  equip = "";
  render();
  displayScene();
  if (page === "inspect") loadObs();
  window.scrollTo(0, 0);
}
function choose(s) {
  site = s;
  compare =
    sites.find((x) => x.id !== s.id && x.id === "iceland")?.id ?? sites[0].id;
  measurement = "";
  researchResults = [];
  save();
  go("inspect");
}
function dist(a, b) {
  const rad = Math.PI / 180,
    d = (b.lat - a.lat) * rad,
    l = (b.lon - a.lon) * rad;
  return (
    12742 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(d / 2) ** 2 +
            Math.cos(a.lat * rad) *
              Math.cos(b.lat * rad) *
              Math.sin(l / 2) ** 2,
        ),
      ),
    )
  );
}
async function loadObs() {
  const s = site,
    version = ++observationVersion,
    key = s.id,
    qs = `lat=${s.lat}&lon=${s.lon}`;
  let o = obs.get(key);
  if (!o) {
    o = {};
    obs.set(key, o);
  }
  const tasks = {
    ...(s.id.startsWith("point-") && !cache[s.id]
      ? {
          climate: async () =>
            (cache[s.id] = await json("/api/analog/climate?" + qs)),
        }
      : {}),
    power: () => json("/api/nasa/power?" + qs),
    fires: () => json("/api/nasa/fires?" + qs + "&sensor=" + sensor),
    events: async () =>
      (await json("/api/nasa/events")).events.filter(
        (e) => dist(s, { lat: e.latitude, lon: e.longitude }) <= 500,
      ),
    terrain: () => scene?.terrain(s),
  };
  await Promise.all(
    Object.entries(tasks).map(async ([k, fn]) => {
      if (o[k] !== undefined && k !== "terrain") return;
      let result;
      try {
        result = (await fn()) ?? null;
      } catch {
        result = null;
      }
      if (version !== observationVersion) return;
      o[k] = result;
      if (page === "inspect" && site.id === key) {
        if (k === "fires") scene?.fire(result?.detections ?? []);
        if (
          !app.contains(document.activeElement) ||
          document.activeElement.tagName !== "INPUT"
        )
          update();
      }
    }),
  );
  if (page === "inspect" && site.id === key && version === observationVersion)
    scene?.fire(o.fires?.detections ?? []);
}
function launch() {
  incident = "solar";
  crewIndex = 0;
  cameraPreset = "Overview";
  cfg = {
    ...cfg,
    site: { ...site },
    profile: profiles[profile],
    sun: annual(site, "ALLSKY_SFC_SW_DWN") ?? 5,
  };
  mission = start(cfg);
  playing = true;
  tab = "Systems";
  save();
  go("control");
}
function tick(h) {
  advance(mission, h);
  if (mission.outcome !== "In progress") playing = false;
  scene?.sync(mission, playing ? speed : 0);
  save();
  update();
}
app.addEventListener("submit", (e) => {
  if (e.target.id === "config") {
    e.preventDefault();
    launch();
  }
});
app.addEventListener("input", (e) => {
  if (e.target.id === "query") {
    query = e.target.value;
    const count = query.match(
      /\b(one|two|three|four|five|six|[1-6])[- ](?:person|crew|astronaut)/i,
    );
    if (count)
      cfg.crew =
        Number(count[1]) ||
        ["one", "two", "three", "four", "five", "six"].indexOf(
          count[1].toLowerCase(),
        ) + 1;
    profile = interpret(query, profile);
    document.querySelector("#profile").value = profiles[profile];
    document.querySelector("#rankings").innerHTML = rows();
  }
});
app.addEventListener("change", (e) => {
  const { id, value, checked } = e.target;
  if (page === "design") {
    if (id.startsWith("role")) cfg.roles[Number(id.slice(4))] = value;
    else if (["rover", "backup"].includes(id)) cfg[id] = checked;
    else if (["mode", "objective"].includes(id)) cfg[id] = value;
    else if (e.target.checkValidity()) cfg[id] = Number(value);
    else return;
    save();
    if (id === "crew" || id === "rover") {
      update();
      displayScene();
    }
    return;
  }
  if (id === "query") return;
  if (id === "profile") profile = profiles.indexOf(value);
  if (id === "priority")
    priority = ["Standard", "Double", "Triple"].indexOf(value) + 1;
  if (id === "compare") compare = sites.find((s) => s.name === value).id;
  if (id === "incident")
    incident = Object.keys(failures).find((k) => failures[k][0] === value);
  if (id === "medical") medical = value;
  if (id === "sensor") {
    sensor = value;
    delete current().fires;
    loadObs();
  }
  if (id === "operator") {
    crewIndex = roster.indexOf(value);
    if (["Helmet", "Follow crew"].includes(cameraPreset))
      scene?.view(cameraPreset, crewIndex);
    update();
    return;
  }
  if (id === "workorder") {
    const key = Object.keys(stations).find((k) => stations[k].task === value);
    if (assignDuty(mission, crewIndex, key)) {
      log(mission, roster[crewIndex] + " assigned to " + stations[key].name);
      scene?.sync(mission, playing ? speed : 0);
      save();
    }
    update();
    return;
  }
  if (id === "camera") {
    cameraPreset = value;
    scene?.view(value, crewIndex);
    update();
    return;
  }
  if (id === "research") {
    research = value;
    return;
  }
  update();
});
app.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-act]");
  if (!button) return;
  e.preventDefault();
  const [act, id, ix] = button.dataset.act.split(":");
  if (["helmet", "follow", "overviewCamera"].includes(act)) {
    cameraPreset = {
      helmet: "Helmet",
      follow: "Follow crew",
      overviewCamera: "Overview",
    }[act];
    scene?.view(cameraPreset, crewIndex);
    update();
    return;
  }
  if (
    ["home", "discover", "inspect", "design", "control", "report"].includes(act)
  )
    return go(act);
  if (act === "skip") {
    scene?.skip();
    return;
  }
  if (act === "site") return choose(sites.find((s) => s.id === id));
  if (act === "zoomIn" || act === "zoomOut")
    return scene?.zoom(act === "zoomIn" ? 1 : -1);
  if (act === "move") {
    if (!scene) return toast("Earth viewer unavailable");
    toast("Select a nearby deployment point");
    return scene.pick((lon, lat) => {
      if (dist(site, { lon, lat }) > 10)
        return toast("Select a point within 10 km of this site");
      site = { ...site, lon, lat };
      measurement =
        "Deployment point updated. Climate normals describe the regional catalog point.";
      obs.delete(site.id);
      save();
      go("inspect");
    });
  }
  if (act === "manual") {
    if (!scene) return toast("Earth viewer unavailable");
    toast("Select a point on the globe");
    return scene.pick((lon, lat) =>
      choose({
        id: "point-" + lat.toFixed(4) + "-" + lon.toFixed(4),
        name: "Selected field point",
        country: "User defined",
        lat,
        lon,
        type: "Unassessed terrain",
        surface: "Surface classification unavailable",
        hazard: "Local hazards unassessed",
        source: "https://power.larc.nasa.gov/",
      }),
    );
  }
  if (act === "measure") {
    toast("Select a second point on the globe");
    return scene?.pick((lon, lat) => {
      measurement =
        fmt(dist(site, { lon, lat }), 2) +
        " km from site · great-circle estimate";
      update();
    });
  }
  if (act === "imagery") {
    mapMode = scene?.imagery() ? "Detail imagery" : "Blue Marble";
    return update();
  }
  if (act === "research") {
    research = document.querySelector("#research").value;
    const active = site.id;
    button.disabled = true;
    try {
      const r = await json(
        "/api/analog/research?q=" +
          encodeURIComponent(
            (site.name + " " + (research || "Mars analog research")).slice(
              0,
              200,
            ),
          ),
      );
      if (site.id === active) {
        researchResults = r.results;
        update();
        if (!r.results.length) toast("No matching publications found");
      }
    } catch {
      toast(
        "Online search unavailable. Use the linked field research reference.",
      );
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (!mission) return;
  if (act === "retry") return launch();
  if (act === "play") playing = !playing && mission.outcome === "In progress";
  if (act === "hour" || act === "sol") return tick(act === "hour" ? 1 : SOL);
  if (act === "speed") speed = speed === 1 ? 4 : speed === 4 ? 12 : 1;
  if (act === "tab") tab = id;
  if (act === "traverse") {
    if (
      mission.active.rover ||
      mission.active.storm ||
      mission.outcome !== "In progress"
    )
      return toast("Traverse unavailable");
    mission.traverse = !mission.traverse;
    log(mission, mission.traverse ? "Rover traverse started" : "Rover parked");
  }
  if (act === "inject") {
    if (!inject(mission, incident, medical))
      return toast("Incident unavailable or already active");
    if (incident === "medical") tab = "ASTRA";
  }
  if (act === "response") {
    const error = respond(mission, id, Number(ix));
    if (error) toast(error);
  }
  if (act === "export") {
    const data = {
      ...mission,
      elapsedSols: mission.h / SOL,
      resourceChange: Object.fromEntries(
        Object.keys(mission.resources).map((k) => [
          k,
          mission.resources[k] - mission.initial[k],
        ]),
      ),
      crewSummary: roster
        .slice(0, mission.cfg.crew)
        .map((_, i) => vitals(mission, i)),
      assumptions:
        "Simplified deterministic training simulation; see SIMULATION_ASSUMPTIONS.md",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "MF-001-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  scene?.sync(mission, playing ? speed : 0);
  save();
  update();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ["Helmet", "Follow crew"].includes(cameraPreset)) {
    cameraPreset = "Overview";
    scene?.view(cameraPreset);
    update();
  }
});
window.addEventListener("hashchange", route);
route();
try {
  const { createScene } = await import("./scene.js");
  scene = createScene((id) => {
    const s = sites.find((x) => x.id === id);
    if (s) return choose(s);
    if (page === "control" && /^crew[0-9]+$/.test(id)) {
      crewIndex = Number(id.slice(4));
      if (["Helmet", "Follow crew"].includes(cameraPreset))
        scene?.view(cameraPreset, crewIndex);
    }
    equip = id.startsWith("crew")
      ? roster[Number(id.slice(4))] + " · " + cfg.roles[Number(id.slice(4))]
      : id.startsWith("Solar")
        ? "Solar array · " + cfg.array + " kW installed"
        : id === "Rover"
          ? "Robotic exploration rover"
          : id;
    update();
  });
  document.querySelector("#map-status")?.remove();
  displayScene();
} catch (err) {
  console.error("Earth initialization", err);
  document.querySelector("#map-status").textContent =
    "3D Earth unavailable · WebGL 2 required";
}
setInterval(() => {
  if (playing && page === "control" && !document.hidden) tick(0.1 * speed);
}, 3000);
