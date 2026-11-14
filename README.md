# RiverHacks 2026 — God's Eye

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
