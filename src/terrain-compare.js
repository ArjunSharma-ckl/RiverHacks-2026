const maximumSampleSize = 33;
const minimumMeasuredRelief = 1;

function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

function dimensions(grid) {
  const { widthMetres, heightMetres } = grid;
  return Number.isFinite(widthMetres) && widthMetres > 0 && Number.isFinite(heightMetres) && heightMetres > 0
    ? { widthMetres, heightMetres }
    : undefined;
}

function comparableSize(grid, relativeDepth) {
  const extent = dimensions(grid);
  const spacing = Array.isArray(grid.nativeResolutionMetres)
    ? Math.max(...grid.nativeResolutionMetres.flat())
    : grid.nativeResolutionMetres;
  if (relativeDepth || !extent || !Number.isFinite(spacing) || spacing <= 0) return maximumSampleSize;
  const nativeIntervals = Math.floor(Math.min(extent.widthMetres, extent.heightMetres) / spacing);
  return Math.max(9, Math.min(maximumSampleSize, nativeIntervals + 1));
}

function resample(values, size, targetSize) {
  const samples = [];
  for (let row = 0; row < targetSize; row++) {
    const y = row * (size - 1) / (targetSize - 1);
    const top = Math.min(size - 2, Math.floor(y));
    const fy = y - top;
    for (let col = 0; col < targetSize; col++) {
      const x = col * (size - 1) / (targetSize - 1);
      const left = Math.min(size - 2, Math.floor(x));
      const fx = x - left;
      const a = top * size + left;
      const b = a + size;
      samples.push((1 - fy) * ((1 - fx) * values[a] + fx * values[a + 1]) +
        fy * ((1 - fx) * values[b] + fx * values[b + 1]));
    }
  }
  return samples;
}

function smoothForSampling(values, size, targetSize) {
  // The catalog is sampled at a finer spacing than some planetary sources.
  // Smooth both windows before decimation to reduce aliasing in the slopes.
  const radius = Math.floor((size - 1) / (2 * (targetSize - 1)));
  if (radius < 2) return values;
  const totals = new Float64Array((size + 1) ** 2);
  const stride = size + 1;
  for (let row = 1; row <= size; row++) {
    let rowSum = 0;
    for (let col = 1; col <= size; col++) {
      rowSum += values[(row - 1) * size + col - 1];
      totals[row * stride + col] = totals[(row - 1) * stride + col] + rowSum;
    }
  }
  return Array.from(values, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const top = Math.max(0, row - radius);
    const bottom = Math.min(size, row + radius + 1);
    const left = Math.max(0, col - radius);
    const right = Math.min(size, col + radius + 1);
    const sum = totals[bottom * stride + right] - totals[top * stride + right] -
      totals[bottom * stride + left] + totals[top * stride + left];
    return sum / ((right - left) * (bottom - top));
  });
}

function describeShape(values, size) {
  const ordered = [...values].sort((a, b) => a - b);
  const lower = percentile(ordered, 0.05);
  const upper = percentile(ordered, 0.95);
  const relief = upper - lower;
  if (relief <= Math.max(Math.abs(lower), Math.abs(upper), Number.MIN_VALUE) * 1e-9) return;

  const normalized = values.map(value => Math.max(-0.2, Math.min(1.2, (value - lower) / relief)));
  const gradients = [];
  const curvature = [];
  for (let row = 1; row < size - 1; row++) {
    for (let col = 1; col < size - 1; col++) {
      const i = row * size + col;
      const east = normalized[i + 1];
      const west = normalized[i - 1];
      const north = normalized[i - size];
      const south = normalized[i + size];
      gradients.push(Math.hypot(east - west, north - south) * (size - 1) / 2);
      curvature.push(normalized[i] - (east + west + north + south) / 4);
    }
  }
  gradients.sort((a, b) => a - b);
  curvature.sort((a, b) => a - b);
  return {
    normalized,
    heightDistribution: [0.2, 0.35, 0.5, 0.65, 0.8].map(q => (percentile(ordered, q) - lower) / relief),
    gradients: [0.25, 0.5, 0.75, 0.9].map(q => percentile(gradients, q)),
    ridgeContrast: Math.max(0, percentile(curvature, 0.9)),
    valleyContrast: Math.max(0, -percentile(curvature, 0.1)),
    relief,
  };
}

