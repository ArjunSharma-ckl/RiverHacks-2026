// Attribute-only Earth analog ranking, ported from
// backend/earth_analogs.py::select_earth_analog_attribute so the endpoint
// answers on deployments that cannot run or reach the Python service. It ranks
// the same saved match files and returns the same response shape.
import { MINERALS, TEMPERATURE } from './analog-data.js';

const MAX_TOP_N = 10;
const MINERAL_CLASSES = ['high_calcium_pyroxene', 'iron', 'low_calcium_pyroxene', 'olivine', 'plagioclase'];

export class AnalogRequestError extends Error {}

const candidateKey = (feature) => {
  const p = feature.properties;
  const identity = p.earth_grid_id || p.earth_sample_id || p.earth_sample_name || JSON.stringify(feature.geometry.coordinates);
  return `${identity}|${p.earth_mineral_class || ''}`.toLowerCase();
};

// First feature wins for each identity, as in _dedupe_geo_features.
function dedupe(features, identityKeys) {
  const seen = new Map();
  for (const feature of features) {
    const p = feature.properties;
    let identity = identityKeys.filter((k) => k !== 'earth_mineral_class').map((k) => p[k]).find(Boolean);
    if (identity && p.earth_mineral_class) identity = `${identity}|${p.earth_mineral_class}`;
    const key = String(identity || feature.geometry.coordinates).toLowerCase();
    if (!seen.has(key)) seen.set(key, feature);
  }
  return [...seen.values()];
}

