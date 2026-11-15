# RiverHacks-2026

## Mission backend

The backend provides a catalog of the four field-test phases, their assigned roles and equipment, a directory of the planetary and Earth science data services, and persistent mission observation logging.

### Run locally

Requires Python 3.10 or later. Lunar mineral refresh requires `h5py`; Mars mineral sampling uses NumPy. Install optional data dependencies with `python -m pip install -r requirements.txt`.

```powershell
python -m backend.server
```

The API listens on `http://127.0.0.1:8000` by default. Set `MISSION_API_HOST`, `MISSION_API_PORT`, or `MISSION_DATA_FILE` to override the bind address, port, or observation file path.

For the browser interface, also start the web app with `npm run dev`. The web server proxies planetary analog requests to `MISSION_BACKEND_URL` (defaults to `http://127.0.0.1:8000`). Set this to the reachable Python API URL for a deployed web app.

### API

- `GET /api/health` — service status.
- `GET /api/phases` — phase objectives, roles, and equipment.
- `GET /api/resources` — provider catalog and documented service entry points.
- `GET /api/landing-sites` — saved NASA Moon and Mars targets plus candidate regions.
- `GET /api/landing-sites?body=Moon` — filter landing targets by body (`Moon` or `Mars`).
- `GET /api/lunar-location?name=Tycho` — resolve an IAU-named lunar feature and return coordinates with temperature and mineral composition when available.
- `GET /api/surface-roughness?name=Haworth&body=Moon` — search a location image with SerpAPI, pass it to Gemini vision, and return a micrometer-scale visual roughness proxy.
- `GET /api/earth-analogs?name=Haworth&top=10` — return up to ten combined Earth analogs for one saved lunar candidate, plus separate top-ten lists for each mineral, temperature, roughness, and combined score. Omit `name` or use `name=all` for lists per saved lunar environment.
- `GET /api/mars-analogs?name=Jezero&top=10` — return separate top-ten Earth rankings for Mars mineral families, temperature, image-derived roughness, and combined available scores.
- `GET /api/earth-analog-attribute?body=Mars&attribute=temperature&value=220&unit=K` — return only the top ten for one selected Moon/Mars attribute (`temperature`, `mineral`, or `roughness`). Mineral searches also require `mineral=olivine`, `plagioclase`, `low_calcium_pyroxene`, `high_calcium_pyroxene`, or `iron`.
- `GET /api/mars-location?name=Jezero` — resolve a Mars feature and return the same location, temperature, and mineral-composition fields.
- `GET /api/lunar-temperatures` — saved annual-average Diviner temperature samples for the nine Artemis lunar candidate regions.
- `POST /api/lunar-temperatures/refresh` — query the NASA PDS Diviner south-polar table and replace the temperature snapshot.
- `GET /api/lunar-minerals` — saved mineral abundance samples for the nine Artemis lunar candidate regions.
- `POST /api/lunar-minerals/refresh` — download the published M3-derived south-polar mineral map and refresh the samples.
- `GET /api/mars-temperature?name=Jezero&ls=0&local_time=12` — query point surface temperature by name or coordinates; `ls` is solar longitude and `local_time` is local Mars hour.
- `GET /api/mars-minerals?name=Jezero` — query mineral estimates by name or coordinates.
- `GET /api/observations?phase_id=phase-1&limit=100` — saved observations, newest first.
- `POST /api/observations` — validate and save an observation as JSON.

### NASA landing targets

The saved snapshot in `backend/data/landing_sites.json` separates mission target regions from candidate sites and includes NASA source URLs and source dates. It records Artemis IV's lunar South Pole target region and NASA's nine Artemis candidate regions. NASA has not published an exact Artemis IV landing point. For Mars, SkyFall is recorded as `site-selection-pending` without invented coordinates. NASA currently says Artemis III is an Earth-orbit lander demonstration, so it is not described as a lunar landing mission.

Refresh the local snapshot after reviewing NASA's source pages with:

```powershell
python -m backend.landing_sites
```

NASA has not exposed these mission targets as one structured feed. The sync algorithm validates NASA provenance, checks body/status/coordinate fields, generates stable IDs, deduplicates records, and atomically replaces the saved snapshot. Update the source-reviewed records in `backend/landing_sites.py` when NASA publishes changes, then run the refresh command.

### Lunar temperature samples

The supplied LOLA query is not a temperature query: LOLA is the laser altimeter, ODE returns product metadata/files rather than parsed temperature values, and `results=json` plus the assumed `div/result/products/product` response path do not match ODE REST v2. The temperature backend uses the PDS LRO Diviner Polar Resource Product instead. Its `temp_avg` values are modeled annual averages in kelvin at 2 cm below the surface.

