"""Request a PetDB modal-mineral data export through the EarthChem REST API.

The export includes coordinates and available analyses for olivine,
plagioclase, aggregate and separate pyroxenes, iron-oxide/iron-ore modes, and
whole-rock FeO/FeOT. PetDB runs exports asynchronously; the client polls the
task and downloads its CSV or JSON when ready.

Example::

    python -m backend.petdb_export --output backend/data/petdb_rock_modes.csv

If the service requires authentication, set ``PETDB_API_TOKEN`` in the
environment. The token is sent as an Authorization bearer credential.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen


API_BASE_URL = "https://api.earthchem.org/v4"
DEFAULT_OUTPUT = Path(__file__).parent / "data" / "petdb_rock_modes.csv"
USER_AGENT = "RiverHacksMissionBackend/1.0"

# MODE variables are modal mineral abundances. FeO and FeOT are whole-rock
# chemistry fields, included separately because elemental iron itself is not
# represented as a mineral mode in PetDB. Pyroxene is requested both as the
# aggregate PX field (when present) and as OPX/CPX for lunar comparison.
PETDB_VARIABLES = (
    ("MODE", "OL[MODE]"),              # olivine
    ("MODE", "PLAG[MODE]"),            # plagioclase
    ("MODE", "PX[MODE]"),              # aggregate pyroxene, when reported
    ("MODE", "OPX[MODE]"),             # orthopyroxene
    ("MODE", "CPX[MODE]"),             # clinopyroxene
    ("MODE", "FE-OX[MODE]"),           # iron-oxide mode
    ("MODE", "FE-ORE[MODE]"),          # iron-ore mode
    ("MAJ", "FeO"),                    # whole-rock ferrous iron as FeO
    ("MAJ", "FeOT"),                   # whole-rock total iron as FeO
)


class PetDBError(RuntimeError):
    """A PetDB request or export task failed."""


def _headers(accept="application/json"):
    headers = {"Accept": accept, "User-Agent": USER_AGENT}
    token = os.environ.get("PETDB_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _request(url, timeout, accept="application/json"):
    request = Request(url, headers=_headers(accept=accept))
    try:
        return urlopen(request, timeout=timeout)
    except HTTPError as error:
        detail = error.read(1000).decode("utf-8", errors="replace")
        if error.code in (401, 403):
            raise PetDBError(
                "PetDB rejected the export request. If this route requires an API token, "
                "set PETDB_API_TOKEN and retry."
            ) from error
        raise PetDBError(f"PetDB returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise PetDBError(f"Could not reach the PetDB API: {error.reason}") from error


def _json_request(url, timeout):
    with _request(url, timeout) as response:
        body = response.read()
        content_type = response.headers.get("Content-Type", "")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PetDBError("PetDB returned a non-JSON response where task metadata was expected.") from error
    if isinstance(payload, dict) and payload.get("status") == "error":
        raise PetDBError(str(payload.get("message") or payload.get("error") or "PetDB request failed."))
    return payload, content_type


def _find_value(payload, key_names):
    wanted = {name.casefold() for name in key_names}
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key.casefold() in wanted and value not in (None, ""):
                return value
        for value in payload.values():
            result = _find_value(value, key_names)
            if result not in (None, ""):
                return result
    elif isinstance(payload, list):
        for value in payload:
            result = _find_value(value, key_names)
            if result not in (None, ""):
                return result
    return None


def _find_download_url(payload):
    value = _find_value(payload, (
        "downloadUrl", "downloadURL", "fileUrl", "fileURL", "presignedUrl", "presignedURL",
        "fileLocation", "file_location",
    ))
    return value if isinstance(value, str) and value.startswith(("https://", "http://")) else None


def _find_task_id(payload):
    value = _find_value(payload, ("taskId", "task_id", "exportId", "export_id"))
    return str(value) if value is not None else None


def _find_status(payload):
    if isinstance(payload, dict):
        for key in ("task", "export", "data", "result"):
            if key in payload:
                value = _find_status(payload[key])
                if value:
                    return value
    elif isinstance(payload, list):
        for child in payload:
            value = _find_status(child)
            if value:
                return value
    value = _find_value(payload, ("taskStatus", "state", "progressDesc", "progressCode"))
    if value is None:
        value = _find_value(payload, ("status",))
    return str(value).strip().casefold() if value is not None else ""


def _is_succeeded(status):
    return status in {"succeeded", "success", "successful", "complete", "completed", "done", "3"}


def _is_failed(status):
    return status in {"failed", "failure", "error", "cancelled", "canceled", "2", "5"}


def _write_atomic(data, destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "wb", dir=destination.parent, prefix=f"{destination.name}.",
            suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
        temporary.replace(destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _download_file(url, timeout):
    # Do not forward the API bearer token to a signed object-storage URL.
    try:
        with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise PetDBError(f"PetDB export download returned HTTP {status}.")
            data = response.read()
    except HTTPError as error:
        raise PetDBError(f"PetDB export download returned HTTP {error.code}.") from error
    except URLError as error:
        raise PetDBError(f"Could not download the PetDB export: {error.reason}") from error
    if not data:
        raise PetDBError("PetDB returned an empty export file.")
    return data


def request_export(
    output_path=DEFAULT_OUTPUT,
    file_type="csv",
    api_base_url=API_BASE_URL,
    poll_interval_seconds=10,
    timeout_seconds=600,
    request_timeout_seconds=30,
    opener=_request,
    sleeper=time.sleep,
):
    """Submit, poll, and download the requested PetDB export."""
    if file_type not in {"csv", "json"}:
        raise ValueError("file_type must be csv or json.")
    if poll_interval_seconds < 1 or timeout_seconds < 1:
        raise ValueError("Polling interval and timeout must be positive.")

    variable_filter = "||".join(
        f"{group}::[{variable}]" for group, variable in PETDB_VARIABLES
    )
    params = urlencode({"variables": variable_filter, "fileType": file_type})
    submit_url = f"{api_base_url.rstrip('/')}/exports/submit?{params}"
    with opener(submit_url, request_timeout_seconds) as response:
        body = response.read()
        content_type = response.headers.get("Content-Type", "")

    try:
        submission = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        if file_type == "csv" or "json" not in content_type.casefold():
            _write_atomic(body, output_path)
            return {"output_path": str(output_path), "task_id": None, "bytes": len(body)}
        raise PetDBError("PetDB export submission returned neither a task response nor a data file.") from error

    response_status = str(submission.get("status", "")).casefold() if isinstance(submission, dict) else ""
    if response_status == "error":
        detail = _find_value(submission, ("message", "error", "detail"))
        raise PetDBError(str(detail or "PetDB rejected the export request."))

    immediate_url = _find_download_url(submission)
    task_id = _find_task_id(submission)
    if immediate_url:
        export_data = _download_file(immediate_url, request_timeout_seconds)
        _write_atomic(export_data, output_path)
        return {"output_path": str(output_path), "task_id": task_id, "bytes": len(export_data)}
    if file_type == "json" and task_id is None:
        _write_atomic(body, output_path)
        return {"output_path": str(output_path), "task_id": None, "bytes": len(body)}
    if not task_id:
        message = _find_value(submission, ("message", "error", "detail"))
        raise PetDBError(f"PetDB did not return an export task ID. {message or ''}".strip())

    status_url = f"{api_base_url.rstrip('/')}/exports/{quote(task_id, safe='')}"
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        status_payload, _content_type = _json_request(status_url, request_timeout_seconds)
        status = _find_status(status_payload)
        download_url = _find_download_url(status_payload)
        if _is_failed(status):
            detail = _find_value(status_payload, ("error", "message", "detail"))
            raise PetDBError(f"PetDB export task {task_id} ended with status {status}: {detail or ''}".strip())
        if download_url:
            export_data = _download_file(download_url, request_timeout_seconds)
            _write_atomic(export_data, output_path)
            return {"output_path": str(output_path), "task_id": task_id, "bytes": len(export_data)}
        if _is_succeeded(status):
            raise PetDBError(
                f"PetDB export task {task_id} completed but no download URL appeared in its status response."
            )
        sleeper(min(poll_interval_seconds, max(0.0, deadline - time.monotonic())))

    raise PetDBError(
        f"Timed out waiting for PetDB export task {task_id}; check its status at {status_url}."
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", help="Destination path for the downloaded export.")
    parser.add_argument("--format", choices=("csv", "json"), default="csv", help="PetDB export file format.")
    parser.add_argument("--api-base", default=os.environ.get("PETDB_API_BASE_URL", API_BASE_URL))
    parser.add_argument("--poll-seconds", type=int, default=10)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args = parser.parse_args(argv)
    output_path = args.output
    if output_path is None:
        output_path = str(DEFAULT_OUTPUT.with_suffix(".json" if args.format == "json" else ".csv"))

    try:
        result = request_export(
            output_path=output_path,
            file_type=args.format,
            api_base_url=args.api_base,
            poll_interval_seconds=args.poll_seconds,
            timeout_seconds=args.timeout_seconds,
        )
    except (PetDBError, OSError, ValueError) as error:
        parser.error(str(error))
    task = f" (task {result['task_id']})" if result["task_id"] else ""
    print(f"Saved PetDB {args.format.upper()} export{task}: {result['bytes']} bytes at {result['output_path']}")
    print("Requested fields: " + ", ".join(variable for _group, variable in PETDB_VARIABLES))
    print("Retrieved at: " + datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))


if __name__ == "__main__":
    main()