function physicalSlope(values, size, { widthMetres, heightMetres }) {
  const slopes = [];
  const dx = 2 * widthMetres / (size - 1);
  const dy = 2 * heightMetres / (size - 1);
  for (let row = 1; row < size - 1; row++) {
    for (let col = 1; col < size - 1; col++) {
      const i = row * size + col;
      const east = (values[i + 1] - values[i - 1]) / dx;
      const north = (values[i - size] - values[i + size]) / dy;
      slopes.push(Math.atan(Math.hypot(east, north)) * 180 / Math.PI);
    }
  }
  slopes.sort((a, b) => a - b);
  return [percentile(slopes, 0.5), percentile(slopes, 0.9)];
}

function describeGrid(grid, relativeDepth, sampleSize) {
  if (!grid || !Number.isInteger(grid.size) || grid.size < 9 || grid.size > 513 ||
      grid.values?.length !== grid.size ** 2 || !grid.values.every(Number.isFinite)) return;
  const samples = resample(smoothForSampling(grid.values, grid.size, sampleSize), grid.size, sampleSize);
  const fine = describeShape(samples, sampleSize);
  if (!fine || (!relativeDepth && fine.relief < minimumMeasuredRelief)) return;
  // Average neighborhoods before downsampling so coarse metrics emphasize
  // landforms that persist when small features are removed.
  const blurred = samples.map((value, i) => {
    const row = Math.floor(i / sampleSize);
    const col = i % sampleSize;
    if (row === 0 || col === 0 || row === sampleSize - 1 || col === sampleSize - 1) return value;
    return (value * 4 + samples[i - 1] + samples[i + 1] + samples[i - sampleSize] + samples[i + sampleSize]) / 8;
  });
  const broadSize = Math.ceil(sampleSize / 2);
  const broad = describeShape(resample(blurred, sampleSize, broadSize), broadSize);
  if (!broad) return;
  const extent = dimensions(grid);
  return { fine, broad, extent, slopes: extent && !relativeDepth ? physicalSlope(samples, sampleSize, extent) : undefined };
}

function logDifference(a, b, floor) {
  return Math.abs(Math.log((a + floor) / (b + floor)));
}

function meanDifference(a, b, difference) {
  return a.reduce((sum, value, i) => sum + difference(value, b[i]), 0) / a.length;
}

function alignmentError(left, right, size) {
  const errors = [0, 0, 0, 0];
  const edge = size - 1;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const value = left[row * size + col];
      errors[0] += (value - right[row * size + col]) ** 2;
      errors[1] += (value - right[col * size + edge - row]) ** 2;
      errors[2] += (value - right[(edge - row) * size + edge - col]) ** 2;
      errors[3] += (value - right[(edge - col) * size + row]) ** 2;
    }
  }
  return Math.sqrt(Math.min(...errors) / left.length);
}

function shapeDistance(query, reference) {
  const elevation = meanDifference(query.heightDistribution, reference.heightDistribution,
    (a, b) => Math.abs(a - b));
  const grade = meanDifference(query.gradients, reference.gradients,
    (a, b) => logDifference(a, b, 0.15));
  const ridge = logDifference(query.ridgeContrast, reference.ridgeContrast, 0.005);
  const valley = logDifference(query.valleyContrast, reference.valleyContrast, 0.005);
  return 0.9 * elevation + 0.35 * grade + 0.125 * (ridge + valley);
}

