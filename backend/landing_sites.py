"""Normalize and persist NASA's published lunar and Mars landing targets.

NASA does not publish these mission target records in a single structured feed.
The source-reviewed records below are therefore kept separate from the sync
algorithm, which validates provenance, normalizes IDs, deduplicates, and writes
an atomic JSON snapshot. Update these source records when NASA publishes new
mission information, then run ``python -m backend.landing_sites``.
"""

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import tempfile
from urllib.parse import urlparse


DEFAULT_LANDING_SITES_FILE = Path(__file__).parent / "data" / "landing_sites.json"

ARTEMIS_IV_URL = "https://www.nasa.gov/mission/artemis-iv/"
ARTEMIS_REGIONS_URL = (
    "https://www.nasa.gov/news-release/"
    "nasa-provides-update-on-artemis-iii-moon-landing-regions/"
)
SKYFALL_URL = "https://science.nasa.gov/mission/skyfall/"

# NASA describes Artemis IV as a crewed surface mission near the lunar South
# Pole, but has not named its exact landing point. SkyFall's Mars site is TBD.
# A record with no ``site_name`` or coordinates is an unresolved mission
# target, not a fabricated site.
NASA_MISSION_TARGETS = [
    {
        "body": "Moon",
        "mission": "Artemis IV",
        "status": "target-region",
        "site_name": "Lunar South Pole region",
        "coordinates": None,
        "notes": "NASA names the lunar South Pole region; an exact landing site has not been published.",
        "source_urls": [ARTEMIS_IV_URL],
        "source_as_of": "2026-03-16",
    },
    {
        "body": "Mars",
        "mission": "SkyFall",
        "status": "site-selection-pending",
        "site_name": None,
        "coordinates": None,
        "notes": "NASA states the landing site is to be determined following community workshops.",
        "source_urls": [SKYFALL_URL],
        "source_as_of": "2026-11-04",
    },
]

# NASA's Artemis IV mission page currently describes nine candidate South Pole
# regions for Artemis. The NASA release below supplies their names. These are
# still candidate regions, not selected landing sites or point coordinates.
ARTEMIS_CANDIDATE_REGION_NAMES = [
    "Peak near Cabeus B",
    "Haworth",
    "Malapert Massif",
    "Mons Mouton Plateau",
    "Mons Mouton",
    "Nobile Rim 1",
    "Nobile Rim 2",
    "de Gerlache Rim 2",
    "Slater Plain",
]

NASA_CANDIDATE_SITES = [
    {
        "body": "Moon",
        "mission": "Artemis campaign",
        "status": "candidate-region",
        "site_name": name,
        "coordinates": None,
        "notes": "NASA-published lunar South Pole candidate region; not a selected landing site.",
        "source_urls": [ARTEMIS_IV_URL, ARTEMIS_REGIONS_URL],
        "source_as_of": "2024-10-28",
    }
    for name in ARTEMIS_CANDIDATE_REGION_NAMES
]


def _stable_id(record: dict) -> str:
    identity = "|".join(
        (
            record["body"].casefold(),
            record["mission"].casefold(),
            record["status"].casefold(),
            (record.get("site_name") or "unselected").casefold(),
        )
    )
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"{record['body'].casefold()}-{digest}"


def _validate_source_urls(source_urls) -> list[str]:
    if not isinstance(source_urls, list) or not source_urls:
        raise ValueError("Each target must cite at least one NASA source URL.")
    normalized = []
    for url in source_urls:
        if not isinstance(url, str):
            raise ValueError("NASA source URLs must be strings.")
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not (host == "nasa.gov" or host.endswith(".nasa.gov")):
            raise ValueError(f"Source is not an HTTPS NASA URL: {url}")
        normalized.append(url)
    return sorted(set(normalized))


