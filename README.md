# RiverHacks-2026

## Mission backend

The backend provides a catalog of the four field-test phases, their assigned roles and equipment, a directory of the planetary and Earth science data services, and persistent mission observation logging.

### Run locally

Requires Python 3.10 or later. The API uses the standard library; refreshing mineral data also requires `h5py` from `requirements.txt`.

```powershell
python -m backend.server
```

The API listens on `http://127.0.0.1:8000` by default. Set `MISSION_API_HOST`, `MISSION_API_PORT`, or `MISSION_DATA_FILE` to override the bind address, port, or observation file path.

### API

- `GET /api/health` — service status.
- `GET /api/phases` — phase objectives, roles, and equipment.
- `GET /api/resources` — provider catalog and documented service entry points.
- `GET /api/landing-sites` — saved NASA Moon and Mars targets plus candidate regions.
- `GET /api/landing-sites?body=Moon` — filter landing targets by body (`Moon` or `Mars`).
- `GET /api/lunar-location?name=Tycho` — resolve an IAU-named lunar feature and return coordinates with temperature and mineral composition when available.
- `GET /api/lunar-temperatures` — saved annual-average Diviner temperature samples for the nine Artemis lunar candidate regions.
- `POST /api/lunar-temperatures/refresh` — query the NASA PDS Diviner south-polar table and replace the temperature snapshot.
- `GET /api/lunar-minerals` — saved mineral abundance samples for the nine Artemis lunar candidate regions.
- `POST /api/lunar-minerals/refresh` — download the published M3-derived south-polar mineral map and refresh the samples.
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

### Lunar mineral composition samples

The collector in `backend/lunar_minerals.py` uses the raw 2201 x 2201 x 5 south-polar mineral abundance cube derived from NASA's Moon Mineralogy Mapper (M3) observations and calibrated using LOLA reflectance. The published [Zenodo raw-data release](https://zenodo.org/records/20725024) includes olivine, plagioclase, low- and high-calcium pyroxene, and SmFe at approximately 193 m/pixel; the peer-reviewed [study](https://doi.org/10.1029/2024JE008842) describes coverage from 83°S to the pole. This is a derived research dataset, not a PDS product itself.

Install `h5py` to refresh the MATLAB v7.3/HDF5 product, then run:

```powershell
python -m pip install -r requirements.txt
python -m backend.lunar_minerals
```

The first run downloads about 63 MB and caches it outside the repository. Set `MISSION_MINERAL_CACHE_DIR` to change the cache location. The JSON snapshot `backend/data/lunar_minerals.json` uses the same top-level and site identity/reference-point shape as `lunar_temperatures.json`, with `mineral_composition` in place of `temperature`. It preserves raw source values without interpreting them as percent or fraction. Each value samples one nearest map pixel, not the average composition of the full candidate region. The product covers lunar polar terrain only and does not provide Mars mineral data.

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

See [BACKEND_TASKS.md](BACKEND_TASKS.md) for the saved backend task list and implementation notes.
