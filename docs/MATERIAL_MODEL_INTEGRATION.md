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

## Bundled steel fatigue model

Mission control evaluates a locally trained kernel ridge regression model in the browser, with no inference API. The rover bearing uses an explicitly labeled proxy steel profile from the model's training set. Its predicted room-temperature fatigue strength changes the simulated accumulated rover fatigue through the ratio of the training median strength to the predicted strength. Environmental and maintenance state continue to drive exposure and service in the mission engine. This coupling is a provisional relative scaling; the laboratory measurements do not establish a planetary fatigue-life curve or equipment failure probability. The inspection view shows held-out RMSE as an aggregate error measure.

The dataset contains NIMS MatNavi measurements published by [Agrawal et al.](https://doi.org/10.1186/2193-9772-3-8). Reproduce the training from the repository root with Python and NumPy 2.0.2:

```sh
curl -fsSL https://raw.githubusercontent.com/zdelrosario/mi101/main/mi101/data/agrawal_data.csv -o /tmp/agrawal-fatigue.csv
python scripts/materials/train-fatigue.py /tmp/agrawal-fatigue.csv src/missionforge/steel-fatigue.json
```

Training compares 40 RBF and Matérn kernel configurations by five-fold composition-grouped validation R². The fixed external split holds out entire exact compositions. Similar compositions may still occur on both sides of the split. One test evaluation of the selected model produces the metrics embedded in the exported artifact. The training script excludes specimen IDs. The trained estimator covers steel fatigue strength only. Data for corrosion, abrasion, off-world exposure and other equipment materials would need separate training and validation.
