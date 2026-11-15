import { condition, unavailable } from './exposure.js';
// Coordinates are metres east/north of the habitat. Work happens in simulated hours.
import { pointOnRoute, walkRoute } from "./navigation.js";

export const stations = {
  water: {
    name: "Water reclamation",
    task: "Service recycler",
    output: "Water recovered",
    unit: "L",
    yield: 0.35,
    at: [-18, -9],
    door: [-13, -9],
    model: "recycler",
  },
  lab: {
    name: "Geology laboratory",
    task: "Analyze samples",
    output: "Samples cataloged",
    unit: "samples",
    yield: 1,
    at: [-19, -2],
    door: [-13.5, -2],
    model: "laboratory",
  },
  med: {
    name: "Medical bay",
    task: "Run suit diagnostics",
    output: "Suit checks",
    unit: "checks",
    yield: 1,
    at: [5, -13],
    door: [1.3, -13],
    model: "medical",
  },
  stores: {
    name: "Logistics depot",
    task: "Inventory supplies",
    output: "Inventory audits",
    unit: "audits",
    yield: 1,
    at: [14, -8],
    door: [8.4, -8],
    model: "logistics",
  },
  bio: {
    name: "Biology lab",
    task: "Culture samples",
    output: "Bio samples",
    unit: "samples",
    yield: 1,
    at: [48, 14],
    door: [44.1, 14],
    model: "laboratory",
  },
  chem: {
    name: "Chemistry lab",
    task: "Run chemistry assay",
    output: "Assays completed",
    unit: "assays",
    yield: 1,
    at: [48, 26],
    door: [44.1, 26],
    model: "laboratory",
  },
  transport1: {
    name: "Crew transport 1",
    task: "Preflight crew transport",
    output: "Transport checks",
    unit: "checks",
    yield: 1,
    at: [12, -20],
    door: [12, -21.4],
    model: "space-car",
  },
  transport2: {
    name: "Crew transport 2",
    task: "Preflight crew transport",
    output: "Transport checks",
    unit: "checks",
    yield: 1,
    at: [-10, 22],
    door: [-10, 20.6],
    model: "space-car",
  },
};
Object.assign(stations, {
  mine: {
    name: "Regolith excavation",
    task: "Mine regolith",
    output: "Regolith extracted",
    unit: "kg",
    yield: 4,
    at: [29, 17],
    door: [24.5, 17],
    model: "recycler",
  },
  forge: {
    name: "Fabrication workshop",
    task: "Fabricate components",
    output: "Components produced",
    unit: "parts",
    yield: 1,
    at: [28, 4],
    door: [22.4, 4],
    model: "logistics",
  },
  build: {
    name: "Construction yard",
    task: "Build greenhouse",
    output: "Construction work",
    unit: "sections",
    yield: 1,
    at: [-19, 16],
    door: [-19, 14.3],
    model: "laboratory",
  },
  power: {
    name: "Battery shelter",
    task: "Inspect power systems",
    output: "Power inspections",
    unit: "checks",
    yield: 1,
    at: [19, 15],
    door: [19, 13.2],
    model: "medical",
  },
});
const defaultDuty = (role) =>
  ({
    Commander: "stores",
    "Systems engineer": "water",
    "Medical officer": "med",
    Geologist: "lab",
  })[role] ?? "lab";
export function prepareDuties(m) {
  if (!m.duties)
    m.duties = Array.from({ length: m.cfg.crew }, (_, i) => ({
      key: defaultDuty(m.cfg.roles[i]),
      elapsed: 0,
      origin: [-3 + i * 1.25, -4],
      cycles: 0,
    }));
  m.inventory ??= { regolith: 0, components: 0 };
  m.construction ??= 0;
  for (const key of Object.keys(stations)) {
    if (m.production) m.production[key] ??= 0;
  }
  m.production ??= { water: 0, lab: 0, med: 0, stores: 0 };
}
export const offDuty = (m, i) =>
  m.active.storm || m.cfg.facilities?.[{water:'water',lab:'science',med:'medical',stores:'logistics',forge:'fabrication',build:'construction',bio:'science',chem:'science'}[m.duties?.[i]?.key]]===false || (i === 0 && (m.health || m.recoverAt > m.h));
