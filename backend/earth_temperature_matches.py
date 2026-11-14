"""Rank Earth locations by similarity to saved lunar surface temperatures.

Use an annualized global temperature grid derived from NASA MODIS MOD11C3
monthly land-surface-temperature data. The input is a CSV, JSON, or GeoJSON
table with one row per Earth grid cell, including latitude, longitude, and an
annual average temperature in Kelvin or Celsius.

Example::

    python -m backend.earth_temperature_matches --earth-data modis_annual_lst.csv
"""

import argparse
import csv
from datetime import datetime, timezone
import heapq
import json
import math
from pathlib import Path
import re
import tempfile


DEFAULT_LUNAR_FILE = Path(__file__).parent / "data" / "lunar_temperatures.json"
DEFAULT_OUTPUT_FILE = Path(__file__).parent / "data" / "earth_temperature_matches.geojson"
EARTHDATA_URL = "https://search.earthdata.nasa.gov/search?q=C2565788897-LPCLOUD"
PRODUCT_DOI_URL = "https://doi.org/10.5067/MODIS/MOD11C3.061"
PRODUCT_ID = "MOD11C3.061"
PRODUCT_RESOLUTION_DEGREES = 0.05


def _key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value).casefold())


def _lookup(row, aliases):
    by_key = {_key(key): value for key, value in row.items()}
    for alias in aliases:
        key = _key(alias)
        if key in by_key:
            return by_key[key]
    return None


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        if not text or text.casefold() in {"na", "n/a", "null", "none", "nan", "fill"}:
            return None
        text = text.replace(",", "").replace("K", "").replace("°C", "").replace("C", "").strip()
        try:
            number = float(text)
        except ValueError:
            return None
    return number if math.isfinite(number) else None


def _coordinate(value):
    if value is None:
        return None
    text = str(value).strip()
    hemisphere = re.search(r"([NSEW])\s*$", text, flags=re.IGNORECASE)
    coordinate_text = text[:hemisphere.start()] if hemisphere else text
    number = _number(re.sub(r"[°º\s]", "", coordinate_text))
    if number is None:
        return None
    if hemisphere:
        if hemisphere.group(1).upper() in {"S", "W"}:
            number = -abs(number)
        else:
            number = abs(number)
    return number


def _temperature_kelvin(row):
    """Read an annual temperature, allowing explicit day/night annual means."""
    day = _number(_lookup(row, (
        "daytime_annual_average_kelvin", "annual_day_kelvin", "day_lst_annual_k"
    )))
    night = _number(_lookup(row, (
        "nighttime_annual_average_kelvin", "annual_night_kelvin", "night_lst_annual_k"
    )))
    if day is not None and night is not None:
        value = (day + night) / 2.0
    else:
        kelvin = _number(_lookup(row, (
            "annual_average_kelvin", "annual_mean_kelvin", "temperature_kelvin",
            "lst_kelvin", "annual_lst_k", "mean_temperature_k",
        )))
        if kelvin is not None:
            value = kelvin
        else:
            celsius = _number(_lookup(row, (
                "annual_average_celsius", "annual_mean_celsius", "temperature_celsius",
                "lst_celsius", "annual_lst_c", "mean_temperature_c",
            )))
            if celsius is not None:
                value = celsius + 273.15
            else:
                generic = _number(_lookup(row, (
                    "annual_average_temperature", "annual_mean_temperature", "temperature", "lst"
                )))
                units = str(_lookup(row, ("temperature_units", "temp_units", "units", "unit")) or "").strip().casefold()
                if generic is None:
                    return None
                if units in {"k", "kelvin", "degrees kelvin"}:
                    value = generic
                elif units in {"c", "°c", "celsius", "degrees celsius", "degc"}:
                    value = generic + 273.15
                else:
                    return None
    # Earth annual surface temperatures must be physically plausible Kelvin.
    if not math.isfinite(value) or not 0.0 < value <= 1000.0:
        return None
    return value


