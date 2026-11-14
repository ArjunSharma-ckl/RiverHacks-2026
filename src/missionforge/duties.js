// Coordinates are metres east/north of the habitat. Work happens in simulated hours.
export const stations = {
  water: {
    name: "Water reclamation",
    task: "Service recycler",
    output: "Water recovered",
    unit: "L",
    yield: 0.35,
    at: [-10, -7],
    door: [-7, -7],
    model: "recycler",
  },
  lab: {
    name: "Geology laboratory",
    task: "Analyze samples",
    output: "Samples cataloged",
    unit: "samples",
    yield: 1,
    at: [-19, -2],
    door: [-15.5, -2],
    model: "laboratory",
  },
  med: {
    name: "Medical bay",
    task: "Run suit diagnostics",
    output: "Suit checks",
    unit: "checks",
    yield: 1,
    at: [2, -13],
    door: [2, -10],
    model: "medical",
  },
  stores: {
    name: "Logistics depot",
    task: "Inventory supplies",
    output: "Inventory audits",
    unit: "audits",
    yield: 1,
    at: [14, -8],
    door: [11, -7],
    model: "logistics",
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
    door: [26, 15],
    model: "recycler",
  },
  forge: {
    name: "Fabrication workshop",
    task: "Fabricate components",
    output: "Components produced",
    unit: "parts",
    yield: 1,
    at: [21, 4],
    door: [18, 4],
    model: "logistics",
  },
  build: {
    name: "Construction yard",
    task: "Build greenhouse",
    output: "Construction work",
    unit: "sections",
    yield: 1,
    at: [-19, 16],
    door: [-15, 16],
    model: "laboratory",
  },
  power: {
    name: "Battery shelter",
    task: "Inspect power systems",
    output: "Power inspections",
    unit: "checks",
    yield: 1,
    at: [19, 15],
    door: [16, 15],
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
  m.active.storm || m.cfg.facilities?.[{water:'water',lab:'science',med:'medical',stores:'logistics',forge:'fabrication',build:'construction'}[m.duties?.[i]?.key]]===false || (i === 0 && (m.health || m.recoverAt > m.h));
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
  const [x, y] = d.origin,
    dx = dock[0] - x,
    dy = dock[1] - y;
  const returning = phase >= travel + work,
    busy = phase >= travel && !returning;
  return {
    x: x + dx * progress,
    y: y + dy * progress,
    heading: busy
      ? Math.atan2(station.at[0] - dock[0], station.at[1] - dock[1])
      : Math.atan2(dx, dy) + (returning ? Math.PI : 0),
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
    m.cfg.facilities?.[{water:'water',lab:'science',med:'medical',stores:'logistics',forge:'fabrication',build:'construction'}[key]]===false ||
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
    const amount = stations[d.key].yield * completed;
    m.production[d.key] = (m.production[d.key] ?? 0) + amount;
    if (d.key === "water")
      m.resources.water = Math.min(m.initial.water, m.resources.water + amount);
  });
}
