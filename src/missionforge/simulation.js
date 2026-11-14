export const SOL = 24.6597;
export const roster = [
  "K. Rivera",
  "A. Chen",
  "J. Okafor",
  "M. Anders",
  "S. Patel",
  "N. Silva",
];
export const roles = [
  "Commander",
  "Systems engineer",
  "Medical officer",
  "Geologist",
];
export const failures = {
  solar: [
    "Solar array failure",
    "Replace controller",
    "Shed nonessential loads",
    "Switch to backup power",
  ],
  oxygen: [
    "Oxygen leak",
    "Seal manifold",
    "Isolate compartment",
    "Open emergency reserve",
  ],
  rover: [
    "Rover breakdown",
    "Dispatch repair",
    "Attempt remote recovery",
    "Cancel traverse",
  ],
  comms: [
    "Communications blackout",
    "Replace transceiver",
    "Activate backup link",
    "Continue autonomously",
  ],
  storm: [
    "Dust storm",
    "Shelter until clear",
    "Secure outside equipment",
    "Suspend traverse",
  ],
  medical: [
    "Crew medical concern",
    "Pause EVA and monitor",
    "Use training medical kit",
    "Reassign duty",
  ],
};
export const medicalCases = [
  "Dehydration",
  "Fatigue",
  "Hypoxia drill",
  "Minor injury",
  "Sleep deprivation",
];
export function start(cfg) {
  const resources = {
    battery: cfg.battery,
    oxygen: cfg.oxygen,
    water: cfg.water,
    food: cfg.crew * cfg.days * 0.8 + 3,
  };
  return {
    cfg: structuredClone(cfg),
    h: 0,
    resources,
    initial: { ...resources },
    generated: 0,
    used: 0,
    km: 0,
    traverse: false,
    parts: cfg.parts,
    backup: cfg.backup ? 20 : 0,
    medkits: 2,
    active: {},
    mitigated: {},
    health: null,
    recoverAt: 0,
    load: 1,
    logs: [{ h: 0, msg: "Habitat commissioned. Crew on station." }],
    history: [],
    outcome: "In progress",
  };
}
export const log = (s, msg) => s.logs.push({ h: s.h, msg });
export function generation(s) {
  return (
    ((s.cfg.array * s.cfg.sun) / 24) *
    (s.cfg.mode === "Mars projection" ? 0.43 : 1) *
    (s.active.solar ? 0.15 : 1) *
    (s.active.storm ? 0.35 : 1)
  );
}
export function vitals(s, i) {
  const incident = i === 0 ? s.health : null,
    shift = (s.h + i * 2) % 24,
    fatigue = Math.min(
      100,
      20 +
        shift * 1.5 +
        (s.traverse ? 10 : 0) +
        (incident === "Fatigue" ? 34 : 0),
    );
  const stress = incident ? 18 : 0;
  return {
    name: roster[i],
    role: s.cfg.roles[i],
    pulse: Math.round(66 + fatigue * 0.24 + stress),
    spo2: incident === "Hypoxia drill" ? 89 : 98,
    temp: (36.6 + stress * 0.025).toFixed(1),
    fatigue: Math.round(fatigue),
    hydration: Math.round(
      92 - shift * 0.4 - (incident === "Dehydration" ? 27 : 0),
    ),
    sleep: incident === "Sleep deprivation" ? 3 : 7.5,
    status: incident || (!i && s.recoverAt > s.h ? "In recovery" : "Nominal"),
  };
}
export function advance(s, hours) {
  if (!Number.isFinite(hours) || hours <= 0 || s.outcome !== "In progress")
    return;
  let left = Math.min(hours, s.cfg.days * SOL - s.h);
  while (left > 1e-8) {
    const dt = Math.min(1, left),
      n = s.cfg.crew,
      r = s.resources;
    const moving =
      s.traverse && !s.active.rover && !s.active.storm && s.cfg.rover;
    const supply = generation(s) * dt,
      demand = (s.cfg.load * s.load + (moving ? 0.32 : 0)) * dt;
    const backup = s.mitigated.solar
      ? Math.min(s.backup, Math.max(0, demand - supply))
      : 0;
    s.backup -= backup;
    s.generated += supply;
    s.used += demand;
    r.battery = Math.max(
      0,
      Math.min(s.cfg.battery, r.battery + supply + backup - demand),
    );
    r.oxygen = Math.max(
      0,
      r.oxygen -
        ((n * 0.84) / 24 +
          (s.active.oxygen ? (s.mitigated.oxygen ? 0.09 : 0.38) : 0)) *
          dt,
    );
    r.water = Math.max(0, r.water - ((n * 1.6) / 24) * dt);
    r.food = Math.max(0, r.food - ((n * 0.64) / 24) * dt);
    if (moving) s.km += dt * 0.22;
    s.h += dt;
    left -= dt;
    if (Object.values(r).some((v) => v <= 0)) {
      s.outcome = "Aborted · reserve depleted";
      break;
    }
  }
  if (s.h >= s.cfg.days * SOL - 1e-7 && s.outcome === "In progress")
    s.outcome = "Planned duration reached";
  s.history.push({
    h: s.h,
    battery: s.resources.battery,
    hr: vitals(s, 0).pulse,
  });
  if (s.outcome !== "In progress") log(s, s.outcome);
}
export function inject(s, id, medical = "Dehydration") {
  if (
    !failures[id] ||
    s.active[id] ||
    s.outcome !== "In progress" ||
    (id === "rover" && !s.cfg.rover)
  )
    return false;
  s.active[id] = true;
  if (id === "medical") s.health = medical;
  log(s, failures[id][0] + (id === "medical" ? " · " + medical : ""));
  return true;
}
export function respond(s, id, index) {
  if (
    !s.active[id] ||
    ![1, 2, 3].includes(index) ||
    s.outcome !== "In progress"
  )
    return;
  let consequence = "System restored";
  if (index === 1 && ["solar", "oxygen", "rover", "comms"].includes(id)) {
    if (s.parts <= 0) return "No spare parts remaining";
    s.parts--;
    consequence = "One spare part consumed";
  } else if (id === "solar") {
    if (index === 3 && s.backup <= 0) return "Backup power unavailable";
    if (index === 2) s.load = 0.65;
    s.mitigated.solar = index === 3;
    consequence =
      index === 2 ? "Habitat load reduced 35%" : "Backup reserve engaged";
  } else if (id === "oxygen") {
    if (index === 2) s.mitigated.oxygen = true;
    else {
      if (s.mitigated.reserve) return "Emergency reserve already used";
      s.resources.oxygen += 3;
      s.mitigated.reserve = true;
    }
    consequence =
      index === 2 ? "Leak rate reduced" : "3 kg reserve transferred";
  } else if (id === "medical") {
    if (index === 2 && s.medkits <= 0) return "Training medical kits exhausted";
    if (index === 2) s.medkits--;
    s.health = null;
    s.recoverAt = s.h + (index === 2 ? 2 : 6);
    if (index === 1) s.traverse = false;
    consequence = "Crew member under follow-up monitoring";
  } else if (id === "storm") {
    s.traverse = false;
    consequence = "External work suspended";
  } else if (id === "rover" && index === 3) {
    s.traverse = false;
    consequence = "Rover parked";
  } else if (id === "comms" && index === 3) {
    consequence = "Local operations only";
  }
  const persists =
    (["solar", "oxygen"].includes(id) && index !== 1) ||
    (id === "storm" && index !== 1) ||
    (["rover", "comms"].includes(id) && index === 3);
  if (!persists) delete s.active[id];
  log(s, failures[id][index] + " · " + consequence);
  if (id === "storm" && index === 1) advance(s, 4);
}
