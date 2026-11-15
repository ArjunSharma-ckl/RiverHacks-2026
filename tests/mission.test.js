import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sites, rank, interpret } from "../src/missionforge/sites.js";
import {
  start,
  advance,
  respond,
  inject,
  vitals,
  generation,
  SOL,
} from "../src/missionforge/simulation.js";
const data = Object.fromEntries(
  sites.map((s) => [
    s.id,
    JSON.parse(
      readFileSync(
        new URL("../public/data/" + s.id + ".json", import.meta.url),
      ),
    ),
  ]),
);
const cfg = {
  crew: 4,
  days: 7,
  array: 8,
  sun: 7.2,
  battery: 48,
  oxygen: 36,
  water: 64,
  load: 1.8,
  parts: 3,
  rover: true,
  backup: true,
  roles: ["Commander", "Engineer", "Medical", "Geology"],
};
test("catalog rankings depend on mission and environment", () => {
  function first(q) {
    return [...sites].sort(
      (a, b) =>
        rank(b, data[b.id], interpret(q, 0), q).score -
        rank(a, data[a.id], interpret(q, 0), q).score,
    )[0].id;
  }
  assert.equal(first("dry rocky habitat solar"), "atacama");
  assert.equal(first("cold volcanic geology"), "snake");
  assert.equal(rank({}, null).score, null);
  assert.ok(rank(sites[0], null).coverage < 1);
});
test("failed array changes mean generation and drains battery; repair uses a spare", () => {
  const m = start(cfg),
    baseline = generation(m);
  inject(m, "solar");
  assert.ok(generation(m) < baseline);
  advance(m, 1);
  assert.ok(m.resources.battery < 48);
  respond(m, "solar", 1);
  assert.equal(m.parts, 2);
  assert.equal(generation(m), baseline);
});
test('live conditions change the same mission state and planned facilities gate work',()=>{
  const baseline=start({...cfg,mode:'Mars projection'}), stressed=start({...cfg,mode:'Mars projection',facilities:{water:false}});
  stressed.environment.dust=80;
  stressed.environment.temperature=-90;
  stressed.environment.wind=30;
  stressed.environment.radiation=2;
  stressed.traverse=true;
  assert.ok(generation(stressed)<generation(baseline));
  advance(stressed,2);
  advance(baseline,2);
  assert.ok(stressed.resources.battery<baseline.resources.battery);
  assert.equal(stressed.km,0);
  assert.ok(stressed.crewDose>0);
  assert.equal(stressed.production.water,0);
});
test('packed supplies persist and a wind dust event suspends work until conditions improve',()=>{
  const m=start({...cfg,mode:'Mars projection',food:12,medkits:1,regolith:8,components:2});
  assert.equal(m.resources.food,12);
  assert.equal(m.medkits,1);
  assert.deepEqual(m.inventory,{regolith:8,components:2});
  m.environment.wind=30;m.environment.dust=70;
  advance(m,1);
  assert.equal(m.active.storm,true);
  assert.ok(m.logs.some(x=>x.msg.includes('surface operations suspended')));
  m.environment.wind=5;m.environment.dust=0;
  advance(m,1);
  assert.equal(m.active.storm,undefined);
});
test("oxygen, rover and medical events propagate to the same state", () => {
  const m = start(cfg),
    normal = start(cfg);
  m.traverse = true;
  inject(m, "oxygen");
  inject(m, "rover");
  inject(m, "medical", "Hypoxia drill");
  advance(m, 1);
  advance(normal, 1);
  assert.ok(m.resources.oxygen < normal.resources.oxygen);
  assert.equal(m.km, 0);
  assert.equal(vitals(m, 0).spo2, 89);
  respond(m, "rover", 1);
  respond(m, "medical", 2);
  advance(m, 1);
  assert.ok(m.km > 0);
  assert.equal(vitals(m, 0).status, "In recovery");
  assert.equal(m.medkits, 1);
});
test("clock clamps at planned end and depleted inventories stop the run", () => {
  const m = start(cfg);
  advance(m, 9999);
  assert.equal(m.outcome, "Planned duration reached");
  assert.ok(Math.abs(m.h - 7 * SOL) < 1e-7);
  const failed = start({ ...cfg, water: 0.01 });
  advance(failed, 100);
  assert.equal(failed.resources.water, 0);
  assert.match(failed.outcome, /Aborted/);
  const h = failed.h;
  advance(failed, 1);
  assert.equal(failed.h, h);
});
test("invalid steps, duplicate failures and exhausted spares preserve state", () => {
  const m = start({ ...cfg, parts: 0, rover: false });
  advance(m, NaN);
  advance(m, -1);
  assert.equal(m.h, 0);
  assert.equal(inject(m, "rover"), false);
  inject(m, "comms");
  assert.equal(inject(m, "comms"), false);
  assert.equal(respond(m, "comms", 1), "No spare parts remaining");
  assert.ok(m.active.comms);
});
test("daily mean budgets are reproducible across manual step sizes", () => {
  const a = start(cfg),
    b = start(cfg);
  advance(a, 12);
  for (let i = 0; i < 12; i++) advance(b, 1);
  assert.deepEqual(a.resources, b.resources);
  assert.equal(a.used, b.used);
});

test("rover uses its own pack, recharges from the habitat and obeys link state", () => {
  const m = start(cfg);
  m.traverse = true;
  inject(m, "comms");
  advance(m, 1);
  assert.equal(m.km, 0);
  respond(m, "comms", 3);
  advance(m, 1);
  assert.ok(m.km > 0 && m.roverEnergy < 2.4);
  m.traverse = false;
  const before = m.used;
  advance(m, 1);
  assert.equal(m.roverEnergy, 2.4);
  assert.ok(m.used - before > cfg.load);
});

