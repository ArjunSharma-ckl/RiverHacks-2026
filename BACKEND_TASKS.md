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
