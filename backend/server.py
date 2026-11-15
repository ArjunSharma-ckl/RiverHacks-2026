"""Small standard-library HTTP API for mission planning and field observations."""

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from backend.catalog import EQUIPMENT_BY_ID, PHASES, PHASE_BY_ID, RESOURCES
from backend.earth_analogs import select_earth_analogs
from backend.image_roughness import estimate_surface_roughness
from backend.landing_sites import load_snapshot
from backend.lunar_location import lookup_lunar_location
from backend.lunar_minerals import load_mineral_snapshot, refresh_lunar_minerals
from backend.lunar_temperature import load_temperature_snapshot, refresh_lunar_temperatures
from backend.mars_location import feature_location, lookup_mars_location, resolve_mars_feature
from backend.mars_minerals import MARS_MINERALS_SOURCE, sample_mars_minerals
from backend.mars_temperature import MCD_SOURCE, query_mars_temperature
from backend.storage import append_observation, list_observations


MAX_BODY_BYTES = 1_000_000
MAX_LIST_LIMIT = 500


def _mars_location_from_query(query):
    name = query.get("name", [None])[0]
    if name is not None:
        feature, matches = resolve_mars_feature(name)
        if feature is None:
            status = "not-found" if not matches else "ambiguous"
            code = 404 if status == "not-found" else 409
            return None, code, {
                "schema_version": 1,
                "status": status,
                "query": {"body": "Mars", "name": name.strip()},
                "matches": [
                    {
                        "name": item["name"],
                        "feature_type": item["feature_type"],
                        "latitude": item["latitude"],
                        "longitude_east": item["longitude_east"],
                        "diameter_km": item["diameter_km"],
                    }
                    for item in matches[:10]
                ],
            }
        return feature_location(feature), None, None

    latitude = query.get("latitude", [None])[0]
    longitude_east = query.get("longitude_east", query.get("longitude", [None]))[0]
    if latitude is None and longitude_east is None:
        return None, None, None
    if latitude is None or longitude_east is None:
        raise RequestError("Both latitude and longitude_east are required for a coordinate query.")
    try:
        latitude = float(latitude)
        longitude_east = float(longitude_east)
    except (TypeError, ValueError) as error:
        raise RequestError("Mars latitude and longitude_east must be numeric.") from error
    if (
        not (-90.0 <= latitude <= 90.0)
        or not (-360.0 <= longitude_east <= 720.0)
        or any(value != value or abs(value) == float("inf") for value in (latitude, longitude_east))
    ):
        raise RequestError("Mars coordinates must be finite, with latitude between -90 and 90.")
    longitude_east %= 360.0
    return {
        "name": "Coordinate query",
        "feature_type": None,
        "latitude": latitude,
        "longitude_east": longitude_east,
        "diameter_km": None,
        "origin": None,
        "coordinate_source": "caller-supplied coordinates",
        "coordinate_source_url": None,
        "coordinate_type": "point coordinates",
        "coordinate_system": "Mars planetocentric latitude and east longitude",
    }, None, None


def _mars_pending_snapshot(measurement, source):
    snapshot = load_snapshot()
    records = []
    for target in snapshot.get("targets", []):
        if target.get("body") != "Mars":
            continue
        records.append({
            "landing_site_id": target.get("id"),
            "body": "Mars",
            "mission": target.get("mission"),
            "status": target.get("status"),
            "site_name": target.get("site_name"),
            "reference_point": target.get("coordinates"),
            measurement: {
                "status": "unavailable",
                "value": None,
                "reason": "The Mars mission target has no published landing-site coordinates. Query a named Mars feature or provide latitude and longitude_east.",
            },
        })
    return {
        "schema_version": 1,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": source,
        "records": records,
    }


