"""Sample published lunar south-polar mineral abundance maps at Artemis sites.

The raw M3-derived abundance cube is distributed as a MATLAB v7.3/HDF5 file.
This module maps each representative Artemis candidate coordinate to the
nearest pixel and atomically saves one JSON record per site. The source cube
is cached outside the repository.

Run ``python -m backend.lunar_minerals`` to refresh the snapshot.
"""

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from urllib.error import URLError
from urllib.request import Request, urlopen

from backend.landing_sites import DEFAULT_LANDING_SITES_FILE, load_snapshot
from backend.lunar_temperature import ARTEMIS_REFERENCE_POINTS, MOON_RADIUS_KM


DEFAULT_MINERALS_FILE = Path(__file__).parent / "data" / "lunar_minerals.json"
DATASET_DOI = "10.5281/zenodo.20725024"
DATASET_URL = "https://zenodo.org/records/20725024"
PUBLICATION_DOI = "10.1029/2024JE008842"
PRODUCT_ID = "Abcube_Oli_Pla_Opx_Cpx_Smfe.mat"
PRODUCT_URL = (
    "https://zenodo.org/api/records/20725024/files/"
    "Abcube_Oli_Pla_Opx_Cpx_Smfe.mat/content"
)
PRODUCT_BYTES = 63_028_597
PRODUCT_MD5 = "bb7deaf681aada775de0b2a0f3b8083a"
HDF5_DATASET = "AbcubeNew"
HDF5_SHAPE = (5, 2201, 2201)
PIXEL_SCALE_M = 193.32114121
X_MIN_M = -212_700.0
Y_MAX_M = 212_700.0
MOON_RADIUS_M = 1_737_400.0

# The MATLAB array is 2201 x 2201 x 5 in [row, column, band] order. MATLAB
# v7.3 reverses dimensions in HDF5, so h5py sees [band, column, row].
MINERAL_BANDS = {
    "olivine": 0,
    "plagioclase": 1,
    "low_calcium_pyroxene": 2,
    "high_calcium_pyroxene": 3,
    "sm_fe": 4,
}


def _cache_path() -> Path:
    configured = os.environ.get("MISSION_MINERAL_CACHE_DIR")
    cache_dir = (
        Path(configured)
        if configured
        else Path(tempfile.gettempdir()) / "riverhacks-2026" / "lunar-mineral-cache"
    )
    return cache_dir / PRODUCT_ID.lower()


def cached_mineral_product_path() -> Path | None:
    """Return the expected-size mineral cube from the configured local cache."""
    path = _cache_path()
    if path.is_file() and path.stat().st_size == PRODUCT_BYTES:
        return path
    return None


def _has_expected_checksum(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size != PRODUCT_BYTES:
        return False
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == PRODUCT_MD5


def download_mineral_product(destination: Path | str | None = None, opener=urlopen) -> Path:
    """Download the pinned Zenodo release and verify its published MD5/size."""
    destination = Path(destination) if destination else _cache_path()
    if _has_expected_checksum(destination):
        return destination

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    request = Request(
        PRODUCT_URL,
        headers={"User-Agent": "RiverHacksMissionBackend/1.0"},
    )
    try:
        with opener(request, timeout=120) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                raise URLError(f"Zenodo returned HTTP {status} for {PRODUCT_ID}.")
            with tempfile.NamedTemporaryFile(
                "wb", dir=destination.parent, prefix=f"{destination.name}.",
                suffix=".tmp", delete=False,
            ) as stream:
                temporary_path = Path(stream.name)
                digest = hashlib.md5()
                received = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    stream.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
                stream.flush()
                os.fsync(stream.fileno())
        if received != PRODUCT_BYTES or digest.hexdigest() != PRODUCT_MD5:
            raise RuntimeError(
                f"Downloaded {PRODUCT_ID} did not match its published size/checksum "
                f"(received {received} bytes; MD5 {digest.hexdigest()})."
            )
        temporary_path.replace(destination)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
    return destination


def _project_south_polar(latitude: float, longitude_east: float) -> tuple[float, float]:
    """Project a lunar coordinate to the dataset's spherical south-polar grid."""
    if not math.isfinite(latitude) or not math.isfinite(longitude_east):
        raise ValueError("Reference coordinates must be finite.")
    if not -90.0 <= latitude <= -80.0:
        raise ValueError("The mineral grid only covers the lunar south-polar region.")
    colatitude = math.radians(90.0 + latitude)
    longitude = math.radians(longitude_east % 360.0)
    radius = 2.0 * MOON_RADIUS_M * math.tan(colatitude / 2.0)
    # South-polar stereographic coordinates: x = rho*sin(lon), y = rho*cos(lon).
    return radius * math.sin(longitude), radius * math.cos(longitude)


def _inverse_project_south_polar(x_m: float, y_m: float) -> tuple[float, float]:
    radius = math.hypot(x_m, y_m)
    latitude = math.degrees(2.0 * math.atan(radius / (2.0 * MOON_RADIUS_M))) - 90.0
    longitude_east = math.degrees(math.atan2(x_m, y_m)) % 360.0
    return latitude, longitude_east


def _distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    lat_a = math.radians(latitude_a)
    lat_b = math.radians(latitude_b)
    delta_lat = lat_b - lat_a
    delta_lon = math.radians((longitude_b - longitude_a + 180.0) % 360.0 - 180.0)
    haversine = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2.0) ** 2
    )
    return 2.0 * MOON_RADIUS_KM * math.asin(min(1.0, math.sqrt(haversine)))


