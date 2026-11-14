# RiverHacks-2026

## Mission backend

The backend provides a catalog of the four field-test phases, their assigned roles and equipment, a directory of the planetary and Earth science data services, and persistent mission observation logging.

### Run locally

Requires Python 3.10 or later. No third-party packages are needed.

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
- `GET /api/observations?phase_id=phase-1&limit=100` — saved observations, newest first.
- `POST /api/observations` — validate and save an observation as JSON.

### NASA landing targets

The saved snapshot in `backend/data/landing_sites.json` separates mission target regions from candidate sites and includes NASA source URLs and source dates. It records Artemis IV's lunar South Pole target region and NASA's nine Artemis candidate regions. NASA has not published an exact Artemis IV landing point. For Mars, SkyFall is recorded as `site-selection-pending` without invented coordinates. NASA currently says Artemis III is an Earth-orbit lander demonstration, so it is not described as a lunar landing mission.

Refresh the local snapshot after reviewing NASA's source pages with:

```powershell
python -m backend.landing_sites
```

NASA has not exposed these mission targets as one structured feed. The sync algorithm validates NASA provenance, checks body/status/coordinate fields, generates stable IDs, deduplicates records, and atomically replaces the saved snapshot. Update the source-reviewed records in `backend/landing_sites.py` when NASA publishes changes, then run the refresh command.

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
