"""Match lunar mineral compositions to georeferenced Earth rock-mode samples.

EarthChem PetDB provides sample coordinates and published modal mineral
abundances. Export its ``ROCK MODE`` / ``Whole Rock`` data with olivine,
plagioclase, orthopyroxene, and clinopyroxene fields, then run this module with
the export. Results are ranked separately for each lunar candidate and saved
as a GeoJSON FeatureCollection.

Example::

    python -m backend.earth_mineral_matches --earth-data petdb-rock-modes.csv
"""

import argparse
import csv
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import tempfile


DEFAULT_LUNAR_FILE = Path(__file__).parent / "data" / "lunar_minerals.json"
DEFAULT_OUTPUT_FILE = Path(__file__).parent / "data" / "earth_mineral_matches.geojson"
EARTHCHEM_URL = "https://explore.earthchem.org/"
EARTHCHEM_API_URL = "https://earthchem.github.io/ec-doc/documentation/petdb_api.html"

# These pairs reflect broad mineral-family analogues: lunar low-Ca pyroxene is
# compared with Earth orthopyroxene (OPX), and lunar high-Ca pyroxene with
# clinopyroxene (CPX). They are not exact mineral-chemistry equivalences.
MINERAL_ALIASES = {
    "olivine": ("OL[MODE]", "OLIVINE", "OL", "OLIVINE_MODE"),
    "plagioclase": ("PLAG[MODE]", "PL[MODE]", "PLAGIOCLASE", "PLAG"),
    "low_calcium_pyroxene": (
        "OPX[MODE]", "ORTHOPYROXENE", "LOW_CALCIUM_PYROXENE", "OPX"
    ),
    "high_calcium_pyroxene": (
        "CPX[MODE]", "CLINOPYROXENE", "HIGH_CALCIUM_PYROXENE", "CPX"
    ),
}
ALLOWED_MODAL_UNITS = {"%", "vol%", "volume%", "volumepercent", "volpercent"}


def _key(value):
    """Normalize a table or JSON key without losing mineral bracket syntax."""
    return re.sub(r"[^a-z0-9]+", "", str(value).casefold())


