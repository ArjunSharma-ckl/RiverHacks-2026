# Site ranking AI contract

The combined Sites panel stores numeric target measurements and sends them to
`GET /api/analog/site-rankings?target=<URL-encoded JSON>` when the page loads or
the user selects **Refresh AI rankings**. The future ranking service can replace
this route without changing the UI.

Request example:

```json
{"version":1,"target":{"olivine":42,"plagioclase":null,"lowCalciumPyroxene":null,"highCalciumPyroxene":null,"smfe":null,"roughness":8,"surfaceTemperature":-21}}
```

Response example:

```json
{"version":1,"modelVersion":"2026-11-15","results":[{"siteId":"iceland","score":81.4,"features":{"olivine":37,"plagioclase":22,"lowCalciumPyroxene":15,"highCalciumPyroxene":7,"smfe":19,"roughness":8.3,"surfaceTemperature":-2.8}}]}
```

`siteId` must match a catalog site in `src/missionforge/sites.js`. Scores must be
numeric from 0 to 100. Missing feature measurements must be omitted or null;
the UI never substitutes invented mineral values. A returned score replaces
the editorial suitability estimate on the site card. Feature sorting uses the
returned numeric measurements and puts unknown values last. NASA POWER
climatology supplies the current Earth temperature fallback.