const round = (value, places) => Number(value.toFixed(places));
const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function selectEarthAnalogAttribute(params) {
  const raw = String(params.get('body') ?? 'Moon').trim().toLowerCase();
  const body = { moon: 'Moon', mars: 'Mars' }[raw];
  if (!body) throw new AnalogRequestError('body must be Moon or Mars.');
  const topText = params.get('top') ?? '10';
  const top = /^[+-]?\d+$/.test(topText.trim()) ? Number(topText) : NaN;
  if (!Number.isInteger(top) || top < 1 || top > MAX_TOP_N)
    throw new AnalogRequestError(`top must be an integer from 1 to ${MAX_TOP_N}.`);
  const attribute = String(params.get('attribute') ?? '').trim().toLowerCase();
  if (!['temperature', 'mineral', 'roughness'].includes(attribute))
    throw new AnalogRequestError('attribute must be temperature, mineral, or roughness.');

  let features, scoreKey, matching, rankingKey = attribute;

  if (attribute === 'temperature') {
    const text = params.get('value');
    let target = text == null || text.trim() === '' ? NaN : Number(text);
    if (Number.isNaN(target)) throw new AnalogRequestError('temperature value must be numeric.');
    const unit = String(params.get('unit') || 'K').trim().toUpperCase();
    if (unit === 'C' || unit === '°C') target += 273.15;
    else if (unit !== 'K' && unit !== 'KELVIN') throw new AnalogRequestError('temperature unit must be K or C.');
    if (!Number.isFinite(target) || target <= 0 || target > 1000)
      throw new AnalogRequestError('temperature must convert to a finite value from 0 to 1000 K.');
    const candidates = [];
    for (const feature of dedupe(TEMPERATURE, ['earth_grid_id', 'earth_sample_id'])) {
      const p = feature.properties;
      const earth = Number(p.earth_annual_average_kelvin ?? p.earth_temperature_kelvin);
      if (!Number.isFinite(earth) || earth <= 0) continue;
      const score = (100 * Math.min(target, earth)) / Math.max(target, earth);
      candidates.push({ feature, score, difference: Math.abs(earth - target), earth, key: candidateKey(feature) });
    }
    candidates.sort((a, b) => b.score - a.score || a.difference - b.difference || compareKeys(a.key, b.key));
    features = candidates.slice(0, top).map(({ feature, score, difference, earth }, index) => {
      const p = feature.properties;
      return {
        type: 'Feature',
        geometry: { ...feature.geometry },
        properties: {
          earth_grid_id: p.earth_grid_id ?? null,
          earth_temperature_kelvin: earth,
          earth_temperature_celsius: p.earth_temperature_celsius ?? null,
          earth_temperature_period: p.earth_temperature_period ?? p.earth_data_period ?? null,
          earth_data_source: p.earth_data_source ?? null,
          environment_temperature_kelvin: target,
          temperature_difference_kelvin: round(difference, 3),
          temperature_match_percentage: round(score, 2),
          match_percentage: round(score, 2),
          match_rank: index + 1,
          ranking_metric: 'temperature',
        },
      };
    });
    scoreKey = 'temperature_match_percentage';
    matching = { target_temperature_kelvin: round(target, 3), temperature_unit_entered: unit };
  } else if (attribute === 'mineral') {
    const mineral = String(params.get('mineral') ?? '').trim().toLowerCase();
    if (!MINERAL_CLASSES.includes(mineral))
      throw new AnalogRequestError(`mineral must be one of: ${MINERAL_CLASSES.join(', ')}.`);
    rankingKey = `mineral:${mineral}`;
    scoreKey = `${mineral}_match_percentage`;
    if (!MINERALS) {
      features = [];
      matching = {
        mineral,
        status: 'not-built',
        reason: 'Mineral matches are not bundled with this deployment. They are built from the EarthChem export in Git LFS: run python -m backend.earth_mineral_matches, then node scripts/build-analog-data.mjs, and redeploy.',
      };
    } else {
      const candidates = dedupe(MINERALS, ['earth_sample_id', 'earth_mineral_class', 'earth_sample_name'])
        .filter((f) => f.properties.earth_mineral_class === mineral && f.properties.earth_formula_match_percentage != null)
        .map((feature) => ({ feature, score: Number(feature.properties.earth_formula_match_percentage), key: candidateKey(feature) }))
        .filter((c) => Number.isFinite(c.score));
      candidates.sort((a, b) => b.score - a.score || compareKeys(a.key, b.key));
      features = candidates.slice(0, top).map(({ feature, score }, index) => {
        const p = feature.properties;
        return {
          type: 'Feature',
          geometry: { ...feature.geometry },
          properties: {
            earth_sample_id: p.earth_sample_id ?? null,
            earth_sample_name: p.earth_sample_name ?? null,
            earth_material: p.earth_material ?? null,
            earth_mineral_class: mineral,
            earth_best_fit_formula: p.earth_best_fit_formula ?? null,
            earth_formula_match_percentage: score,
            earth_formula_match_basis: p.earth_formula_match_basis ?? null,
            earth_mineral_chemistry_oxide_wt_percent: p.earth_mineral_chemistry_oxide_wt_percent ?? null,
            earth_data_source: p.earth_data_source ?? null,
            [`${mineral}_match_percentage`]: score,
            match_percentage: score,
            match_rank: index + 1,
            ranking_metric: `mineral:${mineral}`,
          },
        };
      });
      matching = { mineral, formula_match_method: 'Closest fixed end-member formula fit from reported EarthChem oxide analyses.' };
    }
  } else {
    const text = params.get('value');
    const target = text == null || text.trim() === '' ? NaN : Number(text);
    if (Number.isNaN(target)) throw new AnalogRequestError('roughness value must be numeric micrometers.');
    if (!Number.isFinite(target) || target <= 0 || target > 1_000_000)
      throw new AnalogRequestError('roughness must be a finite number greater than 0 and at most 1,000,000 micrometers.');
    // Roughness is estimated per candidate site from imagery by the Python
    // service. Report it as unconfigured here, in that service's own shape.
    return {
      type: 'FeatureCollection', features: [],
      query: { body, attribute: 'roughness' },
      rankings: { roughness: [] },
      matching: {
        status: 'not-configured',
        reason: 'Roughness is estimated by the Python backend (python -m backend.server) with SERPAPI_API_KEY and GEMINI_API_KEY set. Point MISSION_BACKEND_URL at it to enable this attribute.',
        target_roughness_um: target,
      },
    };
  }

  return {
    type: 'FeatureCollection',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    query: { body, attribute },
    features,
    rankings: { [rankingKey]: features },
    matching: {
      ...matching,
      top_n: top,
      score_field: scoreKey,
      ignored_attributes: ['temperature', 'minerals', 'roughness']
        .filter((key) => key !== attribute && !(attribute === 'mineral' && key === 'minerals')),
    },
  };
}