def _normalize_record(record: dict, record_type: str) -> dict:
    if not isinstance(record, dict):
        raise ValueError("Every landing target must be an object.")

    body = record.get("body")
    if body not in ("Moon", "Mars"):
        raise ValueError("body must be Moon or Mars.")
    mission = record.get("mission")
    if not isinstance(mission, str) or not mission.strip():
        raise ValueError("mission must be a non-empty string.")
    site_name = record.get("site_name")
    if site_name is not None and (not isinstance(site_name, str) or not site_name.strip()):
        raise ValueError("site_name must be a non-empty string or null.")
    if record_type == "candidate_site" and site_name is None:
        raise ValueError("Candidate regions require a site_name.")

    coordinates = record.get("coordinates")
    if coordinates is not None:
        if not isinstance(coordinates, dict) or set(coordinates) != {"latitude", "longitude"}:
            raise ValueError("coordinates must contain latitude and longitude, or be null.")
        latitude = coordinates["latitude"]
        longitude = coordinates["longitude"]
        if (
            isinstance(latitude, bool)
            or isinstance(longitude, bool)
            or not isinstance(latitude, (int, float))
            or not isinstance(longitude, (int, float))
            or not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            raise ValueError("coordinates must be finite latitude/longitude values in valid ranges.")
        coordinates = {"latitude": latitude, "longitude": longitude}

    status = record.get("status")
    allowed_statuses = {
        "target-region",
        "site-selection-pending",
        "candidate-region",
        "selected-site",
        "historical-landing-site",
    }
    if status not in allowed_statuses:
        raise ValueError(f"Unsupported landing target status: {status}")
    if status == "site-selection-pending" and (site_name is not None or coordinates is not None):
        raise ValueError("An unselected target cannot include a site name or coordinates.")

    source_as_of = record.get("source_as_of")
    if not isinstance(source_as_of, str) or len(source_as_of) != 10:
        raise ValueError("source_as_of must be a YYYY-MM-DD date.")
    try:
        datetime.strptime(source_as_of, "%Y-%m-%d")
    except ValueError as error:
        raise ValueError("source_as_of must be a valid YYYY-MM-DD date.") from error

    normalized = {
        "id": "",
        "record_type": record_type,
        "body": body,
        "mission": mission.strip(),
        "status": status,
        "site_name": site_name.strip() if site_name else None,
        "coordinates": coordinates,
        "notes": str(record.get("notes", "")).strip(),
        "source_urls": _validate_source_urls(record.get("source_urls")),
        "source_as_of": source_as_of,
    }
    normalized["id"] = _stable_id(normalized)
    return normalized


def build_snapshot(targets=None, candidate_sites=None, retrieved_at=None) -> dict:
    """Validate, normalize, deduplicate, and sort records for a saved snapshot."""
    targets = NASA_MISSION_TARGETS if targets is None else targets
    candidate_sites = NASA_CANDIDATE_SITES if candidate_sites is None else candidate_sites
    if not targets and not candidate_sites:
        raise ValueError("Refusing to replace the saved snapshot with no records.")

    def unique_records(records, record_type):
        by_id = {}
        for raw_record in records:
            normalized = _normalize_record(raw_record, record_type)
            by_id[normalized["id"]] = normalized
        return sorted(by_id.values(), key=lambda item: (item["body"], item["mission"], item["site_name"] or ""))

    if retrieved_at is None:
        retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "schema_version": 1,
        "retrieved_at": retrieved_at,
        "targets": unique_records(targets, "mission_target"),
        "candidate_sites": unique_records(candidate_sites, "candidate_site"),
    }


def save_snapshot(snapshot: dict, destination: Path | str = DEFAULT_LANDING_SITES_FILE) -> Path:
    """Atomically save a completed snapshot so a failed write keeps old data."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", newline="\n", dir=destination.parent,
            prefix=f"{destination.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary_path = Path(stream.name)
            json.dump(snapshot, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        temporary_path.replace(destination)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
    return destination


def load_snapshot(source: Path | str = DEFAULT_LANDING_SITES_FILE) -> dict:
    with Path(source).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def main():
    snapshot = build_snapshot()
    path = save_snapshot(snapshot)
    total_sites = len(snapshot["targets"]) + len(snapshot["candidate_sites"])
    print(f"Saved {total_sites} NASA landing target records to {path}")


if __name__ == "__main__":
    main()
