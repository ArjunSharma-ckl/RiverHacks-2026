"""Fetch annual-average Moon temperatures from the NASA PDS Diviner PRP.

The WUSTL ODE REST API catalogs products; it does not return the temperature
values from the PRP table. This module reads the archived south-polar PRP
table, samples the nearest mesh cell to one published representative point
for each Artemis candidate region, and atomically saves a JSON snapshot.

Run ``python -m backend.lunar_temperature`` to refresh the snapshot. The PDS
table is about 605 MB and is cached outside the repository for later runs.
"""

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import tempfile
from urllib.error import URLError
from urllib.request import Request, urlopen

from backend.landing_sites import DEFAULT_LANDING_SITES_FILE, load_snapshot


DEFAULT_TEMPERATURES_FILE = Path(__file__).parent / "data" / "lunar_temperatures.json"
PDS_PRODUCT_ID = "DLRE_PRP_SOUTH.TAB"
PDS_DATASET_ID = "LRO-L-DLRE-5-PRP-V2.0"
PDS_TABLE_URL = (
    "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/"
    "data_derived_prp/dlre_prp_south.tab"
)
PDS_LABEL_URL = (
    "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/"
    "data_derived_prp/dlre_prp_south.lbl"
)
PDS_COLUMN_LAYOUT_URL = (
    "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/"
    "label/dlre_prp.fmt"
)
PDS_ROW_BYTES = 210
PDS_DATA_ROWS = 2_880_000
PDS_TABLE_BYTES = PDS_ROW_BYTES * (PDS_DATA_ROWS + 1)  # Header record + data rows.
SEARCH_RADIUS_KM = 20.0
MOON_RADIUS_KM = 1_737.4
KM_PER_DEGREE = math.pi * MOON_RADIUS_KM / 180.0

NASA_SOUTH_POLE_SITES_URL = (
    "https://ntrs.nasa.gov/api/citations/20260010467/downloads/"
    "IWLR_ALLR_261102.pdf?attachment=true"
)
ARTEMIS_CANDIDATE_STUDY_URL = "https://doi.org/10.1029/2025JE009434"

# Representative points published for the nine NASA Artemis candidate
# regions. Seven coordinates are in the 2026 NASA presentation. Mons Mouton
# and Nobile Rim 1 use representative candidate points from the cited study;
# they are not region centroids or selected landing sites.
ARTEMIS_REFERENCE_POINTS = {
    "Peak near Cabeus B": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -83.6,
        "longitude_east": 291.2,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "Haworth": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -86.8,
        "longitude_east": 336.4,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "Malapert Massif": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -85.9,
        "longitude_east": 0.3,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "Mons Mouton Plateau": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -84.1,
        "longitude_east": 34.7,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "Mons Mouton": {
        "point_id": "MMO10",
        "latitude": -85.461,
        "longitude_east": 31.490,
        "coordinate_source_url": ARTEMIS_CANDIDATE_STUDY_URL,
    },
    "Nobile Rim 1": {
        "point_id": "NR101",
        "latitude": -85.295,
        "longitude_east": 36.917,
        "coordinate_source_url": ARTEMIS_CANDIDATE_STUDY_URL,
    },
    "Nobile Rim 2": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -84.0,
        "longitude_east": 58.7,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "de Gerlache Rim 2": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -88.2,
        "longitude_east": 295.9,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
    "Slater Plain": {
        "point_id": "NASA South Pole Sites figure",
        "latitude": -87.1,
        "longitude_east": 127.2,
        "coordinate_source_url": NASA_SOUTH_POLE_SITES_URL,
    },
}


def _cache_path() -> Path:
    configured = os.environ.get("MISSION_PDS_CACHE_DIR")
    cache_dir = (
        Path(configured)
        if configured
        else Path(tempfile.gettempdir()) / "riverhacks-2026" / "pds-cache"
    )
    return cache_dir / PDS_PRODUCT_ID.lower()


