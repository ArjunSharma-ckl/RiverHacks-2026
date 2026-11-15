// Render quality presets. Resolution scale supersamples the canvas, MSAA
// smooths geometry edges, and maximumScreenSpaceError trades globe detail for
// memory: lower values refine the terrain and imagery further.
export const QUALITY_LEVELS = [
  { id: 'low', label: 'Low', resolution: 0.75, msaa: 1, globeError: 8, fxaa: false },
  { id: 'medium', label: 'Medium', resolution: 1, msaa: 2, globeError: 4, fxaa: true },
  { id: 'high', label: 'High', resolution: 1.25, msaa: 4, globeError: 2, fxaa: true },
  { id: 'superb', label: 'Superb', resolution: 1.5, msaa: 4, globeError: 1, fxaa: true }
];

export function createQuality(viewer, initial = 1) {
  const scene = viewer.scene;
  let index = initial;
  function apply(value) {
    index = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Math.round(Number(value) || 0)));
    const level = QUALITY_LEVELS[index];
    viewer.resolutionScale = level.resolution;
    scene.msaaSamples = level.msaa;
    scene.globe.maximumScreenSpaceError = level.globeError;
    if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = level.fxaa;
    return level;
  }
  apply(index);
  return {
    apply,
    levels: QUALITY_LEVELS,
    get index() { return index; },
    get level() { return QUALITY_LEVELS[index]; }
  };
}