test("crew duty work credits, reassignments and medical holds share the mission clock", async () => {
  const { prepareDuties, assignDuty, dutyPose } =
    await import("../src/missionforge/duties.js");
  const m = start(cfg);
  prepareDuties(m);
  assert.equal(assignDuty(m, 0, "water"), true);
  advance(m, 0.5);
  assert.equal(dutyPose(m, 0).working, true);
  assert.equal(m.production.water, 0);
  advance(m, 0.26);
  assert.equal(m.production.water, 0.35);
  const position = dutyPose(m, 0);
  assignDuty(m, 0, "med");
  assert.deepEqual(m.duties[0].origin, [position.x, position.y]);
  inject(m, "medical");
  advance(m, 1);
  assert.equal(m.duties[0].elapsed, 0);
  respond(m, "medical", 2);
  advance(m, 2.5);
  assert.ok(Math.abs(m.duties[0].elapsed - 0.5) < 1e-8);
  inject(m, "storm");
  const before = structuredClone(m.production);
  advance(m, 1);
  assert.deepEqual(m.production, before);
});

test("mining feeds fabrication and construction without free resources", async () => {
  const { prepareDuties, assignDuty } =
    await import("../src/missionforge/duties.js");
  const m = start({ ...cfg, crew: 1 });
  prepareDuties(m);
  assignDuty(m, 0, "build");
  advance(m, 1);
  assert.equal(m.construction, 0);
  assignDuty(m, 0, "mine");
  advance(m, 8);
  assert.ok(m.inventory.regolith >= 32);
  assignDuty(m, 0, "forge");
  advance(m, 4);
  assert.ok(m.inventory.components >= 4);
  assignDuty(m, 0, "build");
  advance(m, 5);
  assert.equal(m.construction, 4);
  assert.ok(m.inventory.components >= 0);
});

test('surface dust persists after the storm and cleaning restores some generation', async () => {
  const { condition, maintain, weather } = await import('../src/missionforge/exposure.js');
  const { log } = await import('../src/missionforge/simulation.js');
  const m = start({ ...cfg, mode: 'Mars projection', battery: 1000 });
  const clear = generation(m);
  m.environment.dust = 60;
  m.environment.wind = 20;
  advance(m, 20);
  assert.ok(weather(m).transmission < 0.3);
  assert.ok(condition(m, 'solar').dust > 0.1);
  m.environment.dust = 0;
  assert.ok(generation(m) < clear);
  const before = generation(m);
  const startHour = m.h;
  assert.equal(maintain(m, 'solar', advance, log), 'Service completed');
  assert.ok(generation(m) > before);
  assert.equal(m.h, startHour + 0.5);
  assert.equal(m.parts, cfg.parts);
  assert.ok(m.checkpoints.some(frame => frame.label.includes('Clean exposed surfaces')));

  m.exposure.solar.wear = 0.81;
  assert.equal(generation(m), 0);
  m.parts = 0;
  assert.equal(maintain(m, 'solar', advance, log), 'Insufficient spares');
  assert.equal(m.h, startHour + 0.5);
  m.parts = 1;
  assert.equal(maintain(m, 'solar', advance, log), 'Service completed');
  assert.equal(m.parts, 0);
  assert.ok(generation(m) > 0);
});

test('lunar dust disturbance deposits locally without atmospheric extinction', async () => {
  const { condition, weather } = await import('../src/missionforge/exposure.js');
  const m = start({ ...cfg, mode: 'Moon projection' });
  m.environment.wind = 40;
  m.environment.dust = 80;
  advance(m, 2);
  assert.equal(m.environment.wind, 0);
  assert.equal(weather(m).pressure, 0);
  assert.equal(weather(m).tau, 0);
  assert.equal(weather(m).transmission, 1);
  assert.ok(condition(m, 'solar').dust > 0);
});

test('browser steel prediction matches the fitted model and drives rover fatigue', async () => {
  const { default: artifact } = await import('../src/missionforge/steel-fatigue.json', { with: { type: 'json' } });
  const { roverSteel } = await import('../src/missionforge/steel-fatigue.js');
  const { condition } = await import('../src/missionforge/exposure.js');
  assert.ok(Math.abs(roverSteel.predictedMpa - artifact.profilePredictionMpa) < 1e-8);
  const m = start({ ...cfg, mode: 'Mars projection' });
  advance(m, 1);
  assert.ok(condition(m, 'solar').fatigue > 0);
  const ratio = condition(m, 'rover').fatigue / condition(m, 'solar').fatigue;
  assert.ok(Math.abs(ratio - roverSteel.referenceMpa / roverSteel.predictedMpa) < 1e-12);
});

test('temperature changes modeled rover fatigue and an injected storm changes exposure', async () => {
  const { condition, exposureRates, weather } = await import('../src/missionforge/exposure.js');
  const cold = start({ ...cfg, mode: 'Mars projection' });
  const mild = start(cold.cfg);
  cold.environment.temperature = -120;
  assert.ok(exposureRates(cold, 'rover').fatigue > exposureRates(mild, 'rover').fatigue);
  advance(cold, 1);
  advance(mild, 1);
  assert.ok(condition(cold, 'rover').fatigue > condition(mild, 'rover').fatigue);
  const before = generation(mild);
  assert.equal(inject(mild, 'storm'), true);
  assert.ok(weather(mild).tau > 0);
  assert.ok(generation(mild) < before);
  advance(mild, 1);
  assert.ok(condition(mild, 'solar').dust > 0);
});