def _mars_point_snapshot(location, measurement, value, source):
    return {
        "schema_version": 1,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": source,
        "records": [{
            "landing_site_id": None,
            "body": "Mars",
            "mission": None,
            "status": "named-feature",
            "site_name": location["name"],
            "reference_point": {
                "latitude": location["latitude"],
                "longitude_east": location["longitude_east"],
                "coordinate_type": location["coordinate_type"],
                "coordinate_source_url": location.get("coordinate_source_url"),
            },
            "sample_cell": value.get("sample_cell"),
            measurement: value,
        }],
    }


class RequestError(ValueError):
    """An invalid client request with a safe message for the response."""


def _json_value(value, path="measurements", depth=0):
    if depth > 8:
        raise RequestError(f"{path} is nested too deeply.")
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise RequestError(f"{path} must not contain non-finite numbers.")
        return
    if isinstance(value, list):
        if len(value) > 1000:
            raise RequestError(f"{path} has too many items.")
        for index, item in enumerate(value):
            _json_value(item, f"{path}[{index}]", depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > 1000 or any(not isinstance(key, str) for key in value):
            raise RequestError(f"{path} must be a JSON object with string keys.")
        for key, item in value.items():
            _json_value(item, f"{path}.{key}", depth + 1)
        return
    raise RequestError(f"{path} contains a value that is not valid JSON.")


def _normalize_observation(payload):
    if not isinstance(payload, dict):
        raise RequestError("Request body must be a JSON object.")

    phase_id = payload.get("phase_id")
    if phase_id not in PHASE_BY_ID:
        raise RequestError("phase_id must match one of the published mission phases.")

    role = payload.get("role")
    phase = PHASE_BY_ID[phase_id]
    if role not in phase["roles"]:
        raise RequestError("role must be assigned to the selected phase.")

    equipment_id = payload.get("equipment_id")
    assignment = EQUIPMENT_BY_ID.get(equipment_id)
    if assignment is None or assignment[0]["id"] != phase_id:
        raise RequestError("equipment_id must be assigned to the selected phase.")

    measurements = payload.get("measurements")
    if not isinstance(measurements, dict):
        raise RequestError("measurements must be a JSON object.")
    _json_value(measurements)

    observed_at = payload.get("observed_at")
    if observed_at is None:
        observed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    elif not isinstance(observed_at, str):
        raise RequestError("observed_at must be an ISO 8601 timestamp string.")
    else:
        try:
            parsed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise RequestError("observed_at must be a valid ISO 8601 timestamp.") from error
        if parsed.tzinfo is None:
            raise RequestError("observed_at must include a timezone.")

    record = {
        "id": str(uuid4()),
        "observed_at": observed_at,
        "phase_id": phase_id,
        "role": role,
        "equipment_id": equipment_id,
        "measurements": measurements,
    }

    for field, max_length in (("mission_id", 120), ("site_id", 160), ("notes", 5000)):
        value = payload.get(field)
        if value is not None:
            if not isinstance(value, str):
                raise RequestError(f"{field} must be a string.")
            if len(value) > max_length:
                raise RequestError(f"{field} must be no longer than {max_length} characters.")
            record[field] = value

    return record


class MissionRequestHandler(BaseHTTPRequestHandler):
    server_version = "RiverHacksMissionAPI/1.0"

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))

    def _send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _read_json(self):
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError as error:
            raise RequestError("Content-Length must be an integer.") from error
        if length < 1:
            raise RequestError("A JSON request body is required.")
        if length > MAX_BODY_BYTES:
            raise RequestError("Request body exceeds the 1 MB limit.")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise RequestError("Content-Type must be application/json.")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RequestError("Request body must contain valid UTF-8 JSON.") from error

    def do_GET(self):
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path in {"/", "/api", "/api/"}:
                self._send_json(200, {
                    "service": "RiverHacks Mission API",
                    "status": "ok",
                    "message": "Choose an API endpoint from this directory.",
                    "endpoints": [
                        {"method": "GET", "path": "/api/health", "description": "Service status."},
                        {"method": "GET", "path": "/api/phases", "description": "Mission phases, roles, and equipment."},
                        {"method": "GET", "path": "/api/resources", "description": "Planetary and Earth science data providers."},
                        {"method": "GET", "path": "/api/landing-sites", "description": "Saved Moon and Mars targets and candidate regions."},
                        {"method": "GET", "path": "/api/lunar-location?name=Mons%20Mouton", "description": "Resolve a lunar feature and return available temperature and mineral data."},
                        {"method": "GET", "path": "/api/surface-roughness?name=Haworth&body=Moon", "description": "Find a location image with SerpAPI and request Gemini's visual roughness proxy in micrometers."},
                        {"method": "GET", "path": "/api/earth-analogs?name=Haworth&top=10", "description": "Return top-ten Earth rankings for formula-fit mineral chemistry, temperature, roughness, and combined match score."},
                        {"method": "GET", "path": "/api/mars-location?name=Jezero", "description": "Resolve a Mars feature and return available temperature and mineral data."},
                        {"method": "GET", "path": "/api/lunar-temperatures", "description": "Saved lunar temperature samples."},
                        {"method": "GET", "path": "/api/lunar-minerals", "description": "Saved lunar mineral samples."},
                        {"method": "GET", "path": "/api/mars-temperature?name=Jezero", "description": "Point surface-temperature estimate from Mars Climate Database v6.2."},
                        {"method": "GET", "path": "/api/mars-minerals?name=Jezero", "description": "Point mineral estimates from global MGS/TES maps."},
                        {"method": "GET", "path": "/api/observations", "description": "Saved mission observations."},
                        {"method": "POST", "path": "/api/observations", "description": "Validate and save a mission observation."},
                        {"method": "POST", "path": "/api/lunar-temperatures/refresh", "description": "Refresh lunar temperatures from NASA PDS."},
                        {"method": "POST", "path": "/api/lunar-minerals/refresh", "description": "Refresh lunar mineral samples."},
                    ],
                })
                return
            if parsed.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if parsed.path == "/api/health":
                self._send_json(200, {"status": "ok"})
                return
            if parsed.path == "/api/phases":
                self._send_json(200, {"phases": PHASES})
                return
            if parsed.path == "/api/resources":
                self._send_json(200, {"resources": RESOURCES})
                return
            if parsed.path == "/api/landing-sites":
                body = query.get("body", [None])[0]
                if body is not None:
                    body = {"moon": "Moon", "mars": "Mars"}.get(body.casefold())
                    if body is None:
                        raise RequestError("body must be Moon or Mars.")
                try:
                    snapshot = load_snapshot()
                except (OSError, json.JSONDecodeError):
                    self._send_json(500, {"error": "Could not read the landing-site snapshot."})
                    return
                if body is not None:
                    snapshot["targets"] = [item for item in snapshot["targets"] if item["body"] == body]
                    snapshot["candidate_sites"] = [
                        item for item in snapshot["candidate_sites"] if item["body"] == body
                    ]
                self._send_json(200, snapshot)
                return
            if parsed.path == "/api/lunar-location":
                name = query.get("name", [None])[0]
                if name is None or not name.strip():
                    raise RequestError("name is required and must contain a lunar crater or mountain name.")
                try:
                    result = lookup_lunar_location(name)
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except (OSError, RuntimeError) as error:
                    self._send_json(502, {"error": "Could not resolve the lunar feature or sample its data.", "detail": str(error)})
                    return
                status_code = {
                    "resolved": 200,
                    "ambiguous": 409,
                    "not-found": 404,
                }.get(result["status"], 500)
                self._send_json(status_code, result)
                return
            if parsed.path == "/api/surface-roughness":
                name = query.get("name", [None])[0]
                body = query.get("body", ["Moon"])[0]
                if name is None or not name.strip():
                    raise RequestError("name is required and must identify a surface location.")
                latitude = query.get("latitude", [None])[0]
                longitude = query.get("longitude", query.get("longitude_east", [None]))[0]
                if (latitude is None) != (longitude is None):
                    raise RequestError("latitude and longitude must be provided together.")
                try:
                    if latitude is not None:
                        latitude = float(latitude)
                        longitude = float(longitude)
                        if (
                            not (-90 <= latitude <= 90)
                            or not (-360 <= longitude <= 360)
                            or any(value != value or abs(value) == float("inf") for value in (latitude, longitude))
                        ):
                            raise RequestError("Coordinates must be finite; latitude must be between -90 and 90.")
                    estimate = estimate_surface_roughness(name, body, latitude, longitude)
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except RuntimeError as error:
                    detail = str(error).casefold()
                    status_code = 503 if "configure" in detail or "api_key" in detail else 502
                    self._send_json(status_code, {"error": "Could not estimate surface roughness.", "detail": str(error)})
                    return
                self._send_json(200, {
                    "status": "estimated",
                    "body": body.title(),
                    "location_name": name.strip(),
                    **estimate,
                })
                return
            if parsed.path == "/api/earth-analogs":
                name = query.get("name", [None])[0]
                try:
                    top = int(query.get("top", ["10"])[0])
                except ValueError as error:
                    raise RequestError("top must be an integer from 1 to 10.") from error
                roughness_query = query.get("include_roughness", [None])[0]
                if roughness_query is None:
                    include_roughness = None
                elif roughness_query.casefold() in {"1", "true", "yes"}:
                    include_roughness = True
                elif roughness_query.casefold() in {"0", "false", "no"}:
                    include_roughness = False
                else:
                    raise RequestError("include_roughness must be true or false.")
                try:
                    result = select_earth_analogs(name, top_n=top, include_roughness=include_roughness)
                except KeyError as error:
                    self._send_json(404, {"error": str(error.args[0]) if error.args else "Lunar environment was not found."})
                    return
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except FileNotFoundError as error:
                    self._send_json(503, {"error": "An Earth comparison dataset is unavailable.", "detail": str(error)})
                    return
                except (OSError, RuntimeError, json.JSONDecodeError) as error:
                    self._send_json(502, {"error": "Could not build the Earth analog results.", "detail": str(error)})
                    return
                self._send_json(200, result)
                return
            if parsed.path == "/api/mars-location":
                name = query.get("name", [None])[0]
                if name is None or not name.strip():
                    raise RequestError("name is required and must contain a named Mars surface feature.")
                try:
                    result = lookup_mars_location(
                        name,
                        solar_longitude=query.get("ls", ["0"])[0],
                        local_time=query.get("local_time", ["12"])[0],
                        dust_scenario=query.get("dust_scenario", ["1"])[0],
                    )
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except (OSError, RuntimeError, URLError) as error:
                    self._send_json(502, {"error": "Could not resolve the Mars feature.", "detail": str(error)})
                    return
                status_code = {"resolved": 200, "ambiguous": 409, "not-found": 404}.get(result["status"], 500)
                self._send_json(status_code, result)
                return
            if parsed.path == "/api/mars-temperature":
                try:
                    location, status_code, error_payload = _mars_location_from_query(query)
                    if error_payload is not None:
                        self._send_json(status_code, error_payload)
                        return
                    if location is None:
                        self._send_json(200, _mars_pending_snapshot("temperature", MCD_SOURCE))
                        return
                    result = query_mars_temperature(
                        location["latitude"], location["longitude_east"],
                        solar_longitude=query.get("ls", ["0"])[0],
                        local_time=query.get("local_time", ["12"])[0],
                        dust_scenario=query.get("dust_scenario", ["1"])[0],
                    )
                except RequestError as error:
                    raise
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except (OSError, RuntimeError, URLError) as error:
                    self._send_json(502, {"error": "Could not query Mars surface temperature.", "detail": str(error)})
                    return
                self._send_json(200, _mars_point_snapshot(location, "temperature", result, MCD_SOURCE))
                return
            if parsed.path == "/api/mars-minerals":
                try:
                    location, status_code, error_payload = _mars_location_from_query(query)
                    if error_payload is not None:
                        self._send_json(status_code, error_payload)
                        return
                    if location is None:
                        self._send_json(200, _mars_pending_snapshot("mineral_composition", MARS_MINERALS_SOURCE))
                        return
                    result = sample_mars_minerals(location["latitude"], location["longitude_east"])
                except RequestError:
                    raise
                except ValueError as error:
                    raise RequestError(str(error)) from error
                except (OSError, RuntimeError, URLError) as error:
                    self._send_json(502, {"error": "Could not query Mars surface minerals.", "detail": str(error)})
                    return
                self._send_json(200, _mars_point_snapshot(location, "mineral_composition", result, MARS_MINERALS_SOURCE))
                return
            if parsed.path == "/api/lunar-temperatures":
                try:
                    snapshot = load_temperature_snapshot()
                except (OSError, json.JSONDecodeError):
                    self._send_json(404, {"error": "No lunar temperature snapshot is saved yet."})
                    return
                self._send_json(200, snapshot)
                return
            if parsed.path == "/api/lunar-minerals":
                try:
                    snapshot = load_mineral_snapshot()
                except (OSError, json.JSONDecodeError):
                    self._send_json(404, {"error": "No lunar mineral snapshot is saved yet."})
                    return
                self._send_json(200, snapshot)
                return
            if parsed.path == "/api/observations":
                phase_id = query.get("phase_id", [None])[0]
                if phase_id is not None and phase_id not in PHASE_BY_ID:
                    raise RequestError("phase_id must match one of the published mission phases.")
                try:
                    limit = int(query.get("limit", ["100"])[0])
                except ValueError as error:
                    raise RequestError("limit must be an integer from 1 to 500.") from error
                if not 1 <= limit <= MAX_LIST_LIMIT:
                    raise RequestError("limit must be an integer from 1 to 500.")
                observations = list_observations(phase_id)[:limit]
                self._send_json(200, {"observations": observations, "count": len(observations)})
                return
            self._send_json(404, {"error": "Route not found."})
        except RequestError as error:
            self._send_json(400, {"error": str(error)})
        except (OSError, RuntimeError) as error:
            self._send_json(500, {"error": "Could not read observation storage.", "detail": str(error)})

    def do_POST(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/lunar-temperatures/refresh":
            try:
                snapshot = refresh_lunar_temperatures()
                self._send_json(200, snapshot)
            except (OSError, RuntimeError, URLError) as error:
                self._send_json(502, {"error": "Could not refresh lunar temperatures from NASA PDS.", "detail": str(error)})
            return
        if parsed.path == "/api/lunar-minerals/refresh":
            try:
                snapshot = refresh_lunar_minerals()
                self._send_json(200, snapshot)
            except (OSError, RuntimeError, URLError, ValueError) as error:
                self._send_json(502, {"error": "Could not refresh lunar minerals from the published map product.", "detail": str(error)})
            return
        if parsed.path != "/api/observations":
            self._send_json(404, {"error": "Route not found."})
            return
        try:
            record = _normalize_observation(self._read_json())
            append_observation(record)
            self._send_json(201, record)
        except RequestError as error:
            self._send_json(400, {"error": str(error)})
        except OSError as error:
            self._send_json(500, {"error": "Could not save observation.", "detail": str(error)})


def main():
    host = os.environ.get("MISSION_API_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("MISSION_API_PORT", "8000"))
    except ValueError as error:
        raise SystemExit("MISSION_API_PORT must be an integer.") from error
    if not 0 <= port <= 65535:
        raise SystemExit("MISSION_API_PORT must be between 0 and 65535.")

    server = ThreadingHTTPServer((host, port), MissionRequestHandler)
    print(f"Mission API listening on http://{host}:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping mission API.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
