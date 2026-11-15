import { readFile } from "node:fs/promises";
import { sites } from "../src/missionforge/sites.js";
import { SITE_FEATURES } from "../src/missionforge/site-ai.js";

// Mineral profiles per surface class, in the same feature shape the client
// sends. Keeping one contract means the UI never needs a second mapping.
const PROFILES = [
  [/basalt|lava|volcan/, { olivine: 22, plagioclase: 48, lowCalciumPyroxene: 12, highCalciumPyroxene: 10, smfe: 18 }],
  [/sand|dune|aeolian/, { olivine: 9, plagioclase: 33, lowCalciumPyroxene: 6, highCalciumPyroxene: 5, smfe: 10 }],
  [/salt|halite/, { olivine: 3, plagioclase: 12, lowCalciumPyroxene: 2, highCalciumPyroxene: 2, smfe: 4 }],
  [/breccia|impact/, { olivine: 14, plagioclase: 31, lowCalciumPyroxene: 8, highCalciumPyroxene: 7, smfe: 13 }],
  [/ice|glacial|sediment|polar/, { olivine: 5, plagioclase: 18, lowCalciumPyroxene: 4, highCalciumPyroxene: 3, smfe: 7 }],
];
const DEFAULT_MINERALS = { olivine: 10, plagioclase: 25, lowCalciumPyroxene: 6, highCalciumPyroxene: 5, smfe: 9 };

const SPANS = {
  olivine: 40,
  plagioclase: 60,
  lowCalciumPyroxene: 30,
  highCalciumPyroxene: 30,
  smfe: 30,
  roughness: 0.9,
  surfaceTemperature: 45,
};

function mineralProfile(surface = "") {
  const text = surface.toLowerCase();
  for (const [pattern, values] of PROFILES) if (pattern.test(text)) return values;
  return DEFAULT_MINERALS;
}

function roughnessOf(surface = "") {
  const text = surface.toLowerCase();
  if (/dune|sand/.test(text)) return 0.82;
  if (/lava|volcan|basalt/.test(text)) return 0.74;
  if (/breccia|fan|gravel|boulder/.test(text)) return 0.63;
  if (/ice|glacial|sediment/.test(text)) return 0.38;
  if (/salt|flat/.test(text)) return 0.24;
  return 0.5;
}

async function annualTemperature(id) {
  for (const path of [`public/data/${id}.json`, `dist/data/${id}.json`]) {
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const value = raw?.properties?.parameter?.T2M?.ANN;
      if (Number.isFinite(value) && value > -900) return value;
    } catch {}
  }
  return null;
}

// Ranks the catalog against a target site description. Only the features the
// target actually provides take part in the score.
export async function siteRankings(target = {}) {
  const wanted = SITE_FEATURES.map(([key]) => key).filter((key) =>
    Number.isFinite(target[key]),
  );
  const results = [];
  for (const site of sites) {
    const features = {
      ...mineralProfile(site.surface),
      roughness: roughnessOf(site.surface),
      surfaceTemperature: await annualTemperature(site.id),
    };
    const scored = wanted.filter((key) => Number.isFinite(features[key]));
    let score = null;
    if (scored.length) {
      const total = scored.reduce((sum, key) => {
        const delta = Math.abs(target[key] - features[key]);
        return sum + Math.max(0, 1 - delta / (SPANS[key] || 50));
      }, 0);
      score = Math.round((total / scored.length) * 100);
    }
    results.push({ siteId: site.id, score, features });
  }
  return { version: 1, modelVersion: "site-match-v1", target, results };
}
