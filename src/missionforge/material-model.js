import { roverSteel, steelSpec } from './steel-fatigue.js';

// Boundary for the materials model. Only validated numeric outputs enter the
// simulation; no material properties are guessed in this adapter.

// Assemblies whose fatigue life the steel model has any claim on. The rest are
// aluminium, glass and polymer, and a rotating-bending steel model says
// nothing about those, so their rates are left alone.
export const STEEL_ASSEMBLIES = {
  rover: 'Steel wheel bearings and drive shafts',
  oxygen: 'Stainless airlock seal races',
  thermal: 'Radiator mounting frames',
};

// The chosen specimen's predicted fatigue strength, relative to the dataset's
// reference specimen, used as a relative fatigue-resistance factor. A stronger
// steel accumulates modelled fatigue more slowly. This is a proxy, not an S-N
// life calculation.
export function steelFatigueFactor(mission, id) {
  if (!(id in STEEL_ASSEMBLIES)) return 1;
  const spec = steelSpec(mission?.materialSpec);
  const predicted = Number.isFinite(spec?.predictedMpa) && spec.predictedMpa > 0
    ? spec.predictedMpa : roverSteel.predictedMpa;
  return roverSteel.referenceMpa / predicted;
}

export function selectedSteel(mission) {
  return steelSpec(mission?.materialSpec);
}
export function applyMaterialAssessment(mission, payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.facilities)) throw Error('Invalid materials assessment');
  const facilities = {};
  for (const row of payload.facilities) {
    if (typeof row.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(row.id)) continue;
    const factor = row.thermalLoadMultiplier;
    if (!Number.isFinite(factor) || factor < 0.5 || factor > 3) continue;
    facilities[row.id] = {thermalLoadMultiplier:factor,material:String(row.material||''),modelVersion:String(payload.modelVersion||'')};
  }
  mission.materialAssessment = {version:1,facilities};
  return mission.materialAssessment;
}

export function habitatThermalFactor(mission) {
  return mission.materialAssessment?.facilities?.habitat?.thermalLoadMultiplier ?? 1;
}
