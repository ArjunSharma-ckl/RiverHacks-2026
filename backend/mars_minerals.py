"""Sample global Mars mineral estimates from the ASU MGS/TES map cube."""

import math
import os
from pathlib import Path
import tempfile
import threading
from urllib.error import URLError
from urllib.request import Request, urlopen


PRODUCT_ID = "TES_mineral_maps_4_ppd.envi"
PRODUCT_URL = f"https://tes.mars.asu.edu/mineral_map/{PRODUCT_ID}"
PRODUCT_PAGE_URL = "https://tes.mars.asu.edu/products/"
PRODUCT_BYTES = 13 * 720 * 1440 * 4
ROWS = 720
COLUMNS = 1440
BANDS = 13
PIXELS_PER_DEGREE = 4

# Band order follows the TES product page's listed components. The source
# archive describes the product as 13-component, band-sequential ENVI data.
MINERAL_BANDS = {
    "quartz": 0,
    "k_feldspar": 1,
    "plagioclase": 2,
    "amphibole": 3,
    "low_calcium_pyroxene": 4,
    "high_calcium_pyroxene": 5,
    "olivine": 6,
    "hematite": 7,
    "sulfates": 8,
    "carbonates": 9,
    "sheet_silicates_high_si_glass": 10,
    "surface_dust": 11,
    "rms_error": 12,
}
EARTH_COMPARISON_MINERALS = (
    "olivine",
    "plagioclase",
    "low_calcium_pyroxene",
    "high_calcium_pyroxene",
)
MARS_MINERALS_SOURCE = {
    "name": "NASA Mars Global Surveyor Thermal Emission Spectrometer (TES) global mineral maps",
    "provider": "Arizona State University Mars Space Flight Facility",
    "product_id": PRODUCT_ID,
    "product_url": PRODUCT_URL,
    "product_page_url": PRODUCT_PAGE_URL,
    "measurement": "TES spectral-unmixing mineral abundance estimates",
    "units": "raw unitless source-map values; not converted to modal percent",
    "grid_spacing_degrees": 1.0 / PIXELS_PER_DEGREE,
    "nominal_equatorial_pixel_size_km": 14.8,
    "map_components": list(MINERAL_BANDS),
    "earth_comparison_minerals": list(EARTH_COMPARISON_MINERALS),
    "earth_comparison_method": "Normalize the four shared mineral-group values before comparing to PetDB modal data; measurements come from different methods and units.",
    "spatial_method": "nearest native TES grid-cell center; no interpolation",
    "limitations": [
        "TES mineral values are remote-sensing spectral estimates, not in-situ modal percentages.",
        "A value of -1 in the source raster means no valid TES estimate for that pixel.",
        "The 4-pixel-per-degree grid is a regional-scale product and can miss smaller outcrops.",
        "Hematite is reported separately as an iron-oxide indicator and is not one of the four PetDB fields used by the existing Earth matcher.",
    ],
}

_DOWNLOAD_LOCK = threading.Lock()


def _cache_path():
    configured = os.environ.get("MISSION_MARS_MINERAL_CACHE_DIR")
    cache_dir = (
        Path(configured)
        if configured
        else Path(tempfile.gettempdir()) / "riverhacks-2026"
    )
    return cache_dir / PRODUCT_ID


def download_mars_mineral_map(destination=None, opener=urlopen):
    """Download and cache the public multiband ENVI source file."""
    destination = Path(destination) if destination else _cache_path()
    with _DOWNLOAD_LOCK:
        if destination.is_file() and destination.stat().st_size == PRODUCT_BYTES:
            return destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        request = Request(
            PRODUCT_URL,
            headers={"User-Agent": "RiverHacksMissionBackend/1.0", "Accept": "application/octet-stream"},
        )
        try:
            with opener(request, timeout=120) as response:
                if getattr(response, "status", 200) != 200:
                    raise URLError(f"ASU TES archive returned HTTP {response.status}.")
                declared_size = response.headers.get("Content-Length")
                if declared_size is not None and int(declared_size) != PRODUCT_BYTES:
                    raise RuntimeError(
                        f"TES mineral map size changed: expected {PRODUCT_BYTES} bytes, "
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
            if received != PRODUCT_BYTES:
                raise RuntimeError(
                    f"Downloaded TES mineral map has {received} bytes; expected {PRODUCT_BYTES}."
                )
            temporary_path.replace(destination)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
    return destination


def _number(value, name, minimum, maximum):
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a number.") from error
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}.")
    return result


def sample_mars_minerals(latitude, longitude_east, product_path=None):
    """Return the nearest TES mineral-map cell for a Mars surface location."""
    latitude = _number(latitude, "latitude", -90.0, 90.0)
    longitude_east = _number(longitude_east, "longitude_east", -360.0, 720.0) % 360.0
    product_path = Path(product_path) if product_path else download_mars_mineral_map()
    if not product_path.is_file() or product_path.stat().st_size != PRODUCT_BYTES:
        raise RuntimeError(f"The cached TES mineral map is missing or has an unexpected size: {product_path}.")

    try:
        import numpy as np
    except ImportError as error:
        raise RuntimeError("Mars mineral sampling requires NumPy; install requirements.txt.") from error

    # The global simple-cylindrical grid starts at 0 degrees east and 90 north.
    row = min(ROWS - 1, max(0, int((90.0 - latitude) * PIXELS_PER_DEGREE)))
    column = min(COLUMNS - 1, max(0, int(longitude_east * PIXELS_PER_DEGREE)))
    grid = np.memmap(product_path, dtype=">f4", mode="r", shape=(BANDS, ROWS, COLUMNS))
    values = {
        name: float(grid[band, row, column])
        for name, band in MINERAL_BANDS.items()
    }
    grid._mmap.close()

    comparison_values = {name: values[name] for name in EARTH_COMPARISON_MINERALS}
    if any(not math.isfinite(value) or value < 0 for value in comparison_values.values()):
        return {
            "status": "unavailable",
            "value": None,
            "reason": "The nearest TES grid cell has no valid estimate for all four minerals used by the Earth comparison.",
            "source": MARS_MINERALS_SOURCE,
            "sample_cell": {
                "row": row,
                "column": column,
                "latitude": round(90.0 - (row + 0.5) / PIXELS_PER_DEGREE, 4),
                "longitude_east": round((column + 0.5) / PIXELS_PER_DEGREE, 4),
            },
        }

    return {
        "status": "available",
        "mineral_composition": {
            "abundance_values": {
                name: round(values[name], 8)
                for name in EARTH_COMPARISON_MINERALS
            },
            "iron_oxide_hematite": round(values["hematite"], 8) if values["hematite"] >= 0 else None,
            "other_tes_components": {
                name: round(value, 8)
                for name, value in values.items()
                if name not in {*EARTH_COMPARISON_MINERALS, "hematite", "rms_error"} and value >= 0
            },
            "units": MARS_MINERALS_SOURCE["units"],
            "earth_comparison_minerals": list(EARTH_COMPARISON_MINERALS),
            "earth_comparison_note": MARS_MINERALS_SOURCE["earth_comparison_method"],
        },
        "source": MARS_MINERALS_SOURCE,
        "sample_cell": {
            "row": row,
            "column": column,
            "latitude": round(90.0 - (row + 0.5) / PIXELS_PER_DEGREE, 4),
            "longitude_east": round((column + 0.5) / PIXELS_PER_DEGREE, 4),
            "grid_spacing_degrees": 1.0 / PIXELS_PER_DEGREE,
        },
    }