def _pixel_for_point(latitude: float, longitude_east: float) -> tuple[int, int, float, float]:
    x_m, y_m = _project_south_polar(latitude, longitude_east)
    column = math.floor((x_m - X_MIN_M) / PIXEL_SCALE_M)
    row = math.floor((Y_MAX_M - y_m) / PIXEL_SCALE_M)
    if not (0 <= row < HDF5_SHAPE[1] and 0 <= column < HDF5_SHAPE[2]):
        raise ValueError("Reference coordinate falls outside the published mineral map.")
    # Pixel-is-area grid: the tie point is at the upper-left outer corner.
    pixel_x = X_MIN_M + (column + 0.5) * PIXEL_SCALE_M
    pixel_y = Y_MAX_M - (row + 0.5) * PIXEL_SCALE_M
    return row, column, pixel_x, pixel_y


def _load_hdf5():
    try:
        import h5py
    except ImportError as error:
        raise RuntimeError(
            "Refreshing lunar minerals requires h5py. Install it with `python -m pip install -r requirements.txt`."
        ) from error
    return h5py


def sample_mineral_sites(product_path: Path | str, candidate_sites: list[dict]) -> list[dict]:
    """Sample source abundance values at the nearest map pixel for each region."""
    h5py = _load_hdf5()
    records = []
    with h5py.File(product_path, "r") as product:
        if HDF5_DATASET not in product:
            raise RuntimeError(f"{PRODUCT_ID} is missing the expected {HDF5_DATASET} array.")
        cube = product[HDF5_DATASET]
        if cube.shape != HDF5_SHAPE:
            raise RuntimeError(
                f"Unexpected mineral cube shape {cube.shape}; expected {HDF5_SHAPE}."
            )

        for site in candidate_sites:
            point = ARTEMIS_REFERENCE_POINTS.get(site.get("site_name"))
            record = {
                "landing_site_id": site["id"],
                "body": site["body"],
                "mission": site["mission"],
                "status": site["status"],
                "site_name": site["site_name"],
            }
            if point is None:
                record.update({
                    "status": "no-reference-coordinate",
                    "mineral_composition": None,
                    "note": "No sourced representative coordinate is configured.",
                })
                records.append(record)
                continue

            record["reference_point"] = {
                "point_id": point["point_id"],
                "latitude": point["latitude"],
                "longitude_east": point["longitude_east"],
                "coordinate_source_url": point["coordinate_source_url"],
                "coordinate_type": "representative candidate point; not an exact selected landing site",
            }
            try:
                row, column, pixel_x, pixel_y = _pixel_for_point(
                    point["latitude"], point["longitude_east"]
                )
            except ValueError as error:
                record.update({"status": "no-data", "mineral_composition": None, "note": str(error)})
                records.append(record)
                continue

            sample_lat, sample_lon = _inverse_project_south_polar(pixel_x, pixel_y)
            # HDF5's MATLAB dimension reversal means [band, column, row].
            abundance = {
                name: float(cube[band, column, row])
                for name, band in MINERAL_BANDS.items()
            }
            if not all(math.isfinite(value) for value in abundance.values()):
                record.update({"status": "no-data", "mineral_composition": None})
                records.append(record)
                continue

            record["sample_cell"] = {
                "latitude": sample_lat,
                "longitude_east": sample_lon,
                "distance_from_reference_km": round(
                    _distance_km(
                        point["latitude"], point["longitude_east"], sample_lat, sample_lon
                    ),
                    4,
                ),
            }
            record["mineral_composition"] = {
                "abundance_values": abundance,
                "units": "raw source values; the dataset description does not specify a fraction or percent scale",
                "map_pixel": {"row": row, "column": column},
            }
            records.append(record)
    return sorted(records, key=lambda item: item["site_name"] or "")