def download_pds_product(
    destination: Path | str | None = None,
    opener=urlopen,
) -> Path:
    """Download and cache the PDS table, verifying its documented size."""
    destination = Path(destination) if destination else _cache_path()
    if destination.is_file() and destination.stat().st_size == PDS_TABLE_BYTES:
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    request = Request(
        PDS_TABLE_URL,
        headers={"User-Agent": "RiverHacksMissionBackend/1.0", "Accept": "text/plain"},
    )
    try:
        with opener(request, timeout=120) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise URLError(f"PDS returned HTTP {status} for {PDS_PRODUCT_ID}.")
            declared_size = response.headers.get("Content-Length")
            if declared_size is not None and int(declared_size) != PDS_TABLE_BYTES:
                raise RuntimeError(
                    f"PDS product size changed: expected {PDS_TABLE_BYTES} bytes, "
                    f"received Content-Length {declared_size}."
                )
            with tempfile.NamedTemporaryFile(
                "wb", dir=destination.parent, prefix=f"{destination.name}.",
                suffix=".tmp", delete=False,
            ) as stream:
                temporary_path = Path(stream.name)
                received = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    stream.write(chunk)
                    received += len(chunk)
                stream.flush()
                os.fsync(stream.fileno())
        if received != PDS_TABLE_BYTES:
            raise RuntimeError(
                f"Incomplete PDS product: expected {PDS_TABLE_BYTES} bytes, "
                f"received {received}."
            )
        temporary_path.replace(destination)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
    return destination


def _row_values(raw_line: bytes):
    """Read the documented comma-delimited row fields needed by this query."""
    fields = raw_line.rstrip(b"\r\n").split(b",")
    if len(fields) != 15:
        return None
    try:
        # DLRE_PRP.FMT: tri_clon is field 10, tri_clat is field 11,
        # temp_avg is field 13. Python offsets are zero based.
        longitude = float(fields[9].strip()) % 360.0
        latitude = float(fields[10].strip())
        temperature_k = float(fields[12].strip())
    except ValueError:
        return None
    if not all(math.isfinite(value) for value in (longitude, latitude, temperature_k)):
        return None
    if temperature_k < 0 or temperature_k > 1000 or not -90 <= latitude <= 90:
        return None
    return longitude, latitude, temperature_k


def _longitude_delta_degrees(longitude_a: float, longitude_b: float) -> float:
    """Return signed shortest angular delta for east longitudes."""
    return (longitude_a - longitude_b + 180.0) % 360.0 - 180.0


def _distance_km(latitude: float, longitude: float, point: dict) -> float:
    dy = math.radians(latitude - point["latitude"]) * MOON_RADIUS_KM
    delta_lon = math.radians(_longitude_delta_degrees(longitude, point["longitude_east"]))
    mean_latitude = math.radians((latitude + point["latitude"]) / 2.0)
    dx = delta_lon * MOON_RADIUS_KM * math.cos(mean_latitude)
    return math.hypot(dx, dy)


def sample_candidate_points(table_path: Path | str, candidate_sites: list[dict]) -> list[dict]:
    """Find nearest PRP mesh cells for mapped Artemis candidate-region points."""
    mapped_sites = []
    unresolved_sites = []
    for site in candidate_sites:
        point = ARTEMIS_REFERENCE_POINTS.get(site.get("site_name"))
        if point is None:
            unresolved_sites.append({
                "site": site,
                "reason": "No sourced representative coordinate is configured.",
            })
            continue
        mapped_sites.append((site, point))

    best = {site["id"]: None for site, _ in mapped_sites}
    latitude_margin = SEARCH_RADIUS_KM / KM_PER_DEGREE
    longitude_margins = {
        site["id"]: min(
            180.0,
            SEARCH_RADIUS_KM
            / (KM_PER_DEGREE * max(1e-6, math.cos(math.radians(point["latitude"])))),
        )
        for site, point in mapped_sites
    }

    with Path(table_path).open("rb") as stream:
        # PDS label ^HEADER=record 1 and ^TABLE=record 2. Skip the table's
        # column-name record, then inspect the 2,880,000 mesh-cell records.
        stream.readline()
        for raw_line in stream:
            values = _row_values(raw_line)
            if values is None:
                continue
            longitude, latitude, temperature_k = values
            for site, point in mapped_sites:
                site_id = site["id"]
                if abs(latitude - point["latitude"]) > latitude_margin:
                    continue
                if abs(_longitude_delta_degrees(longitude, point["longitude_east"])) > longitude_margins[site_id]:
                    continue
                distance = _distance_km(latitude, longitude, point)
                previous = best[site_id]
                if distance <= SEARCH_RADIUS_KM and (previous is None or distance < previous[0]):
                    best[site_id] = (distance, longitude, latitude, temperature_k)

    records = []
    for site, point in mapped_sites:
        match = best[site["id"]]
        record = {
            "landing_site_id": site["id"],
            "body": site["body"],
            "mission": site["mission"],
            "status": site["status"],
            "site_name": site["site_name"],
            "reference_point": {
                "point_id": point["point_id"],
                "latitude": point["latitude"],
                "longitude_east": point["longitude_east"],
                "coordinate_source_url": point["coordinate_source_url"],
                "coordinate_type": "representative candidate point; not an exact selected landing site",
            },
        }
        if match is None:
            record.update({"status": "no-data", "temperature": None})
        else:
            distance, cell_lon, cell_lat, temperature_k = match
            record["sample_cell"] = {
                "latitude": cell_lat,
                "longitude_east": cell_lon,
                "distance_from_reference_km": round(distance, 4),
            }
            record["temperature"] = {
                "annual_average_kelvin": round(temperature_k, 3),
                "annual_average_celsius": round(temperature_k - 273.15, 3),
                "depth_below_surface_m": 0.02,
            }
        records.append(record)

    for unresolved in unresolved_sites:
        site = unresolved["site"]
        records.append({
            "landing_site_id": site["id"],
            "body": site["body"],
            "mission": site["mission"],
            "status": "no-reference-coordinate",
            "site_name": site["site_name"],
            "temperature": None,
            "note": unresolved["reason"],
        })
    return sorted(records, key=lambda item: item["site_name"] or "")


