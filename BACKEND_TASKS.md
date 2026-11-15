# Backend Task Memory

This file is the project's durable memory for backend scope, decisions, and completion status. The field sequence remains the operational plan; this list records the backend work needed to support it.

## Backend tasks

- [x] Model the four field-test phases and their objectives as stable API data.
- [x] Associate each phase with its tested roles and equipment, including readable descriptions for the front end.
- [x] Publish a data-source catalog for PDS, Earthdata/GIBS, USGS Astrogeology/Astropedia, AHED, and NASA Trek.
- [x] Record official discovery and service entry points so clients can link to planetary, terrain, environment, and habitability data.
- [x] Accept, validate, timestamp, identify, and persist field observations keyed to phase, role, and equipment.
- [x] Support listing observations with phase filtering and a bounded result limit.
- [x] Provide a small HTTP API with health reporting and actionable JSON errors.
- [x] Document local startup, configuration, routes, and the observation format.
- [x] Normalize and save current NASA lunar and Mars landing-target records with source provenance and a safe unresolved-site status.
- [x] Provide a read API for saved landing targets and body-specific candidate regions.
- [x] Query NASA PDS Diviner south-polar annual-average temperatures for the nine Artemis candidate regions and save the sampled values as JSON.
- [x] Serve the saved lunar temperature snapshot and provide an explicit refresh operation.
- [x] Sample published M3-derived lunar south-polar mineral abundance maps at the nine Artemis candidate points and save matched JSON records.
- [x] Serve the saved lunar mineral snapshot and provide an explicit refresh operation.
- [x] Resolve named lunar features through the USGS/IAU Gazetteer-backed service and return colocated Diviner temperature and M3-derived mineral samples when available.
- [x] Match lunar mineral abundance vectors against georeferenced Earth rock-mode samples and save the top ten per lunar site as GeoJSON with match percentages.
- [x] Request and download a PetDB export with modal olivine, plagioclase, pyroxene, iron-bearing phases, and whole-rock iron-oxide chemistry fields.
- [x] Match annual lunar surface temperatures against global Earth land-surface-temperature grid cells and save the top ten per lunar site as GeoJSON with match percentages.

## Implementation decisions

- Use Python's standard library so the starter backend runs without dependency installation.
- Keep phase, role, and equipment identifiers stable and use labels from the supplied field sequence.
- Save observations as newline-delimited JSON. This is simple for a hackathon prototype and easy to import into a later database.
- Expose external services as a catalog of authoritative entry points and protocols. Do not proxy or scrape provider data until the client specifies target bodies, query fields, credentials, and the desired response shape.
- Keep server bind host on loopback by default; `MISSION_API_HOST`, `MISSION_API_PORT`, and `MISSION_DATA_FILE` configure deployment and storage.

## Phase-to-backend mapping

1. **Robotic remote reconnaissance & navigation mapping** — rover/drone observations can record terrain, fissure, navigation, and aerial-mapping measurements.
2. **Subsurface exploration & lava tube integrity analysis** — GPR, seismic, and borehole observations can record structural and wall-rock findings.
3. **ISRU & water extraction** — drilling and thermal-tent observations can record extraction, filtration, and yield measurements.
4. **Human EVA operations & habitat integration** — EVA and habitat observations can record fatigue, mobility, umbilical, dexterity, and ingress/egress findings.

Each observation supports an open-ended `measurements` object so phase-specific instrument outputs can be captured without losing the common phase/role/equipment relationship.

## Landing-target memory

- `backend/landing_sites.py` validates and reconciles the source-reviewed Moon/Mars records, creates deterministic IDs, removes duplicates, and atomically writes `backend/data/landing_sites.json`.
- `GET /api/landing-sites` returns both mission targets and candidate regions; `?body=Moon` or `?body=Mars` filters both lists.
- The Artemis IV target is currently the lunar South Pole region; the point landing site is not published. The nine NASA candidate regions are labeled as candidates, not selected sites.
- NASA's SkyFall Mars site remains pending selection. The record intentionally has no site name or coordinates until NASA publishes one.
- NASA's mission pages do not expose the target records as a unified structured feed. Review/update the source records from the cited NASA pages and run `python -m backend.landing_sites` to refresh the saved snapshot.

## Lunar temperature memory