def sample_mineral_at_point(
    product_path: Path | str,
    latitude: float,
    longitude_east: float,
) -> dict | None:
    """Sample all mineral bands at an arbitrary south-polar coordinate."""
    try:
        row, column, pixel_x, pixel_y = _pixel_for_point(latitude, longitude_east)
    except ValueError:
        return None
    h5py = _load_hdf5()
    with h5py.File(product_path, "r") as product:
        if HDF5_DATASET not in product:
            raise RuntimeError(f"{PRODUCT_ID} is missing the expected {HDF5_DATASET} array.")
        cube = product[HDF5_DATASET]
        if cube.shape != HDF5_SHAPE:
            raise RuntimeError(
                f"Unexpected mineral cube shape {cube.shape}; expected {HDF5_SHAPE}."
            )
        # HDF5's MATLAB dimension reversal means [band, column, row].
        abundance = {
            name: float(cube[band, column, row])
            for name, band in MINERAL_BANDS.items()
        }
    if not all(math.isfinite(value) for value in abundance.values()):
        return None
    sample_lat, sample_lon = _inverse_project_south_polar(pixel_x, pixel_y)
    return {
        "sample_cell": {
            "latitude": sample_lat,
            "longitude_east": sample_lon,
            "distance_from_reference_km": round(
                _distance_km(latitude, longitude_east, sample_lat, sample_lon), 4
            ),
        },
        "mineral_composition": {
            "abundance_values": abundance,
            "units": "raw source values; the dataset description does not specify a fraction or percent scale",
            "map_pixel": {"row": row, "column": column},
        },
    }


def build_mineral_snapshot(candidate_sites: list[dict], product_path: Path | str) -> dict:
    """Build a mineral JSON snapshot aligned with the lunar temperature records."""
    return {
        "schema_version": 1,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "name": "M3-derived lunar south-polar mineral abundance maps, calibrated using LOLA reflectance",
            "dataset_id": DATASET_DOI,
            "publication_doi": PUBLICATION_DOI,
            "product_id": PRODUCT_ID,
            "product_url": PRODUCT_URL,
            "dataset_url": DATASET_URL,
            "measurement": "source mineral abundance values for olivine, plagioclase, low- and high-calcium pyroxene, and SmFe",
            "units": "raw source array values; no percent/fraction scale is specified in the dataset description",
            "spatial_resolution_m_per_pixel": PIXEL_SCALE_M,
            "coverage_latitude_south_degrees": [83.0, 90.0],
            "spatial_method": "nearest south-polar stereographic map pixel to each representative candidate point",
            "limitations": [
                "Values are source abundance-array values; they have not been rescaled or converted to percentages.",
                "Each value is a single approximately 193 m map pixel, not a spatial average over the candidate region.",
                "The map covers lunar polar terrain; it does not provide Mars mineral values.",
                "Candidate coordinates are representative points, not exact selected landing sites.",
            ],
        },
        "records": sample_mineral_sites(product_path, candidate_sites),
    }


def save_mineral_snapshot(snapshot: dict, destination: Path | str = DEFAULT_MINERALS_FILE) -> Path:
    """Atomically persist the mineral snapshot as JSON."""
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


def load_mineral_snapshot(source: Path | str = DEFAULT_MINERALS_FILE) -> dict:
    with Path(source).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def refresh_lunar_minerals(
    landing_sites_file: Path | str = DEFAULT_LANDING_SITES_FILE,
    minerals_file: Path | str = DEFAULT_MINERALS_FILE,
    product_path: Path | str | None = None,
) -> dict:
    """Sample all saved lunar candidate regions and replace the JSON snapshot."""
    landing_snapshot = load_snapshot(landing_sites_file)
    candidate_sites = [
        site for site in landing_snapshot.get("candidate_sites", []) if site.get("body") == "Moon"
    ]
    if not candidate_sites:
        raise RuntimeError("The landing-site snapshot has no Moon candidate regions to query.")
    source_path = Path(product_path) if product_path else download_mineral_product()
    snapshot = build_mineral_snapshot(candidate_sites, source_path)
    save_mineral_snapshot(snapshot, minerals_file)
    return snapshot


def main():
    snapshot = refresh_lunar_minerals()
    saved = DEFAULT_MINERALS_FILE
    count = sum(record.get("mineral_composition") is not None for record in snapshot["records"])
    print(f"Saved mineral abundance samples for {count} lunar candidate points to {saved}")


if __name__ == "__main__":
    main()