def build_temperature_snapshot(candidate_sites: list[dict], table_path: Path | str) -> dict:
    """Create the lunar temperature JSON structure from candidate records."""
    return {
        "schema_version": 1,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "name": "NASA Planetary Data System, LRO Diviner Polar Resource Product",
            "dataset_id": PDS_DATASET_ID,
            "product_id": PDS_PRODUCT_ID,
            "product_url": PDS_TABLE_URL,
            "label_url": PDS_LABEL_URL,
            "column_layout_url": PDS_COLUMN_LAYOUT_URL,
            "measurement": "modeled annual-average temperature at 2 cm below the surface",
            "units": "K",
            "spatial_method": "nearest PRP triangular mesh-cell center to each representative candidate point",
            "temporal_coverage_note": "Derived from thermal-model fits to Diviner polar observations from the first mapping year.",
            "limitations": [
                "Values describe a representative point within each candidate region, not a spatial average over the entire region.",
                "The PDS product is a thermal-model-derived annual average, not a current weather reading.",
                "Only candidate sites with sourced reference points are sampled.",
            ],
        },
        "records": sample_candidate_points(table_path, candidate_sites),
    }


def save_temperature_snapshot(snapshot: dict, destination: Path | str = DEFAULT_TEMPERATURES_FILE) -> Path:
    """Atomically persist the temperature snapshot as JSON."""
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


def load_temperature_snapshot(source: Path | str = DEFAULT_TEMPERATURES_FILE) -> dict:
    with Path(source).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def refresh_lunar_temperatures(
    landing_sites_file: Path | str = DEFAULT_LANDING_SITES_FILE,
    temperatures_file: Path | str = DEFAULT_TEMPERATURES_FILE,
    table_path: Path | str | None = None,
) -> dict:
    """Query PDS for the candidate sites in the saved landing-site snapshot."""
    landing_snapshot = load_snapshot(landing_sites_file)
    candidate_sites = [
        site for site in landing_snapshot.get("candidate_sites", []) if site.get("body") == "Moon"
    ]
    if not candidate_sites:
        raise RuntimeError("The landing-site snapshot has no Moon candidate regions to query.")
    product_path = Path(table_path) if table_path else download_pds_product()
    snapshot = build_temperature_snapshot(candidate_sites, product_path)
    save_temperature_snapshot(snapshot, temperatures_file)
    return snapshot


def main():
    snapshot = refresh_lunar_temperatures()
    saved = DEFAULT_TEMPERATURES_FILE
    count = sum(record.get("temperature") is not None for record in snapshot["records"])
    print(f"Saved annual-average Diviner temperatures for {count} lunar candidate points to {saved}")


if __name__ == "__main__":
    main()