- `backend/lunar_temperature.py` reads the PDS LRO Diviner Polar Resource Product (`LRO-L-DLRE-5-PRP-V2.0`, `DLRE_PRP_SOUTH.TAB`) and samples the nearest mesh cell for one published representative point in each Artemis candidate region.
- The product's `temp_avg` column is annual-average temperature in kelvin at 2 cm depth. The product models the first mapping year's polar observations; it is not a live weather feed.
- Region points are representative published coordinates, not exact selected landing sites. The saved values are sampled at a nearby mesh cell, not spatial means over entire candidate-region boundaries.
- The PDS table is about 605 MB. The downloader caches it in the system temporary directory; `MISSION_PDS_CACHE_DIR` can point to another cache location. The source archive and fixed-width column layout are linked in code and in the generated JSON.
- Run `python -m backend.lunar_temperature` or send `POST /api/lunar-temperatures/refresh` to query and save `backend/data/lunar_temperatures.json`. Read the saved snapshot with `GET /api/lunar-temperatures`.
- The schema stores kelvin and Celsius alongside the point, source, and averaging metadata so Earth comparison data can later be added without confusing units or averaging windows. It does not fabricate Earth values.

## Lunar mineral composition memory

- `backend/lunar_minerals.py` samples the raw south-polar mineral abundance cube derived from NASA's Moon Mineralogy Mapper (M3) data and calibrated using LOLA reflectance. The raw v4 product is distributed at [Zenodo DOI 10.5281/zenodo.20725024](https://zenodo.org/records/20725024); it is a 2201 x 2201 x 5 MATLAB v7.3/HDF5 cube at approximately 193 m/pixel. The peer-reviewed study ([DOI 10.1029/2024JE008842](https://doi.org/10.1029/2024JE008842)) describes its 83°S–90°S coverage.
- Each mineral record is keyed to the matching temperature snapshot's `landing_site_id`, mission, status, name, representative point, and sampled cell. It stores source array values for olivine, plagioclase, low- and high-calcium pyroxene, and SmFe; no scale conversion is applied because the record does not specify a percent/fraction scale.
- The first collection downloads the 63 MB file, verifies its published size and MD5 checksum, and caches it outside the repository. Set `MISSION_MINERAL_CACHE_DIR` to choose another cache directory. Refresh requires `h5py` (`python -m pip install -r requirements.txt`).
- Run `python -m backend.lunar_minerals` or send `POST /api/lunar-minerals/refresh` to save `backend/data/lunar_minerals.json`; read it with `GET /api/lunar-minerals`. These are single-pixel representative samples, not means over candidate-region boundaries. The product is lunar-only and supplies no Mars mineral data.
- `GET /api/lunar-location?name=Tycho` resolves a lunar crater/mountain name using GeoCode (whose feature list is sourced from the USGS/IAU Gazetteer), and samples both source products at the gazetteer feature center when their local caches are present. It returns per-product `available`/`unavailable` statuses; exact Artemis candidate names can instead return their saved representative-point samples with a note that the coordinate can differ from the gazetteer feature center. Ambiguous matches return HTTP 409, unknown names HTTP 404. Refresh the temperature/mineral collectors once to cache full products for arbitrary feature sampling.

## Earth mineral matches memory

