// Keeps imagery layers in a deliberate order no matter what gets toggled.
let viewer;
let order = [];
const registry = new Map();

export function initLayers(instance, keyOrder) {
  viewer = instance;
  order = keyOrder;
}

function restack() {
  for (const key of order) {
    const layer = registry.get(key);
    if (layer) viewer.imageryLayers.raiseToTop(layer);
  }
}

export function setLayer(key, layer) {
  dropLayer(key);
  registry.set(key, layer);
  viewer.imageryLayers.add(layer);
  restack();
  return layer;
}

export function dropLayer(key) {
  const existing = registry.get(key);
  if (!existing) return;
  registry.delete(key);
  viewer.imageryLayers.remove(existing, true);
}

export function getLayer(key) {
  return registry.get(key);
}

export function hasLayer(key) {
  return registry.has(key);
}
