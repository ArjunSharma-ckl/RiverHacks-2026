"""Build fixed 8 km Earth terrain windows from public Copernicus GLO-30 COGs.

Run with Python, NumPy and Rasterio. Remote GeoTIFFs are read by HTTP range.
Candidate centers are approximate and identify comparison windows only.
"""

import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window


SIZE = 65
SPAN = 8000
DATA_URL = "https://registry.opendata.aws/copernicus-dem/"
CREDIT = (
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence "
    "and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; "
    "all rights reserved"
)
NASA_ANALOGS = "https://science.nasa.gov/solar-system/analog-explorer/"
SITES = [
    ("lava-beds", "Lava Beds National Monument, California", 41.72, -121.51, NASA_ANALOGS, "Volcanic field"),
    ("kilauea", "Kīlauea caldera, Hawaiʻi", 19.40, -155.28, NASA_ANALOGS, "Volcanic caldera"),
    ("pilot-valley", "Pilot Valley, Utah", 41.11, -114.04, NASA_ANALOGS, "Arid basin"),
    ("atacama", "Atacama Desert, Chile", -24.08, -69.93, NASA_ANALOGS, "Hyperarid desert"),
    ("vikursundar", "Vikursundar, Iceland", 65.069008, -16.40369,
     "https://www.hou.usra.edu/meetings/dunes2017/pdf/3020.pdf", "Wind-shaped gravel field"),
    ("death-valley", "Death Valley, California", 36.40, -116.82, NASA_ANALOGS, "Rocky desert"),
    ("salda", "Lake Salda, Türkiye", 37.55, 29.68, NASA_ANALOGS, "Lake basin and shore"),
    ("verde-valley", "Verde Valley, Arizona", 34.68, -111.85, NASA_ANALOGS, "Sedimentary terrain"),
    ("askja", "Askja caldera, Iceland", 65.04, -16.75, NASA_ANALOGS, "Volcanic caldera"),
    ("holuhraun", "Holuhraun lava field, Iceland", 64.87, -16.71,
     "https://science.nasa.gov/earth/earth-observatory/flood-basalts-on-mars-and-iceland-92858/", "Flood basalt"),
    ("haughton", "Haughton Crater, Canadian Arctic", 75.38, -89.66,
     "https://ntrs.nasa.gov/citations/20050169531", "Impact crater interior"),
    ("barringer", "Meteor Crater, Arizona", 35.0275, -111.0227,
     "https://ares.jsc.nasa.gov/engagement/activities/resources/crater-comparisons/earth-impact-database.pdf", "Impact crater"),
    ("lonar", "Lonar Crater, India", 19.9765, 76.5098,
     "https://science.nasa.gov/earth/earth-observatory/lonar-crater-india-8654/", "Basalt impact crater and lake"),
    ("sunset", "Sunset Crater, Arizona", 35.37, -111.50,
     "https://www.nps.gov/sucr/index.htm", "Scoria cone and lava flows"),
    ("craters-moon", "Craters of the Moon, Idaho", 43.43, -113.52,
     "https://www.nps.gov/crmo/index.htm", "Volcanic lava field"),
    ("mesquite", "Mesquite Flat Dunes, California", 36.62, -117.11,
     "https://www.nps.gov/places/mesquite-flat-sand-dunes.htm", "Sand dune field"),
    ("white-sands", "White Sands, New Mexico", 32.83, -106.27,
     "https://www.nps.gov/whsa/index.htm", "Gypsum dunes"),
    ("great-sand-dunes", "Great Sand Dunes, Colorado", 37.77, -105.55,
     "https://www.nps.gov/grsa/index.htm", "High dune field and foothills"),
    ("badlands", "Badlands, South Dakota", 43.77, -102.03,
     "https://www.nps.gov/badl/index.htm", "Eroded sedimentary ridges"),
    ("canyonlands", "Canyonlands, Utah", 38.41, -109.89,
     "https://www.nps.gov/cany/index.htm", "Dissected plateau"),
    ("bonneville", "Bonneville Salt Flats, Utah", 40.79, -113.84,
     "https://www.blm.gov/visit/bonneville-salt-flats", "Salt flat"),
    ("wrangell", "Kennicott Glacier, Alaska", 61.54, -142.91,
     "https://www.nps.gov/wrst/index.htm", "Glacier and alpine valley"),
    ("alps", "Jungfrau, Swiss Alps", 46.55, 7.96, DATA_URL, "Alpine comparison window"),
    ("okefenokee", "Okefenokee, Georgia", 30.82, -82.17, DATA_URL, "Low-relief wetland comparison window"),
]


