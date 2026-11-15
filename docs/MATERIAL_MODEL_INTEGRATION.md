# Materials model integration

The simulation accepts a validated materials assessment through `applyMaterialAssessment(mission, payload)` in `src/missionforge/material-model.js`. Supply it after `start(cfg)` or while the mission is running. The assessment is stored with the mission snapshot. The habitat multiplier changes future simulated thermal demand; past resource history is unchanged.

```js
applyMaterialAssessment(mission, {
  version: 1,
  modelVersion: 'your-model-version',
  facilities: [
    { id: 'habitat', material: 'measured material identifier', thermalLoadMultiplier: 1.12 }
  ]
});
```

`thermalLoadMultiplier` must be finite and between 0.5 and 3. The adapter ignores invalid rows. The default is 1, meaning the current training scenario makes no material-specific claim. Add the materials model's input data, provenance, units, and validation before presenting its output as physical performance.
