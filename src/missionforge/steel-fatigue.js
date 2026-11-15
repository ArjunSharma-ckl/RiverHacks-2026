import artifact from './steel-fatigue.json' with { type: 'json' };

export function predictSteelFatigue(features) {
  if (features.length !== artifact.features.length || !features.every(Number.isFinite)) {
    throw new TypeError('Expected a complete numeric steel specimen profile');
  }
  const standardized = features.map((value, index) =>
    (value - artifact.center[index]) / artifact.scale[index]);
  let prediction = artifact.bias;
  for (const [index, sample] of artifact.samples.entries()) {
    const squaredDistance = sample.reduce((sum, value, feature) =>
      sum + (value - standardized[feature]) ** 2, 0);
    const radius = Math.sqrt(3 * squaredDistance) / artifact.width;
    const similarity = artifact.family === 'RBF'
      ? Math.exp(-squaredDistance / (2 * artifact.width ** 2))
      : (1 + radius) * Math.exp(-radius);
    prediction += artifact.coefficients[index] * similarity;
  }
  return prediction;
}

// The rover bearing is a laboratory-steel scenario proxy. Use the measured
// strength estimate as a relative fatigue resistance input, not a life curve.
export const roverSteel = {
  predictedMpa: predictSteelFatigue(artifact.profile),
  referenceMpa: artifact.referenceMpa,
  testRmseMpa: artifact.metrics.testRmseMpa,
  testR2: artifact.metrics.testR2,
};

// Candidate specifications, taken from the training set itself rather than
// invented: each one is a real specimen from the NIMS fatigue dataset, with its
// own composition and heat treatment, run back through the model. Picking a
// spread across the predicted range gives the mission a set of genuinely
// different steels to build load-bearing assemblies from.
const index = (name) => artifact.features.indexOf(name);
const RAW = (sample) => sample.map((value, i) => value * artifact.scale[i] + artifact.center[i]);
const TEMPER_T = index('Tempering Temperature'), TEMPER_MIN = index('Tempering Time');
const HARDEN_T = index('Through Hardening Temperature'), REDUCTION = index('Reduction Ratio (Ingot to Bar)');

// Described by heat treatment alone. The composition columns in this dataset
// are supplied pre-scaled, so printing them as weight percentages would be
// inventing units the data does not carry.
function describe(raw) {
  const at = (i) => (i >= 0 && Number.isFinite(raw[i]) ? Math.round(raw[i]) : null);
  const temper = at(TEMPER_T), time = at(TEMPER_MIN), harden = at(HARDEN_T), ratio = at(REDUCTION);
  return [
    temper && temper > 100 ? 'tempered ' + temper + ' °C' + (time ? ' for ' + time + ' min' : '') : 'untempered',
    harden && harden > 100 ? 'hardened ' + harden + ' °C' : null,
    ratio ? 'reduction ratio ' + ratio : null,
  ].filter(Boolean).join(' · ');
}

function catalogue() {
  const seen = new Map();
  for (let i = 0; i < artifact.samples.length; i += 7) {
    const raw = RAW(artifact.samples[i]);
    const predictedMpa = predictSteelFatigue(raw);
    if (!Number.isFinite(predictedMpa) || predictedMpa <= 0) continue;
    seen.set(Math.round(predictedMpa), { predictedMpa, detail: describe(raw) });
  }
  const sorted = [...seen.values()].sort((a, b) => a.predictedMpa - b.predictedMpa);
  if (!sorted.length) return [];
  // Four specimens spread evenly across the predicted range.
  return [0, 1, 2, 3]
    .map((k) => sorted[Math.round((k / 3) * (sorted.length - 1))])
    .filter((item, k, all) => all.indexOf(item) === k);
}

export const STEEL_SPECS = [
  {
    id: 'reference',
    name: 'Reference bearing steel',
    predictedMpa: predictSteelFatigue(artifact.profile),
    detail: describe(artifact.profile),
  },
  ...catalogue().map((item, k) => ({
    id: 'spec-' + (k + 1),
    name: ['Low-cycle grade', 'Standard grade', 'Uprated grade', 'High-endurance grade'][k] || 'Grade ' + (k + 1),
    predictedMpa: item.predictedMpa,
    detail: item.detail,
  })),
];

export function steelSpec(id) {
  return STEEL_SPECS.find((spec) => spec.id === id) ?? STEEL_SPECS[0];
}
