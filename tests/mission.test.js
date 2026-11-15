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
