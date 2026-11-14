# MissionForge
Earth is our proving ground.

Compare Earth analog sites using NASA POWER climate normals, plan travel, deploy a research habitat on the existing Cesium globe and run MF-001, the Atacama Habitat Expedition.

The default entry is `/orbit.html`. Select **Find a field site** to open the shared Cesium globe workspace. Its resizable, collapsible drawer has Past missions, Site atlas, Site explorer, Travel, Mission and GroundTruth tabs. The globe stays mounted when changing tabs. Mission setup previews the selected Earth terrain before facilities and crew appear at launch. The Site explorer stores numeric mineral, roughness and temperature inputs locally for a future matching model.

Travel follows the site currently being scouted. It resolves departure and waypoint cities through [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), then draws route arcs and estimates transport, lodging, per-person cost and carbon. Rates and leg prices are editable. Currency reference rates load from [Frankfurter](https://frankfurter.dev/v1/). Export PDF opens the browser's Save as PDF workflow.

To enable GroundTruth locally, open `.env.local` in the repository root and enter `SERPAPI_KEY=your_actual_key`. If the file is missing, create it from `.env.example`. Restart `npm run dev` after editing it. For Render, add `SERPAPI_KEY` in the service's Environment settings and redeploy. The key stays on the server and is not placed in client code.

## Run locally

Use Node 22.12+ or Node 24. Run `npm install` and `npm run dev`, then open the URL printed by Vite. Run `npm test` for deterministic engine and ranking checks. For the production server run `npm run build` followed by `npm start` (default port 10000).

## Three-minute demonstration

1. Open **Site atlas** and enter “dry rocky habitat solar”. Inspect Atacama and expand its comparison with Iceland.
2. Open **Mission** to preview the selected terrain. Keep four crew, seven sols, solar power and the robotic rover, then launch the mission.
3. Start a rover traverse and advance one sol. Inject a solar array failure, advance an hour and replace the controller.
4. Inject a crew medical concern, open ASTRA and choose a training response. View and export the after-action report.
5. Use **Orbital explorer** to open the original satellite catalog, weather layers and planetary controls.

The core demo uses bundled site climate records, thumbnails and models. Detailed imagery and recent environmental observations require upstream access. Optional terrain, FIRMS and evidence-search credentials are documented in `.env.example`. Configure server-side credentials in the Render environment. The existing Render blueprint builds from main and serves both entry points through the Node server.

See [data provenance](DATA_SOURCES.md), [asset credits](ASSET_CREDITS.md) and [simulation assumptions](SIMULATION_ASSUMPTIONS.md).

## Original orbital explorer
A live, cinematic view of Earth built on NASA data: real near-real-time imagery,
real solar lighting, real sky positions, and the weather that is happening right
now.

## Run it

```bash
npm install
npm run dev
```

Nothing needs an API key to work. Keys only add extras — copy `.env.example` to
`.env.local` when you have them.

## What is in the view

**Analog simulation planner.** Open `/planner.html`. Use a measured lunar
or Martian example, upload a square JSON elevation grid in metres, or
upload an overhead terrain image. Image mode downloads a quantized Depth
Anything V2 Small checkpoint (~27 MB) and estimates relative depth locally.
The image center square is used, and relative depth only produces an
exploratory shortlist. Metric search compares relief, slope, and shape at
two resolutions. The resulting terrain distance is a ranking metric;
smaller values indicate closer measured form. Acceptance thresholds are
prototype rules and have not been calibrated for planetary site suitability.

The catalog contains 24 Copernicus GLO-30 Earth windows sampled on 65×65
grids over 8 km × 8 km. The Moon examples are cropped from the NASA LRO LOLA
south polar 20 m product, sampled every sixth pixel. The Mars example is
cropped from NASA MOLA MEGDR (17 samples across, interpolated to the
display grid). Source and attribution records accompany each patch.
These previews omit fine hazards, material properties and field access.

**Earth.** NASA GIBS Blue Marble shaded-relief as the global basemap, Esri World
Imagery from zoom 6 inwards, and VIIRS city lights blended in only on the night
side of the terminator. Lighting is true solar lighting, so the day/night line is
the real one for the clock time, with a scattering atmosphere, HDR tone mapping,
bloom and a lens-flare stage on the Sun. Cesium world terrain loads if a
`VITE_CESIUM_ION_ACCESS_TOKEN` is present.

**Weather (the toggle, or press `W`).** Ten NASA GIBS layers with per-layer
opacity. The default stack is GOES-East and GOES-West GeoColor cloud cover plus
GPM IMERG precipitation rate. Each layer declares its native cadence and
publication latency, so the timestamp requested always lands on an image that
exists, and layers re-request themselves as new imagery appears.

**Active events.** Open storms, wildfires, floods, volcanoes and ice events from
NASA EONET, as clickable markers.

**Click anywhere on Earth** for surface weather at that point from NASA POWER —
temperature, humidity, wind, precipitation and solar irradiance.

**Sun, Moon, planets, stars.** The Sun and Moon are at their true positions, so
the Moon shows its real current phase. Mercury, Venus, Mars, Jupiter and Saturn
are placed in their true geocentric *direction*, computed from JPL's approximate
Keplerian elements, and lit by the real Sun direction so their phases are
correct; distances are compressed and radii exaggerated so they read on screen.
The 30 brightest stars are pinned to their real J2000 sky positions, sized by
magnitude and coloured by spectral class, so the markers land on the stars in the
background star field. Clicking the Sun shows live space weather from NASA DONKI.

**Satellites.** Seven spacecraft with real altitudes and inclinations, orbit
trails and labels — including Aqua, Terra, Suomi NPP and GPM, the satellites that
produce the imagery layers above.

## NASA APIs used

| API | Key | Used for |
| --- | --- | --- |
| GIBS (WMTS + WMS) | none | all basemap and weather imagery |
| EONET v3 | none | active natural events |
| POWER | none | point surface weather and solar resource |
| Image and Video Library | none | photographs in the detail panel |
| DONKI | `NASA_API_KEY` | solar flares, CMEs, geomagnetic storms |
| FIRMS | `FIRMS_MAP_KEY` | active fire detections (`/api/nasa/fires`) |

All upstream calls go through `/api/*` on the server, so keys are never shipped
to the browser. Responses are cached per route.

## Deploying to Render

`render.yaml` is a Render blueprint. Point Render at this repo, and it builds the
client and runs `server/index.js`, which serves `dist/` plus the `/api` routes.
Pushes to the default branch redeploy automatically.

Set the optional keys in the Render dashboard. `VITE_CESIUM_ION_ACCESS_TOKEN` is
read at **build** time, so it must be set before the build runs.

## Layout

```
src/ephemeris.js   planet and star positions (pure maths, no dependencies)
src/catalog.js     names and copy, shared with the server
src/viewer.js      viewer, imagery, atmosphere, lighting, post-processing
src/sky.js         sun, moon, planets, rings, stars
src/satellites.js  orbits, trails, labels
src/weather.js     GIBS layer stack, EONET, POWER
src/hud.js         control panel
src/panel.js       detail panel
server/nasa-api.js all NASA API routes (Vite middleware and production server)
server/index.js    production static + API server
```

## Controls

`W` weather · `H` hide the panel · `Esc` close details · drag to orbit, scroll to
zoom.

Starlink spacecraft model by Malacodart, distributed under CC BY 4.0. The local copy has a blue material tint. https://sketchfab.com/3d-models/starlink-spacex-satellite-0a60f6720c5141c9a1c6d71aac108b31

## Orbital opening and GroundTruth
The root URL opens Orbital Explorer. Choose FIND A FIELD SITE to enter the existing site workflow. Launch plays a 15-second expedition film with volume, mute and skip controls. The sequence is an illustrative expedition transition.
GroundTruth supports trusted-source search in site inspection and mission control. The mission query includes site, incidents and simulated health scenario. It presents source excerpts and the selected crew context. SERPAPI_KEY remains server-side. Unavailable search leaves mission controls operational.
Mission control offers Performance, Balanced and High rendering settings.
The launch film streams on demand. Reduced-motion users enter mission control directly. [Production files and rebuild instructions](cinematic-source/README.md). Site inspection offers study, operations, logistics and news searches. ASTRA incidents link directly to contextual investigation.