def _load_rows(path):
    path = Path(path)
    if path.suffix.casefold() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            yield from csv.DictReader(stream)
        return
    if path.suffix.casefold() in {".json", ".geojson"}:
        with path.open("r", encoding="utf-8") as stream:
            payload = json.load(stream)
        if isinstance(payload, list):
            yield from payload
            return
        if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
            for feature in payload.get("features", []):
                row = dict(feature.get("properties") or {})
                coordinates = (feature.get("geometry") or {}).get("coordinates")
                if isinstance(coordinates, list) and len(coordinates) >= 2:
                    row.setdefault("longitude", coordinates[0])
                    row.setdefault("latitude", coordinates[1])
                yield row
            return
        if isinstance(payload, dict):
            for key in ("records", "samples", "data", "results"):
                if isinstance(payload.get(key), list):
                    yield from payload[key]
                    return
    raise ValueError("Earth temperature input must be a CSV, JSON array, or GeoJSON FeatureCollection.")


def _load_lunar_records(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        raise ValueError("Lunar temperature snapshot must contain a records array.")
    return records


def _lunar_targets(records):
    targets = []
    for record in records:
        temperature = (record.get("temperature") or {}).get("annual_average_kelvin")
        latitude = (record.get("reference_point") or {}).get("latitude")
        longitude = (record.get("reference_point") or {}).get("longitude_east")
        if temperature is None or not math.isfinite(float(temperature)) or float(temperature) <= 0:
            continue
        targets.append({
            "landing_site_id": record.get("landing_site_id"),
            "site_name": record.get("site_name"),
            "mission": record.get("mission"),
            "status": record.get("status"),
            "temperature_kelvin": float(temperature),
            "temperature_celsius": (float(temperature) - 273.15),
            "depth_below_surface_m": (record.get("temperature") or {}).get("depth_below_surface_m"),
            "latitude": latitude,
            "longitude_east": longitude,
        })
    return targets


def _earth_point(row, row_number):
    latitude = _coordinate(_lookup(row, (
        "latitude", "lat", "latitude_degrees", "latitude_deg"
    )))
    longitude_west = _lookup(row, ("longitude_west", "lon_west", "longitudewest"))
    longitude_raw = longitude_west if longitude_west is not None else _lookup(row, (
        "longitude", "lon", "longitude_east", "longitude_degrees", "longitude_deg"
    ))
    longitude = _coordinate(longitude_raw)
    if longitude_west is not None and longitude is not None:
        longitude = -abs(longitude)
    if latitude is None or longitude is None or not -90 <= latitude <= 90 or not -360 <= longitude <= 360:
        return None
    temperature = _temperature_kelvin(row)
    if temperature is None:
        return None
    longitude = ((longitude + 180.0) % 360.0) - 180.0
    identifier = _lookup(row, ("grid_id", "pixel_id", "sample_id", "cell_id", "id"))
    period = _lookup(row, ("data_period", "year", "period", "time_period"))
    return {
        "id": str(identifier).strip() if identifier is not None else f"{latitude:.5f},{longitude:.5f}",
        "latitude": latitude,
        "longitude": longitude,
        "temperature_kelvin": temperature,
        "period": str(period).strip() if period is not None else "annual period not specified",
    }


def _match_percentage(target_kelvin, earth_kelvin):
    """Symmetric temperature ratio similarity, bounded to 0–100 percent."""
    return 100.0 * min(target_kelvin, earth_kelvin) / max(target_kelvin, earth_kelvin)


def build_match_collection(lunar_records, earth_rows, top_n=10):
    if top_n < 1:
        raise ValueError("top_n must be at least one.")
    targets = _lunar_targets(lunar_records)
    if not targets:
        raise ValueError("The lunar temperature snapshot has no usable annual-average temperatures.")

    heaps = [[] for _ in targets]
    valid_earth_rows = 0
    scanned_rows = 0
    for row_number, row in enumerate(earth_rows, start=1):
        scanned_rows += 1
        if not isinstance(row, dict):
            continue
        earth = _earth_point(row, row_number)
        if earth is None:
            continue
        valid_earth_rows += 1
        for target_index, target in enumerate(targets):
            delta = abs(earth["temperature_kelvin"] - target["temperature_kelvin"])
            score = _match_percentage(target["temperature_kelvin"], earth["temperature_kelvin"])
            # Keep the worst retained score at heap[0], so the grid can be
            # streamed without retaining millions of Earth pixels in memory.
            heap = heaps[target_index]
            item = (score, -delta, row_number, earth)
            if len(heap) < top_n:
                heapq.heappush(heap, item)
            elif item[:3] > heap[0][:3]:
                heapq.heapreplace(heap, item)

    features = []
    for target, heap in zip(targets, heaps):
        ranked = sorted(heap, key=lambda item: (-item[0], -item[1], item[3]["latitude"], item[3]["longitude"]))
        for rank, (score, negative_delta, _row_number, earth) in enumerate(ranked, start=1):
            delta = abs(negative_delta)
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [earth["longitude"], earth["latitude"]],
                },
                "properties": {
                    "lunar_site_id": target["landing_site_id"],
                    "lunar_site_name": target["site_name"],
                    "mission": target["mission"],
                    "lunar_site_status": target["status"],
                    "match_rank": rank,
                    "match_percentage": round(score, 2),
                    "absolute_temperature_difference_kelvin": round(delta, 3),
                    "lunar_annual_average_kelvin": round(target["temperature_kelvin"], 3),
                    "lunar_annual_average_celsius": round(target["temperature_celsius"], 3),
                    "lunar_depth_below_surface_m": target["depth_below_surface_m"],
                    "earth_annual_average_kelvin": round(earth["temperature_kelvin"], 3),
                    "earth_annual_average_celsius": round(earth["temperature_kelvin"] - 273.15, 3),
                    "earth_grid_id": earth["id"],
                    "earth_data_period": earth["period"],
                    "earth_data_source": "NASA MODIS Terra Land Surface Temperature/Emissivity Monthly L3 Global 0.05 Degree CMG V061",
                    "earth_data_product": PRODUCT_ID,
                    "earth_data_source_url": PRODUCT_DOI_URL,
                },
            })

    return {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "name": "NASA MODIS Terra Land Surface Temperature/Emissivity Monthly L3 Global 0.05 Degree CMG V061",
            "product_id": PRODUCT_ID,
            "doi_url": PRODUCT_DOI_URL,
            "earthdata_url": EARTHDATA_URL,
            "nominal_grid_spacing_degrees": PRODUCT_RESOLUTION_DEGREES,
            "input_note": "Provide one annualized row per Earth land grid cell, with annual day/night-mean surface temperature in Kelvin or Celsius.",
        },
        "matching": {
            "top_n_per_lunar_site": top_n,
            "lunar_sites_compared": len(targets),
            "earth_rows_scanned": scanned_rows,
            "earth_rows_eligible": valid_earth_rows,
            "temperature_match_percentage": "100 × min(lunar K, Earth K) / max(lunar K, Earth K)",
            "interpretation": "100 means equal annual temperatures; lower percentages indicate a larger relative difference. This is a similarity score, not a probability.",
            "limitations": [
                "Earth values are clear-sky satellite land-surface temperatures; lunar inputs are modeled annual averages 2 cm below the surface.",
                "Day/night values should be averaged to form each annual Earth temperature; the annual value is a comparison summary, not a simultaneous or seasonal match.",
                "MODIS observations are cloud-screened and can have missing pixels; only valid input temperatures are ranked.",
                "Earth results are grid-cell centers at approximately 0.05-degree spacing, not station locations or 1-km observations.",
                "The similarity percentage is a relative temperature ratio, not an estimate of measurement confidence or habitat suitability.",
            ],
        },
        "features": features,
    }


def write_geojson(payload, destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", newline="\n", dir=destination.parent,
            prefix=f"{destination.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write("\n")
            stream.flush()
        temporary.replace(destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--earth-data", required=True,
        help="Annualized NASA Earth land-surface-temperature grid in CSV, JSON, or GeoJSON format.",
    )
    parser.add_argument("--lunar-data", default=str(DEFAULT_LUNAR_FILE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_FILE))
    parser.add_argument("--top", type=int, default=10, help="Matches to save per lunar site (default: 10).")
    args = parser.parse_args(argv)

    lunar_records = _load_lunar_records(args.lunar_data)
    earth_rows = _load_rows(args.earth_data)
    collection = build_match_collection(lunar_records, earth_rows, top_n=args.top)
    if not collection["features"]:
        raise SystemExit("No matches found. Confirm the Earth grid includes valid coordinates and annual temperatures.")
    write_geojson(collection, args.output)
    print(
        f"Saved {len(collection['features'])} ranked Earth locations across "
        f"{collection['matching']['lunar_sites_compared']} lunar sites to {args.output}"
    )


if __name__ == "__main__":
    main()