function describeDifference(query, reference, relativeDepth, sampleSize) {
  const fine = shapeDistance(query.fine, reference.fine);
  const broad = shapeDistance(query.broad, reference.broad);
  const alignment = alignmentError(query.fine.normalized, reference.fine.normalized, sampleSize);
  const differences = [
    { label: 'Typical normalized gradient', query: query.fine.gradients[1], reference: reference.fine.gradients[1], unit: 'relief / patch width' },
    { label: 'Upper-decile normalized gradient', query: query.fine.gradients[3], reference: reference.fine.gradients[3], unit: 'relief / patch width' },
    { label: 'Ridge contrast', query: query.fine.ridgeContrast, reference: reference.fine.ridgeContrast, unit: 'fraction of relief' },
    { label: 'Valley contrast', query: query.fine.valleyContrast, reference: reference.fine.valleyContrast, unit: 'fraction of relief' },
  ];
  let physicalDistance = 0;
  let scaleGap;
  let reliefGap;
  let slopeGap;
  if (!relativeDepth) {
    differences.push({ label: 'Elevation relief, 5th–95th percentile', query: query.fine.relief, reference: reference.fine.relief, unit: 'm' });
    reliefGap = logDifference(query.fine.relief, reference.fine.relief, 0);
    physicalDistance = 0.20 * reliefGap;
    if (query.extent && reference.extent) {
      const querySize = Math.sqrt(query.extent.widthMetres * query.extent.heightMetres);
      const refSize = Math.sqrt(reference.extent.widthMetres * reference.extent.heightMetres);
      scaleGap = logDifference(querySize, refSize, 0);
      slopeGap = Math.abs(query.slopes[1] - reference.slopes[1]);
      physicalDistance += 0.12 * scaleGap + 0.015 * slopeGap;
      differences.push(
        { label: 'Equivalent patch width', query: querySize, reference: refSize, unit: 'm' },
        { label: 'Typical slope', query: query.slopes[0], reference: reference.slopes[0], unit: '°' },
        { label: 'Upper-decile slope', query: query.slopes[1], reference: reference.slopes[1], unit: '°' },
      );
    }
  }
  return { fine, broad, alignment, scaleGap, reliefGap, slopeGap, differences, sampleSize,
    distance: fine * 0.40 + broad * 0.35 + alignment * 0.25 + physicalDistance };
}

/**
 * Rank sampled terrain windows. A smaller morphology distance is closer.
 * Numerical gates are conservative prototype rules and carry no probabilistic meaning.
 */
export function compareTerrain(queryGrid, references, { relativeDepth = false } = {}) {
  const sampleSize = queryGrid ? comparableSize(queryGrid, relativeDepth) : maximumSampleSize;
  const query = describeGrid(queryGrid, relativeDepth, sampleSize);
  if (!query) {
    return { status: 'no_match', reason: 'The input contains too little measurable relief or has an invalid elevation grid.', candidates: [] };
  }
  const candidates = [];
  for (const site of references) {
    const reference = describeGrid(site, false, sampleSize);
    if (reference) candidates.push({ site, ...describeDifference(query, reference, relativeDepth, sampleSize) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const [top, second] = candidates;
  if (!top) return { status: 'no_match', reason: 'The terrain catalog has no comparable reference grids.', candidates };
  const noMatch = reason => ({ status: 'no_match', reason, top, candidates });
  if (relativeDepth) {
    return noMatch('A single image gives relative camera depth. The shortlist is exploratory until it can be checked against measured planetary elevation.');
  }
  const duplicateGrid = top.alignment < 1e-4 && top.reliefGap < 1e-4 &&
    (top.scaleGap === undefined || top.scaleGap < 1e-4) && (top.slopeGap === undefined || top.slopeGap < 0.01);
  if (!duplicateGrid && top.scaleGap === undefined) {
    return noMatch('The elevation grid needs a horizontal footprint in metres to confirm a terrain match.');
  }
  // These gates limit relief and patch width to a factor of two. Agreement
  // at two resolutions and a lead over the runner-up reduce generic matches
  // for terrain such as broad planar slopes or repeated features.
  const constraints = [
    ['patch width differs by more than a factor of two', top.scaleGap > Math.log(2)],
    ['elevation relief differs by more than a factor of two', top.reliefGap > Math.log(2)],
    ['upper-decile slope differs by more than 10°', top.slopeGap > 10],
    ['fine-scale landforms differ', top.fine > 0.23],
    ['broad-scale landforms differ', top.broad > 0.23],
    ['the regional arrangement of elevations differs', top.alignment > 0.23],
    ['combined terrain distance exceeds 0.30', top.distance > 0.30],
  ];
  const failed = constraints.filter(([, outside]) => outside).map(([label]) => label);
  if (!duplicateGrid && failed.length) {
    return noMatch('The closest reference falls outside the terrain agreement limits. ' +
      failed.map(label => label[0].toUpperCase() + label.slice(1) + '.').join(' '));
  }
  if (second && ((second.distance - top.distance) < Math.max(0.035, top.distance * 0.22) ||
      (!duplicateGrid && (second.fine + 0.025 < top.fine || second.broad + 0.025 < top.broad)))) {
    return noMatch('Several references are similarly close or disagree across resolutions. The available measurements do not distinguish a clear match.');
  }
  return { status: 'match', reason: 'This measured grid clears the terrain agreement limits and ranks clearly ahead of the alternatives.', best: top, top, candidates };
}