def _flatten_record(record):
    """Flatten nested PetDB JSON metadata and variable/value output rows."""
    flattened = {}
    variable_units = {}

    def visit(value):
        if isinstance(value, dict):
            normalized = {_key(key): item for key, item in value.items()}
            variable = next(
                (normalized[name] for name in ("variable", "variablename", "analyte")
                 if name in normalized),
                None,
            )
            measurement = next(
                (normalized[name] for name in ("value", "result", "concentration")
                 if name in normalized),
                None,
            )
            if variable is not None and measurement is not None:
                flattened[str(variable)] = measurement
                unit = next(
                    (normalized[name] for name in ("unit", "displayunit", "units")
                     if name in normalized),
                    None,
                )
                if unit is not None:
                    variable_units[str(variable)] = unit
            for key, child in value.items():
                if isinstance(child, (dict, list)):
                    visit(child)
                else:
                    flattened.setdefault(str(key), child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(record)
    return flattened, variable_units


def _first(flattened, aliases):
    by_key = {_key(key): value for key, value in flattened.items()}
    for alias in aliases:
        candidate = _key(alias)
        if candidate in by_key:
            return by_key[candidate]
    return None


def _parse_number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        if not text or text.casefold() in {"na", "n/a", "null", "none", "bdl", "b.d.l."}:
            return None
        if text.startswith(("<", ">", "~")):
            return None
        text = text.replace(",", "").replace("%", "").strip()
        try:
            number = float(text)
        except ValueError:
            return None
    return number if math.isfinite(number) else None


def _coordinate(value, *, west_positive=False):
    if value is None:
        return None
    text = str(value).strip()
    hemisphere = re.search(r"([NSEW])\s*$", text, flags=re.IGNORECASE)
    coordinate_text = text[:hemisphere.start()] if hemisphere else text
    number = _parse_number(re.sub(r"[°º\s]", "", coordinate_text))
    if number is None:
        return None
    if hemisphere and hemisphere.group(1).upper() in {"S", "W"}:
        number = -abs(number)
    elif hemisphere and hemisphere.group(1).upper() in {"N", "E"}:
        number = abs(number)
    elif west_positive:
        number = -number
    return number


def _load_rows(path):
    path = Path(path)
    if path.suffix.casefold() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            return list(csv.DictReader(stream))
    if path.suffix.casefold() in {".json", ".geojson"}:
        with path.open("r", encoding="utf-8") as stream:
            payload = json.load(stream)
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            if payload.get("type") == "FeatureCollection":
                rows = []
                for feature in payload.get("features", []):
                    row = dict(feature.get("properties") or {})
                    coordinates = (feature.get("geometry") or {}).get("coordinates")
                    if isinstance(coordinates, list) and len(coordinates) >= 2:
                        row.setdefault("longitude", coordinates[0])
                        row.setdefault("latitude", coordinates[1])
                    rows.append(row)
                return rows
            for key in ("records", "samples", "data", "results"):
                if isinstance(payload.get(key), list):
                    return payload[key]
    raise ValueError("Earth mineral input must be a CSV, JSON array, or GeoJSON FeatureCollection.")


def _load_lunar_records(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        payload = json.load(stream)
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        raise ValueError("Lunar mineral snapshot must contain a records array.")
    return records


def _read_earth_sample(row, row_index):
    flattened, variable_units = _flatten_record(row)
    values = {}
    for mineral, aliases in MINERAL_ALIASES.items():
        raw_value = _first(flattened, aliases)
        value = _parse_number(raw_value)
        if value is None or value < 0:
            return None
        values[mineral] = value

    latitude = _coordinate(_first(flattened, (
        "latitude", "lat", "sample latitude", "sample_latitude", "latitude_deg",
        "latitude_degrees",
    )))
    west_lon = _first(flattened, ("longitude_west", "lon_west", "longitudewest"))
    longitude_raw = west_lon if west_lon is not None else _first(flattened, (
        "longitude", "lon", "sample longitude", "sample_longitude", "longitude_deg",
        "longitude_degrees", "longitude_east",
    ))
    longitude = _coordinate(longitude_raw, west_positive=west_lon is not None)
    if latitude is None or longitude is None or not -90 <= latitude <= 90:
        return None
    if not -360 <= longitude <= 360:
        return None
    longitude = ((longitude + 180.0) % 360.0) - 180.0

    units = []
    for mineral, aliases in MINERAL_ALIASES.items():
        unit = next(
            (value for key, value in variable_units.items()
             if _key(key) in {_key(alias) for alias in aliases}),
            None,
        )
        if unit is not None:
            units.append(str(unit).strip().casefold().replace(" ", ""))
    row_unit = _first(flattened, ("unit", "units", "display unit", "display_unit"))
    if row_unit is not None:
        units.append(str(row_unit).strip().casefold().replace(" ", ""))
    if any(unit not in ALLOWED_MODAL_UNITS for unit in units):
        return None
    if len(set(units)) > 1:
        return None

    sample_id = _first(flattened, (
        "petdb sample id", "sample id", "sample_id", "sampleid", "rootparent",
        "specimen name", "sample name", "name", "id",
    ))
    if sample_id is None or not str(sample_id).strip():
        sample_id = f"earthchem-row-{row_index}"
    sample_name = _first(flattened, ("sample name", "specimen name", "other names"))
    material = _first(flattened, ("material", "analysis material", "material name"))

    return {
        "id": str(sample_id).strip(),
        "name": str(sample_name).strip() if sample_name is not None else None,
        "material": str(material).strip() if material is not None else None,
        "latitude": latitude,
        "longitude": longitude,
        "values": values,
        "units": units[0] if units else "unspecified modal percent",
    }


def _normalized(composition):
    total = sum(composition.values())
    if not math.isfinite(total) or total <= 0:
        return None
    return {mineral: value / total for mineral, value in composition.items()}


def _match_percentage(lunar, earth):
    """Return normalized L1 abundance overlap as a 0-100 similarity score."""
    distance = sum(abs(lunar[key] - earth[key]) for key in MINERAL_ALIASES)
    return max(0.0, min(100.0, (1.0 - distance / 2.0) * 100.0)), distance


def build_match_collection(lunar_records, earth_rows, top_n=10):
    if top_n < 1:
        raise ValueError("top_n must be at least one.")
    earth_samples = [
        sample for index, row in enumerate(earth_rows, start=1)
        if isinstance(row, dict)
        for sample in [_read_earth_sample(row, index)]
        if sample is not None and _normalized(sample["values"]) is not None
    ]
    features = []
    sites_with_composition = 0
    for lunar in lunar_records:
        abundance = (lunar.get("mineral_composition") or {}).get("abundance_values")
        if not isinstance(abundance, dict):
            continue
        shared = {key: _parse_number(abundance.get(key)) for key in MINERAL_ALIASES}
        if any(value is None or value < 0 for value in shared.values()):
            continue
        lunar_normalized = _normalized(shared)
        if lunar_normalized is None:
            continue
        sites_with_composition += 1

        matches = []
        for earth in earth_samples:
            earth_normalized = _normalized(earth["values"])
            percentage, distance = _match_percentage(lunar_normalized, earth_normalized)
            matches.append((percentage, distance, earth, earth_normalized))
        matches.sort(key=lambda item: (-item[0], item[2]["id"].casefold()))

        for rank, (percentage, distance, earth, earth_normalized) in enumerate(matches[:top_n], start=1):
            properties = {
                "lunar_site_id": lunar.get("landing_site_id"),
                "lunar_site_name": lunar.get("site_name"),
                "mission": lunar.get("mission"),
                "lunar_site_status": lunar.get("status"),
                "match_rank": rank,
                "match_percentage": round(percentage, 2),
                "normalized_l1_distance": round(distance, 6),
                "similarity_method": "100 × (1 − normalized L1 distance / 2)",
                "earth_sample_id": earth["id"],
                "earth_sample_name": earth["name"],
                "earth_material": earth["material"],
                "earth_composition_units": earth["units"],
                "earth_mineral_modes": earth["values"],
                "earth_normalized_composition": {
                    key: round(value, 8) for key, value in earth_normalized.items()
                },
                "lunar_raw_abundance_values": shared,
                "lunar_normalized_composition": {
                    key: round(value, 8) for key, value in lunar_normalized.items()
                },
                "earth_data_source": "EarthChem PetDB",
                "earth_data_source_url": EARTHCHEM_URL,
            }
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [earth["longitude"], earth["latitude"]],
                },
                "properties": properties,
            })

    return {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "name": "EarthChem PetDB",
            "url": EARTHCHEM_URL,
            "api_documentation_url": EARTHCHEM_API_URL,
            "input_note": "Provide a PetDB export filtered to ROCK MODE / Whole Rock with OL[MODE], PLAG[MODE], OPX[MODE], and CPX[MODE].",
        },
        "matching": {
            "top_n_per_lunar_site": top_n,
            "lunar_sites_with_composition": sites_with_composition,
            "earth_samples_eligible": len(earth_samples),
            "minerals_compared": list(MINERAL_ALIASES),
            "mineral_mapping": {
                "olivine": "OL[MODE]",
                "plagioclase": "PLAG[MODE]",
                "low_calcium_pyroxene": "OPX[MODE] (orthopyroxene analogue)",
                "high_calcium_pyroxene": "CPX[MODE] (clinopyroxene analogue)",
            },
            "excluded_lunar_channel": "SmFe (no directly comparable Earth modal field)",
            "normalization": "Each four-mineral vector is normalized to sum to 1 before scoring.",
            "match_percentage_definition": "100 × (1 − L1 distance / 2); 100 is identical normalized proportions, 0 is maximally different.",
            "limitations": [
                "Results are sample-level Earth locations, not continuous map coverage.",
                "PetDB percentages must be modal abundance data; rows explicitly marked wt% or mol% are excluded.",
                "The score is a relative abundance similarity, not a confidence or probability.",
                "Lunar input values are raw map-array values with no published percent scale; normalization compares proportions only.",
                "OPX/CPX are broad analogues for low-/high-calcium pyroxene, not exact mineral-species equivalence.",
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
        help="EarthChem PetDB modal-mineral export in CSV, JSON, or GeoJSON format.",
    )
    parser.add_argument("--lunar-data", default=str(DEFAULT_LUNAR_FILE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_FILE))
    parser.add_argument("--top", type=int, default=10, help="Matches to save per lunar site (default: 10).")
    args = parser.parse_args(argv)

    lunar_records = _load_lunar_records(args.lunar_data)
    earth_rows = _load_rows(args.earth_data)
    collection = build_match_collection(lunar_records, earth_rows, top_n=args.top)
    if not collection["features"]:
        raise SystemExit(
            "No eligible matches were found. Confirm the EarthChem export has coordinates and all four complete modal fields."
        )
    write_geojson(collection, args.output)
    print(
        f"Saved {len(collection['features'])} ranked Earth matches across "
        f"{collection['matching']['lunar_sites_with_composition']} lunar sites to {args.output}"
    )


if __name__ == "__main__":
    main()