Run a refresh from the command line with:

```powershell
python -m backend.lunar_temperature
```

The first refresh downloads the approximately 605 MB south-polar PDS table and caches it outside the repository. Set `MISSION_PDS_CACHE_DIR` to choose the cache directory. The saved `backend/data/lunar_temperatures.json` records the nearest mesh-cell sample for one published representative point in each Artemis candidate region, with Celsius conversion and provenance. These are point samples, not whole-region spatial averages or exact crew landing sites. The schema includes temperature units and averaging-period metadata so Earth comparison readings can be added on a like-for-like basis.

The server also exposes an explicit `POST /api/lunar-temperatures/refresh` operation and returns the saved snapshot from `GET /api/lunar-temperatures`. No Earth-location temperatures are populated yet; the current JSON contains the lunar half of the comparison.

### Find Earth locations with similar temperatures

NASA Earthdata's [MODIS/Terra MOD11C3 V061](https://search.earthdata.nasa.gov/search?q=C2565788897-LPCLOUD) provides monthly global land-surface temperatures on a 0.05-degree grid, with separate daytime and nighttime values. The [LP DAAC product guide](https://lpdaac.usgs.gov/documents/118/MOD11_User_Guide_V6.pdf) documents the product family and grid. For an annual comparison, create one row per Earth grid cell by averaging valid daytime and nighttime LST and then averaging the monthly values for a selected year or period. Convert values to kelvin before exporting; omit fill values.

Run the matcher with that annualized grid:

```powershell
python -m backend.earth_temperature_matches --earth-data path\to\modis-annual-lst.csv
```

The CSV needs `latitude`, `longitude`, and `annual_average_kelvin` columns. It also accepts JSON or GeoJSON with the same fields, Celsius annual-temperature fields, or separate annual daytime/nighttime Kelvin fields. The script reads `backend/data/lunar_temperatures.json` and writes `backend/data/earth_temperature_matches.geojson`, with up to ten Earth grid locations per lunar candidate. Each feature includes `match_percentage`, both temperatures, absolute difference, data period, site, and rank. The percentage is `100 × min(lunar K, Earth K) / max(lunar K, Earth K)`: equal temperatures score 100 and larger relative differences score lower.

MODIS values are clear-sky Earth surface temperatures; lunar values are modeled annual averages at 2 cm depth. Treat matches as rough temperature analogues, not like-for-like measurements. This repository does not include an annualized MODIS grid, so the GeoJSON is generated when the Earth data file is supplied. `--top`, `--lunar-data`, and `--output` adjust the run.

### Lunar mineral composition samples

The collector in `backend/lunar_minerals.py` uses the raw 2201 x 2201 x 5 south-polar mineral abundance cube derived from NASA's Moon Mineralogy Mapper (M3) observations and calibrated using LOLA reflectance. The published [Zenodo raw-data release](https://zenodo.org/records/20725024) includes olivine, plagioclase, low- and high-calcium pyroxene, and SmFe at approximately 193 m/pixel; the peer-reviewed [study](https://doi.org/10.1029/2024JE008842) describes coverage from 83°S to the pole. This is a derived research dataset, not a PDS product itself.

Install `h5py` to refresh the MATLAB v7.3/HDF5 product, then run:

```powershell
python -m pip install -r requirements.txt
python -m backend.lunar_minerals
```

The first run downloads about 63 MB and caches it outside the repository. Set `MISSION_MINERAL_CACHE_DIR` to change the cache location. The JSON snapshot `backend/data/lunar_minerals.json` uses the same top-level and site identity/reference-point shape as `lunar_temperatures.json`, with `mineral_composition` in place of `temperature`. It preserves raw source values without interpreting them as percent or fraction. Each value samples one nearest map pixel, not the average composition of the full candidate region. The product covers lunar polar terrain only and does not provide Mars mineral data.

### Mars location, temperature, and mineral data

`GET /api/mars-location?name=Jezero` resolves an IAU-named Mars feature through the USGS Gazetteer-backed GeoCode service and returns the same `location`, `temperature`, and `mineral_composition` structure as the lunar lookup. The separate Mars temperature and mineral endpoints accept a feature `name` or `latitude` plus `longitude_east`. With no location query, they return the Mars mission-target snapshot; SkyFall currently has no published landing coordinates, so its measurements are marked unavailable.

