import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalogRequestError, selectEarthAnalogAttribute } from '../server/analog-attribute.js';

const ask = (query) => selectEarthAnalogAttribute(new URLSearchParams(query));

test('temperature ranking returns ranked Earth cells in the backend shape', () => {
  const result = ask({ body: 'mars', attribute: 'temperature', value: '-60', unit: 'C', top: '5' });
  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 5);
  assert.deepEqual(result.features.map((f) => f.properties.match_rank), [1, 2, 3, 4, 5]);
  const scores = result.features.map((f) => f.properties.temperature_match_percentage);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(result.matching.target_temperature_kelvin, 213.15);
  assert.equal(result.rankings.temperature, result.features);
});

test('invalid input is rejected with the backend messages', () => {
  assert.throws(() => ask({ attribute: 'temperature', value: 'warm' }), AnalogRequestError);
  assert.throws(() => ask({ body: 'venus', attribute: 'temperature', value: '200' }), /Moon or Mars/);
  assert.throws(() => ask({ attribute: 'mineral', mineral: 'quartz' }), /mineral must be one of/);
  assert.throws(() => ask({ attribute: 'temperature', value: '200', top: '11' }), /top must be/);
});

test('attributes without bundled data say so instead of failing', () => {
  const roughness = ask({ attribute: 'roughness', value: '40' });
  assert.equal(roughness.matching.status, 'not-configured');
  const mineral = ask({ attribute: 'mineral', mineral: 'olivine' });
  assert.ok(Array.isArray(mineral.features));
});
