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