For surface temperature, the backend queries the [Mars Climate Database v6.2](https://www-mars.lmd.jussieu.fr/mcd_python/). It returns modeled surface temperature in kelvin for the requested point, Mars solar longitude (`ls`), and local time. Defaults are `ls=0`, `local_time=12`, and the climatology-average-solar dust scenario. These are climatological model values, not live weather or rover observations. Repeated point requests are cached in memory.

For mineral composition, the backend samples the 4-pixel-per-degree multiband global mineral maps derived from NASA Mars Global Surveyor/TES and distributed by ASU's [TES archive](https://tes.mars.asu.edu/products/). The maps include plagioclase, olivine, low- and high-calcium pyroxene, hematite, and other components. The first query downloads the 51 MB ENVI map to a temporary cache; set `MISSION_MARS_MINERAL_CACHE_DIR` to change the cache directory. The returned four-mineral vector uses the same olivine, plagioclase, and low/high-calcium pyroxene keys as the PetDB Earth matcher; normalize values before comparison. TES spectral estimates are not PetDB modal percentages, and map pixels without source data are reported as unavailable rather than interpolated.

### Image roughness and combined Earth analogs

Open `/analog-search.html` for the text-only Moon/Mars analog finder. Choose a named location to return the mineral, temperature, roughness, and combined lists, or select one attribute to receive only that ranking.

Copy `.env.example` to `.env` and set `SERPAPI_API_KEY` and `GEMINI_API_KEY`. The ignored `.env` is loaded by the backend at startup; exported process environment variables override values from that file. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. You can request one location's visual texture estimate with `GET /api/surface-roughness?name=Haworth&body=Moon` or coordinate hints with `latitude` and `longitude`.

Gemini returns `surface_roughness_um`, a range, confidence, and the selected image's source page. Treat this as a model-generated visual proxy, not physical profilometry: ordinary web images rarely have a calibrated scale, and Gemini cannot establish true micrometer-scale Ra/Rq from an unscaled photograph. The response marks unscaled estimates as low confidence and includes the image provenance and limitations.

`GET /api/earth-analogs?name=Haworth&top=10` returns a `rankings.by_lunar_environment` list with separate top-ten GeoJSON feature lists for olivine, plagioclase, low-calcium pyroxene, high-calcium pyroxene, iron-bearing minerals, temperature, roughness, and all available metrics combined. The top-level `features` array is the combined top ten for each requested environment. Each ranked feature includes its `match_rank` and the corresponding match percentage. `name` can be a saved lunar site or `all`; the all-sites query returns lists per lunar environment and does not automatically make image-provider calls. For a selected site, the endpoint requests roughness estimates when both API keys are configured; use `include_roughness=true` to request explicitly. It ranks records with more available dimensions ahead of partial records and identifies missing scoring dimensions in each feature.

`GET /api/mars-analogs?name=Jezero&top=10` resolves the Mars feature, samples the Mars Climate Database and TES mineral map, asks SerpAPI for a Mars location image, and passes that image to Gemini for a micrometer roughness proxy when both provider keys are configured. It returns separate top-ten mineral, temperature, roughness, and combined lists under `rankings.by_environment`. The temperature ranking uses the saved Earth MODIS candidate grid; the mineral ranking uses the same EarthChem end-member formula fits described below. The Mars mineral map reports TES spectral abundance estimates, not EarthChem oxide chemistry, so mineral formula matches indicate family fit rather than a direct Mars-to-Earth chemical comparison. Without roughness credentials, that list is empty and the response marks roughness unavailable.

`GET /api/earth-analog-attribute` takes one temperature, one mineral family, or one roughness value and returns only the selected ranking. It ignores the other dimensions. Temperature accepts `K` or `C`; roughness is in micrometers. A mineral query ranks EarthChem samples by the closest fixed formula end-member for that family.

The endpoint uses the current EarthChem PetDB oxide-analysis CSV by default. It converts reported oxide weight percentages to atom proportions, then compares each Earth sample with fixed mineral end-members: olivine `Mg2SiO4` / `Fe2SiO4`, plagioclase `NaAlSi3O8` / `CaAl2Si2O8`, low-calcium pyroxene `Mg2Si2O6` / `Fe2Si2O6`, and high-calcium pyroxene `CaMgSi2O6` / `CaFeSi2O6`; iron-bearing analyses are compared with Fe, FeO, and Fe2O3. The closest formula is returned as `earth_best_fit_formula`, and `earth_formula_match_percentage` measures its normalized elemental-vector similarity. Silicate scores use cation proportions, while iron scores include oxygen to distinguish native iron from oxides. Intermediate solid-solution compositions score between their end-members. Incomplete formula inputs are skipped; unclassified pyroxene analyses are assigned to whichever low- or high-calcium end-member family fits better. A candidate's combined mineral score averages formula-fit scores only for mineral groups present in the selected lunar abundance pixel. These are Earth-side ideal-formula fit scores, not direct Lunar-to-Earth chemistry scores: the lunar map contains mineral abundance values, not lunar oxide analyses. The PetDB results are georeferenced sample points, and formula fit does not imply regional abundance. Set `EARTH_MINERAL_DATA_FILE` for another oxide-analysis CSV or `EARTH_MINERAL_MATCH_FILE` for a precomputed match FeatureCollection. The committed MODIS comparison currently uses one monthly composite; full-year temperature comparisons require twelve monthly granules and a refreshed annual match file.

### Export Earth mineral data from PetDB

The PetDB exporter requests georeferenced data with modal olivine (`OL[MODE]`), plagioclase (`PLAG[MODE]`), pyroxene (`PX[MODE]`, `OPX[MODE]`, `CPX[MODE]`), and iron-bearing modes (`FE-OX[MODE]`, `FE-ORE[MODE]`). It also requests whole-rock `FeO` and `FeOT` chemistry; these bulk iron measurements are separate from the iron-bearing mineral modes. The official [PetDB API](https://earthchem.github.io/ec-doc/documentation/petdb_api.html) supports asynchronous CSV/JSON export tasks.

```powershell
python -m backend.petdb_export --output backend/data/petdb_rock_modes.csv
```

Use `--format json` for a JSON export. If PetDB requires authentication, set `PETDB_API_TOKEN` in the environment. The exporter submits a remote PetDB task, polls until the file is ready, then saves it locally. The resulting CSV can be passed to the lunar mineral matcher below.

### Compare lunar minerals with Earth locations

[EarthChem PetDB Explore](https://explore.earthchem.org/) provides georeferenced rock samples with modal mineral data. The [PetDB API documentation](https://earthchem.github.io/ec-doc/documentation/petdb_api.html) describes sample location and export services. Download/export `ROCK MODE` / `Whole Rock` records with `OL[MODE]`, `PLAG[MODE]`, `OPX[MODE]`, and `CPX[MODE]` columns. Keep modal percentage data; the matcher skips rows explicitly labeled weight- or mole-percent and skips incomplete compositions.

Run the matcher with a PetDB export:

```powershell
python -m backend.earth_mineral_matches --earth-data path\to\petdb-rock-modes.csv
```

The script reads `backend/data/lunar_minerals.json` and writes `backend/data/earth_mineral_matches.geojson`. It returns up to ten Earth samples for each lunar candidate with a complete shared composition. GeoJSON coordinates use `[longitude, latitude]`; feature properties include `match_percentage`, rank, sample identity, source mineral modes, and normalized compositions. The score is `100 × (1 − normalized L1 distance / 2)`: 100 is an exact relative-composition match and 0 is maximally different. Lunar values are normalized because the M3 source map describes them as raw abundance-array values without a documented percent scale. The score compares relative abundance only; it is not a confidence probability. Lunar low-/high-calcium pyroxene are compared to the broad Earth OPX/CPX families, and SmFe is omitted because there is no directly comparable Earth modal channel.

PetDB locations are sample locations, not continuous global mineral maps. This repository does not include a PetDB export; the GeoJSON is produced when an export is supplied. `--top 10`, `--lunar-data`, and `--output` can be used to adjust the ranking count or file paths.

### Look up a lunar crater or mountain

Use the combined lookup endpoint with a feature name, for example:

```text
GET /api/lunar-location?name=Tycho
```

The backend resolves feature names through GeoCode, which uses the USGS/IAU Gazetteer of Planetary Nomenclature. It returns the gazetteer feature center, then samples the nearest Diviner temperature mesh cell and the corresponding M3-derived mineral map pixel when the source products are cached. Run `python -m backend.lunar_temperature` and `python -m backend.lunar_minerals` (or their API refresh routes) first to cache those products. Known Artemis candidate names can use their saved representative-point snapshots if a full product is not cached; the response marks that these coordinates may differ from the feature center. Data fields include an availability status and reason when a product does not cover a feature or is not cached. Ambiguous gazetteer matches return HTTP 409 with candidate names; unknown names return HTTP 404.

Example observation:

```json
{
  "phase_id": "phase-1",
  "role": "Autonomous Systems Engineer",
  "equipment_id": "scout-rover",
  "site_id": "polar-test-site-a",
  "measurements": {"slope_degrees": 14.2, "slip_events": 1},
  "notes": "Rover maintained traction on the loose scree segment."
}
```

Observation records are appended to `backend/data/observations.jsonl` by default. The service binds to loopback and is intended for local development; add authentication and deployment controls before exposing it to a shared network.

Data were downloaded from PetDB 2.0 (https://earthchem.org) on November 14 2026, using the following parameters: Analyzed Materials = Mineral: (Olivine, Plagioclase, Pyroxene (Not Classified), Saponite-Iron-Oxide)

See [BACKEND_TASKS.md](BACKEND_TASKS.md) for the saved backend task list and implementation notes.