def tile_url(south, west):
    lat = f"{'N' if south >= 0 else 'S'}{abs(south):02d}"
    lon = f"{'E' if west >= 0 else 'W'}{abs(west):03d}"
    key = f"Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM"
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{key}/{key}.tif"


def sample_tile(url, longs, lats):
    with rasterio.open(f"/vsicurl/{url}") as dataset:
        affine = dataset.transform
        # Raster affine points to pixel edges. Sample relative to pixel centers.
        xs = np.clip((longs - affine.c) / affine.a - 0.5, 0, dataset.width - 1)
        ys = np.clip((lats - affine.f) / affine.e - 0.5, 0, dataset.height - 1)
        left = math.floor(xs.min())
        top = math.floor(ys.min())
        right = math.ceil(xs.max())
        bottom = math.ceil(ys.max())
        image = dataset.read(1, window=Window(left, top, right - left + 1, bottom - top + 1))
        xs -= left
        ys -= top
        x0, y0 = xs.astype(int), ys.astype(int)
        x1 = np.minimum(x0 + 1, image.shape[1] - 1)
        y1 = np.minimum(y0 + 1, image.shape[0] - 1)
        x_fraction, y_fraction = xs - x0, ys - y0
        interpolated = (
            (image[y0, x0] * (1 - x_fraction) + image[y0, x1] * x_fraction) * (1 - y_fraction)
            + (image[y1, x0] * (1 - x_fraction) + image[y1, x1] * x_fraction) * y_fraction
        )
        return interpolated, [abs(affine.a), abs(affine.e)]


def build_candidate(site):
    site_id, name, latitude, longitude, context_url, terrain = site
    phi = math.radians(latitude)
    metres_per_latitude_degree = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    metres_per_longitude_degree = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    dx = SPAN / metres_per_longitude_degree / 2
    dy = SPAN / metres_per_latitude_degree / 2
    bounds = dict(west=longitude - dx, south=latitude - dy, east=longitude + dx, north=latitude + dy)
    longs, lats = np.meshgrid(
        np.linspace(bounds["west"], bounds["east"], SIZE),
        np.linspace(bounds["north"], bounds["south"], SIZE),
    )
    height_grid = np.full(lats.shape, np.nan)
    source_tiles = []
    native_resolution = []
    tile_cells = sorted(set(zip(np.floor(lats.flatten()).astype(int), np.floor(longs.flatten()).astype(int))))
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="18",
        GDAL_HTTP_MAX_RETRY="2", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    ):
        for south, west in tile_cells:
            url = tile_url(south, west)
            mask = (np.floor(lats) == south) & (np.floor(longs) == west)
            sample, resolution = sample_tile(url, longs[mask], lats[mask])
            height_grid[mask] = sample
            source_tiles.append(url)
            native_resolution.append([
                round(resolution[0] * metres_per_longitude_degree, 2),
                round(resolution[1] * metres_per_latitude_degree, 2),
            ])
    if not np.all(np.isfinite(height_grid)) or np.min(height_grid) < -500 or np.max(height_grid) > 9000:
        raise ValueError(f"Invalid elevations for {name}")
    values = np.rint(height_grid).astype(int)
    print(f"{site_id}: {values.min()} to {values.max()} m from {len(source_tiles)} tile(s)", flush=True)
    return {
        "id": site_id, "name": name, "latitude": latitude, "longitude": longitude,
        "bounds": bounds, "size": SIZE, "widthMetres": SPAN, "heightMetres": SPAN,
        "terrain": terrain, "contextUrl": context_url, "source": DATA_URL, "attribution": CREDIT,
        "sourceTiles": source_tiles, "nativeResolutionMetres": native_resolution, "values": values.flatten().tolist(),
    }


def main():
    with ThreadPoolExecutor(max_workers=8) as pool:
        candidates = list(pool.map(build_candidate, SITES))
    catalog = {
        "gridSize": SIZE, "units": "m", "elevationDatum": "EGM2008 orthometric",
        "gridOrder": "row-major, north to south, west to east; bounds are inclusive sample centers",
        "processing": "Bilinearly sample native elevation tiles, then round to integer meters.",
        "source": DATA_URL, "attribution": CREDIT, "candidates": candidates,
    }
    target = Path(__file__).resolve().parents[1] / "public" / "analogs" / "terrain" / "catalog.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(candidates)} windows, {target.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