- `backend/petdb_export.py` submits an asynchronous CSV/JSON export to the EarthChem PetDB REST API and polls until a download is available. It requests `OL[MODE]`, `PLAG[MODE]`, `PX[MODE]`, `OPX[MODE]`, `CPX[MODE]`, `FE-OX[MODE]`, `FE-ORE[MODE]`, `FeO`, and `FeOT`; the final two are whole-rock iron chemistry, not mineral modes.
- Run `python -m backend.petdb_export --output backend/data/petdb_rock_modes.csv`. The default output is `backend/data/petdb_rock_modes.csv`; use `--format json` for JSON. Set `PETDB_API_TOKEN` if the export API requires a bearer token. The exporter itself was not submitted during implementation because export submission creates a remote task.
- `backend/earth_mineral_matches.py` uses EarthChem PetDB sample-level rock-mode data, which includes specimen coordinates and modal mineral abundances. The PetDB Explore page and [API documentation](https://earthchem.github.io/ec-doc/documentation/petdb_api.html) are the source/discovery resources.
- Export `ROCK MODE` / `Whole Rock` data with `OL[MODE]`, `PLAG[MODE]`, `OPX[MODE]`, and `CPX[MODE]` columns from PetDB, then run `python -m backend.earth_mineral_matches --earth-data <export.csv>`. JSON and GeoJSON exports are also accepted. The script reads the existing lunar mineral snapshot and atomically writes `backend/data/earth_mineral_matches.geojson`; `--top` changes the default 10 matches per lunar site.
- A GeoJSON feature represents one georeferenced Earth sample matched to one lunar candidate. `match_percentage` is a normalized L1-composition similarity: `100 × (1 − L1 distance / 2)`, where 100 means identical relative proportions and 0 means maximally different. Every input vector is normalized over the four shared mineral groups before scoring.
- The mapper pairs lunar low-/high-calcium pyroxene with Earth OPX/CPX as broad family analogues, excludes the lunar-only SmFe channel, requires all four measured Earth modes and valid coordinates, and skips rows explicitly marked wt% or mol%. EarthChem coverage is sample-based, not a continuous map; the score is similarity, not probability. No EarthChem export is vendored, so the GeoJSON is generated when the user supplies a PetDB export.

## Earth temperature matches memory

- `backend/earth_temperature_matches.py` ranks NASA MODIS Terra `MOD11C3.061` monthly global land-surface-temperature grid cells against the nine saved Diviner lunar candidate temperatures. It accepts annual CSV/JSON/GeoJSON grids or MOD11C3 V061 HDF4 monthly granules directly. The HDF path streams the 0.05-degree global day/night layers, applies the product scale and mandatory QA bits, averages usable day/night channels, then averages available months per cell.
- Install `pyhdf` and NumPy via `python -m pip install -r requirements.txt`. Run `python -m backend.earth_temperature_matches --earth-data <annual-grid.csv>` or pass an HDF granule/directory, such as `backend/data`; `--year`, `--min-months`, `--top`, `--lunar-data`, and `--output` configure HDF year selection, pixel coverage, result count, lunar input, and output path.
- The supplied `backend/data/MOD11C3.A2026274.061.2026307175827.hdf` covers October 2026 only. Its generated GeoJSON has the top ten cell matches for each of nine lunar sites; its Earth values are a one-month sample, not annual averages. `earth_months_observed` and `earth_full_year_coverage` report per-cell coverage; use all 12 granules and `--min-months 12` for full-year-only results.
- Every GeoJSON feature includes `match_percentage`, defined as `100 × min(lunar K, Earth K) / max(lunar K, Earth K)`. It is a symmetric temperature-ratio similarity score (100 for equal temperatures), not a probability. Earth grid positions are sample cell centers, not weather stations. Earth MODIS clear-sky surface temperatures are not directly equivalent to the lunar thermal-model annual average at 2 cm depth, so interpret matches as rough temperature analogues only.
- The committed example GeoJSON is based on the supplied October 2026 monthly granule. It is intentionally labeled as a one-month comparison; provide all twelve monthly granules and set `--min-months 12` to generate only full-year grid-cell matches.

## Mars location, temperature, and mineral endpoints

- `GET /api/mars-location?name=Jezero` follows the lunar-location response shape and uses the USGS/IAU Gazetteer-backed GeoCode Mars feature list for coordinates. It reports `resolved`, `ambiguous`, and `not-found` states with independently available/unavailable temperature and mineral products.
- `GET /api/mars-temperature?name=Jezero&ls=0&local_time=12` and coordinate queries call the Mars Climate Database v6.2 point interface. This is the best general point resource for a surface-temperature estimate because it interpolates modeled ground temperature at a requested location, Mars solar longitude, and local time. The values are modeled climatology, not current weather. Defaults are Ls 0°, local noon, and the average-solar dust scenario; repeated point requests are cached in process.
- `GET /api/mars-minerals?name=Jezero` samples the global MGS/TES mineral-abundance maps maintained by ASU. The numeric multiband ENVI cube is 4 pixels/degree (about 15 km per equatorial pixel), carries 13 spectral abundance/error components, and is sampled without interpolation. `MISSION_MARS_MINERAL_CACHE_DIR` changes the temporary 51 MB source-map cache.
- The returned Earth-comparison vector uses `olivine`, `plagioclase`, `low_calcium_pyroxene`, and `high_calcium_pyroxene`, matching the PetDB matcher’s four modal groups. It preserves raw TES unitless spectral estimates and must be normalized before comparison to PetDB modal percentages; these are not the same measurement method. Hematite is returned separately as an iron-oxide indicator, and no-data map cells (`-1`) are reported unavailable.
- Without a name or coordinate query, the Mars temperature/mineral endpoints return the saved Mars mission-target record. SkyFall remains site-selection-pending with no coordinates, so its values are explicitly unavailable rather than fabricated.

## Image roughness and combined Earth analogs

- `GET /api/surface-roughness` searches Google Images through SerpAPI for a named Moon/Earth/Mars location, fetches a safe public image, and asks Gemini multimodal vision for a roughness proxy in micrometers with confidence, interval, image source, and limitations.
- `GET /api/earth-analogs` returns up to ten GeoJSON Earth candidates per selected lunar environment. It combines saved MODIS temperature analogs with PetDB modal-mineral matches and Gemini image roughness when configured, reports missing dimensions, and puts complete three-factor matches ahead of partial results.
- `.env.example` lists the SerpAPI/Gemini keys and optional Earth modal export path; `.env` is ignored by Git and loaded by the service. A real API key must be supplied by the operator.
- Image-derived µm values are visual proxies rather than calibrated profilometry. The current PetDB CSV in `backend/data/earthchem_data` contains oxide chemistry rather than modal mineral fields, and the saved MODIS match grid covers one month; these inputs produce explicitly partial scores until compatible Earth modal data and annual MODIS coverage are provided.
