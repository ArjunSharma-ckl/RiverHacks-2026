// Boundary for the forthcoming materials model. Only validated numeric outputs
// enter the simulation; no material properties are guessed in this adapter.
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
