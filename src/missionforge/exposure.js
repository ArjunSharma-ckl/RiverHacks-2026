import { roverSteel } from './steel-fatigue.js';

const roverFatigueFactor = roverSteel.referenceMpa / roverSteel.predictedMpa;

// Provisional training coefficients. Damage is a normalized condition index.
export const equipment = {
  habitat: ['Habitat', 'Aluminum alloy and composite insulation', 2],
  solar: ['Solar array', 'Cover glass and aluminum frame', 1],
  rover: ['Rover', 'Coated aluminum and steel bearings', 2],
  comms: ['Communications', 'Aluminum reflector and polymer radome', 1],
  science: ['Science module sensors', 'Optical glass and polymer seals', 1],
  oxygen: ['Airlock seals', 'Elastomer and stainless steel', 2],
  thermal: ['Thermal regulation', 'Coated aluminum radiator', 2],
  storage: ['Storage', 'Coated aluminum', 1],
};

export function equipmentIds(m) {
  const facilities = m.cfg.facilities ?? {};
  return Object.keys(equipment).filter(id => {
    if (id === 'rover') return m.cfg.rover && facilities.rover !== false;
    if (id === 'science') return facilities.science !== false;
    if (id === 'storage') return facilities.logistics !== false;
    return true;
  });
}

export function condition(m, id) {
  return m.exposure?.[id] ?? { dust: 0, wear: 0, fatigue: 0, corrosion: 0, hours: 0, rate: 0 };
}

export function damage(c) {
  return Math.min(1, c.wear + c.fatigue + c.corrosion);
}

export function unavailable(m, id) {
  return Boolean(m.active[id]) || damage(condition(m, id)) >= 0.8;
}

export function weather(m) {
  const env = m.environment ?? {};
  const moon = m.cfg.mode === 'Moon projection';
  const mars = m.cfg.mode === 'Mars projection';
  const dust = Math.max(!moon && m.manualStorm ? 0.75 : 0,
    Math.min(1, (env.dust ?? 0) / 100));
  const cloud = moon || mars ? 0 : (env.cloud ?? 0) / 100;
  const humidity = moon || mars ? 0 : (env.humidity ?? 35) / 100;
  const tau = moon ? 0 : dust * (mars ? 3 : 0.8);
  const transmission = Math.exp(-tau) * (1 - 0.75 * cloud);
  return { moon, mars, dust, cloud, humidity, tau, transmission, pressure: moon ? 0 : mars ? 0.6 : 101.3 };
}

export function exposureRates(m, id, w = weather(m)) {
  const env = m.environment ?? {};
  const day = w.moon ? 708.7 : w.mars ? 24.6597 : 24;
  const swing = w.moon ? 105 : w.mars ? 40 : 9;
  const wind = w.moon ? 0 : Math.max(m.manualStorm ? 35 : 0, env.wind ?? 0);
  const temperature = env.temperature ?? 0;
  const cycling = Math.pow(swing / 50, 2) / day;
  const sensitivity = ['solar', 'science', 'thermal'].includes(id) ? 1 : 0.35;
  return {
    deposition: sensitivity * w.dust * (w.moon ? 0.004 : 0.012),
    wear: w.dust * wind * (w.mars ? 0.000012 : 0.000024) * sensitivity,
    fatigue: cycling * (1 + Math.abs(temperature) / 100) * 0.006 *
      (id === 'rover' ? roverFatigueFactor : 1),
    corrosion: Math.max(0, w.humidity - 0.6) * (temperature > 0 ? 0.002 : 0),
  };
}

export function accumulateExposure(m, dt, log) {
  const w = weather(m);
  m.exposure ??= {};
  for (const id of equipmentIds(m)) {
    const c = m.exposure[id] ??= condition(m, id);
    const before = damage(c);
    const { deposition, wear, fatigue, corrosion } = exposureRates(m, id, w);
    c.dust += (1 - c.dust) * -Math.expm1(-deposition * dt);
    c.wear += wear * dt;
    c.fatigue += fatigue * dt;
    c.corrosion += corrosion * dt;
    c.hours += dt;
    c.rate = wear + fatigue + corrosion;
    if (before < 0.8 && damage(c) >= 0.8) log(m, equipment[id][0] + ' reached modeled failure threshold');
  }
}

export function maintenancePlan(m, id) {
  if (!equipmentIds(m).includes(id)) return null;
  const c = condition(m, id);
  if (damage(c) >= 0.05) return { label: 'Replace worn assembly', parts: equipment[id][2], hours: 2 };
  if (c.dust >= 0.04) return { label: 'Clean exposed surfaces', parts: 0, hours: 0.5 };
  return null;
}

export function maintain(m, id, advance, log) {
  const plan = maintenancePlan(m, id);
  if (!plan || m.outcome !== 'In progress') return 'Maintenance unavailable';
  if (m.parts < plan.parts) return 'Insufficient spares';
  const start = m.h;
  advance(m, plan.hours);
  if (m.h - start < plan.hours - 1e-7) {
    log(m, equipment[id][0] + ' service interrupted');
    return 'Mission ended before service completed';
  }
  const c = m.exposure[id];
  c.dust *= 0.08;
  if (plan.parts) {
    c.wear *= 0.15;
    c.corrosion *= 0.15;
    c.fatigue *= 0.15;
  }
  m.parts -= plan.parts;
  log(m, equipment[id][0] + ' · ' + plan.label + ' · ' + plan.parts + ' spares used');
  return 'Service completed';
}

export function equipmentForModel(name) {
  if (name.startsWith('Solar ') || name === 'Extra solar') return 'solar';
  return {
    Habitat: 'habitat', 'Crew quarters': 'habitat', Rover: 'rover',
    Communications: 'comms', 'Extra comms': 'comms',
    'Science module': 'science', 'Geology laboratory': 'science',
    'Airlock seals': 'oxygen', 'Thermal regulation': 'thermal',
    'Logistics depot': 'storage', 'Extra storage': 'storage',
  }[name];
}

// Store compact renderable checkpoints around logged events.
export function recordCheckpoint(m, label) {
  const frame = structuredClone({
    h: m.h, label, environment: m.environment, exposure: m.exposure,
    active: m.active, manualStorm: m.manualStorm, parts: m.parts, battery: m.resources.battery,
  });
  m.checkpoints ??= [];
  m.checkpoints.push(frame);
  if (m.checkpoints.length > 24) m.checkpoints.shift();
}