const travel = 0.2,
  work = 0.55,
  cycle = travel * 2 + work;
export function dutyPose(m, i, ahead = 0) {
  const d = m.duties[i],
    station = stations[d.key],
    dock = [
      station.door[0] + (i % 3) * 0.52,
      station.door[1] + Math.floor(i / 3) * 0.55,
    ];
  const paused = offDuty(m, i),
    phase = (d.elapsed + (paused ? 0 : ahead)) % cycle;
  const progress =
    phase < travel
      ? phase / travel
      : phase < travel + work
        ? 1
        : 1 - (phase - travel - work) / travel;
  const routeKey = `${d.key}|${i}|${d.origin[0].toFixed(2)}|${d.origin[1].toFixed(2)}`;
  if (d.routeKey !== routeKey) {
    d.route = walkRoute(d.origin, dock);
    d.routeKey = routeKey;
  }
  const returning = phase >= travel + work,
    busy = phase >= travel && !returning;
  const point = pointOnRoute(d.route, returning ? 1 - progress : progress);
  return {
    x: point.x,
    y: point.y,
    heading: busy
      ? Math.atan2(station.at[0] - dock[0], station.at[1] - dock[1])
      : point.heading + (returning ? Math.PI : 0),
    working: !paused && busy,
    walking: !paused && !busy,
    status: paused
      ? m.active.storm
        ? "Sheltering"
        : "Off duty"
      : busy
        ? station.task
        : returning
          ? "Returning to habitat"
          : "Walking to " + station.name,
  };
}
export function assignDuty(m, i, key) {
  prepareDuties(m);
  if (
    !m.duties[i] ||
    !stations[key] ||
    m.cfg.facilities?.[{water:'water',lab:'science',med:'medical',stores:'logistics',forge:'fabrication',build:'construction',bio:'science',chem:'science'}[key]]===false ||
    key === m.duties[i].key ||
    m.outcome !== "In progress"
  )
    return false;
  const { x, y } = dutyPose(m, i);
  Object.assign(m.duties[i], { key, elapsed: 0, origin: [x, y] });
  return true;
}
export function advanceDuties(m, dt) {
  prepareDuties(m);
  m.duties.forEach((d, i) => {
    if (m.active.storm || offDuty(m,i) || (i === 0 && m.health)) return;
    const science = ['lab', 'bio', 'chem'].includes(d.key);
    if ((science && (m.powerLimited || unavailable(m, 'science'))) ||
        (d.key === 'stores' && unavailable(m, 'storage'))) return;
    const hours =
      i === 0 ? Math.max(0, dt - Math.max(0, m.recoverAt - m.h)) : dt;
    // Credit each work interval exactly once, including multi-hour manual steps.
    const count = (t) => Math.floor((t + travel + 1e-9) / cycle);
    const done = count(d.elapsed + hours) - count(d.elapsed);
    d.elapsed += hours;
    if (!done) return;
    d.cycles += done;
    let completed = done;
    if (d.key === "mine") m.inventory.regolith += 4 * done;
    if (d.key === "forge") {
      completed = Math.min(
        done,
        Math.floor(m.inventory.regolith / 8),
        Math.floor(m.resources.battery / 2),
      );
      m.inventory.regolith -= completed * 8;
      m.resources.battery -= completed * 2;
      m.inventory.components += completed;
    }
    if (d.key === "build") {
      completed = Math.min(
        done,
        m.inventory.components,
        Math.max(0, 4 - m.construction),
      );
      m.inventory.components -= completed;
      m.construction += completed;
    }
    const amount = stations[d.key].yield * completed * (science ? 1 - condition(m, 'science').dust : 1);
    m.production[d.key] = (m.production[d.key] ?? 0) + amount;
    if (d.key === "water")
      m.resources.water = Math.min(m.initial.water, m.resources.water + amount);
  });
}
