import test from 'node:test';
import assert from 'node:assert/strict';
import { start, advance } from '../src/missionforge/simulation.js';
import { condition, damage } from '../src/missionforge/exposure.js';
import { STEEL_SPECS, predictSteelFatigue, roverSteel } from '../src/missionforge/steel-fatigue.js';
import { STEEL_ASSEMBLIES, selectedSteel, steelFatigueFactor } from '../src/missionforge/material-model.js';

const cfg = {
  site: 'atacama', mode: 'Mars projection', crew: 4, days: 10, rover: true,
  array: 12, sun: 6, load: 1.4, battery: 60, oxygen: 40, water: 60, parts: 4,
  roles: ['Commander', 'Engineer', 'Geologist', 'Medic'], facilities: {},
};

test('the fatigue model is the trained artifact, not a constant', () => {
  assert.ok(roverSteel.predictedMpa > 100 && roverSteel.predictedMpa < 2000);
  assert.ok(roverSteel.testR2 > 0.9);
  assert.ok(STEEL_SPECS.length >= 3);
  // Distinct specimens must give distinct predictions.
  const predictions = new Set(STEEL_SPECS.map((spec) => Math.round(spec.predictedMpa)));
  assert.equal(predictions.size, STEEL_SPECS.length);
  assert.throws(() => predictSteelFatigue([1, 2, 3]), TypeError);
});

test('the chosen specification scales fatigue only on steel assemblies', () => {
  const weak = { materialSpec: STEEL_SPECS.reduce((a, b) => (a.predictedMpa < b.predictedMpa ? a : b)).id };
  const strong = { materialSpec: STEEL_SPECS.reduce((a, b) => (a.predictedMpa > b.predictedMpa ? a : b)).id };
  for (const id of Object.keys(STEEL_ASSEMBLIES))
    assert.ok(steelFatigueFactor(weak, id) > steelFatigueFactor(strong, id));
  assert.equal(steelFatigueFactor(weak, 'solar'), 1);
  assert.equal(steelFatigueFactor(strong, 'habitat'), 1);
  assert.equal(selectedSteel({}).id, STEEL_SPECS[0].id);
});

test('a weaker specification wears the rover down faster in a real run', () => {
  const run = (spec) => {
    const m = start(cfg);
    m.materialSpec = spec;
    m.environment.wind = 18;
    m.environment.dust = 40;
    advance(m, 120);
    return damage(condition(m, 'rover'));
  };
  const weak = run(STEEL_SPECS.reduce((a, b) => (a.predictedMpa < b.predictedMpa ? a : b)).id);
  const strong = run(STEEL_SPECS.reduce((a, b) => (a.predictedMpa > b.predictedMpa ? a : b)).id);
  assert.ok(weak > strong, `expected ${weak} > ${strong}`);
  assert.ok(strong > 0);
});
