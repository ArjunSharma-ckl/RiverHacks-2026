"""Small standard-library HTTP API for mission planning and field observations."""

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from backend.catalog import EQUIPMENT_BY_ID, PHASES, PHASE_BY_ID, RESOURCES
from backend.storage import append_observation, list_observations


MAX_BODY_BYTES = 1_000_000
MAX_LIST_LIMIT = 500


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
            if parsed.path == "/api/health":
                self._send_json(200, {"status": "ok"})
                return
            if parsed.path == "/api/phases":
                self._send_json(200, {"phases": PHASES})
                return
            if parsed.path == "/api/resources":
                self._send_json(200, {"resources": RESOURCES})
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
