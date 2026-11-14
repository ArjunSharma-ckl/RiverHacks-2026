"""Resolve a named lunar feature and return colocated temperature/mineral data.

Feature names are resolved with the GeoCode service, whose entries come from
the USGS/IAU Gazetteer of Planetary Nomenclature. Measurement values are
sampled from the local Diviner and M3-derived products when those products are
cached. Known Artemis candidate names can use the saved candidate-point JSON
snapshots when a full source product is not cached.
"""

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from backend.lunar_minerals import (
    DEFAULT_MINERALS_FILE,
    cached_mineral_product_path,
    load_mineral_snapshot,
    sample_mineral_at_point,
)
from backend.lunar_temperature import (
    DEFAULT_TEMPERATURES_FILE,
    SEARCH_RADIUS_KM,
    cached_pds_product_path,
    load_temperature_snapshot,
    sample_temperature_at_point,
)


GEOCODE_SEARCH_URL = "https://geocode.openspaceproject.com/1/search/moon"
GEOCODE_SOURCE_URL = "https://planetarynames.wr.usgs.gov/"
MAX_NAME_LENGTH = 120
MAX_GEOCODE_RESPONSE_BYTES = 2_000_000


def _normalized_name(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def _name_without_descriptor(value: str) -> str:
    return re.sub(r"\s+(crater|mountain|mount|mons)$", "", _normalized_name(value)).strip()


def _valid_feature(feature: dict) -> dict | None:
    try:
        name = feature["name"]
        latitude = float(feature["centerLatitude"])
        longitude = float(feature["centerLongitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if (
        not isinstance(name, str)
        or not name.strip()
        or not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90.0 <= latitude <= 90.0
    ):
        return None
    diameter = feature.get("diameter")
    try:
        diameter_km = float(diameter) if diameter is not None else None
    except (TypeError, ValueError):
        diameter_km = None
    if diameter_km is not None and not math.isfinite(diameter_km):
        diameter_km = None
    return {
        "name": name.strip(),
        "feature_type": feature.get("type"),
        "latitude": latitude,
        # GeoCode returns signed east-positive longitude; normalize to 0..360.
        "longitude_east": longitude % 360.0,
        "diameter_km": diameter_km,
        "origin": feature.get("origin"),
    }


def resolve_lunar_feature(name: str, opener=urlopen) -> tuple[dict | None, list[dict]]:
    """Resolve an exact/fuzzy Moon feature name; return (selected, matches)."""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("name must be a non-empty lunar feature name.")
    name = name.strip()
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"name must be no longer than {MAX_NAME_LENGTH} characters.")

    request = Request(
        f"{GEOCODE_SEARCH_URL}?{urlencode({'query': name})}",
        headers={"User-Agent": "RiverHacksMissionBackend/1.0"},
    )
    with opener(request, timeout=20) as response:
        status = getattr(response, "status", 200)
        if status != 200:
            raise URLError(f"Lunar gazetteer resolver returned HTTP {status}.")
        raw = response.read(MAX_GEOCODE_RESPONSE_BYTES + 1)
    if len(raw) > MAX_GEOCODE_RESPONSE_BYTES:
        raise RuntimeError("The lunar gazetteer response exceeded the 2 MB limit.")
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RuntimeError("The lunar gazetteer returned invalid JSON.") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
        raise RuntimeError("The lunar gazetteer response has an unexpected schema.")

    matches = [
        valid
        for feature in payload["result"]
        if isinstance(feature, dict)
        for valid in [_valid_feature(feature)]
        if valid is not None
    ]
    query_name = _normalized_name(name)
    query_core = _name_without_descriptor(name)
    exact_matches = [
        item for item in matches
        if _normalized_name(item["name"]) == query_name
        or _normalized_name(item["name"]) == query_core
    ]
    if len(exact_matches) == 1:
        return exact_matches[0], matches
    if len(exact_matches) > 1:
        return None, exact_matches
    if len(matches) == 1:
        return matches[0], matches
    return None, matches


def _source_summary(snapshot: dict | None) -> dict | None:
    if not isinstance(snapshot, dict):
        return None
    source = snapshot.get("source", {})
    return {
        key: source[key]
        for key in ("name", "dataset_id", "product_id", "product_url")
        if key in source
    }


def _saved_candidate_records(site_name: str) -> tuple[dict | None, dict | None]:
    """Find published candidate-point samples matching a known site name."""
    normalized = _normalized_name(site_name)
    try:
        temperature_snapshot = load_temperature_snapshot(DEFAULT_TEMPERATURES_FILE)
    except (OSError, json.JSONDecodeError):
        temperature_snapshot = None
    try:
        mineral_snapshot = load_mineral_snapshot(DEFAULT_MINERALS_FILE)
    except (OSError, json.JSONDecodeError):
        mineral_snapshot = None

    temperature_record = None
    mineral_record = None
    if temperature_snapshot:
        temperature_record = next(
            (record for record in temperature_snapshot.get("records", [])
             if _normalized_name(record.get("site_name", "")) == normalized),
            None,
        )
    if mineral_snapshot:
        mineral_record = next(
            (record for record in mineral_snapshot.get("records", [])
             if _normalized_name(record.get("site_name", "")) == normalized),
            None,
        )
    return (
        ({"snapshot": temperature_snapshot, "record": temperature_record}
         if temperature_record else None),
        ({"snapshot": mineral_snapshot, "record": mineral_record}
         if mineral_record else None),
    )


def _temperature_result(
    latitude: float,
    longitude_east: float,
    product_path: Path | None,
    saved_candidate: dict | None,
) -> dict:
    if product_path is not None:
        sample = sample_temperature_at_point(product_path, latitude, longitude_east)
        if sample is not None:
            return {
                "status": "available",
                **sample["temperature"],
                "sample_cell": sample["sample_cell"],
                "source": {
                    "name": "NASA Planetary Data System, LRO Diviner Polar Resource Product",
                    "dataset_id": "LRO-L-DLRE-5-PRP-V2.0",
                    "product_id": "DLRE_PRP_SOUTH.TAB",
                },
            }
    if saved_candidate:
        record = saved_candidate["record"]
        if record.get("temperature") is not None:
            return {
                "status": "available",
                **record["temperature"],
                "sample_cell": record.get("sample_cell"),
                "source": _source_summary(saved_candidate["snapshot"]),
                "sampling_note": "Saved Artemis candidate-point value; this point may differ from the named feature center.",
            }
    if product_path is None:
        reason = (
            "The Diviner source table is not cached. Run `python -m backend.lunar_temperature` "
            "or POST /api/lunar-temperatures/refresh before querying arbitrary lunar locations."
        )
    else:
        reason = f"No Diviner mesh cell was found within {SEARCH_RADIUS_KM:g} km of the feature center."
    return {"status": "unavailable", "value": None, "reason": reason}


def _mineral_result(
    latitude: float,
    longitude_east: float,
    product_path: Path | None,
    saved_candidate: dict | None,
) -> dict:
    if product_path is not None:
        sample = sample_mineral_at_point(product_path, latitude, longitude_east)
        if sample is not None:
            return {
                "status": "available",
                **sample["mineral_composition"],
                "sample_cell": sample["sample_cell"],
                "source": {
                    "dataset_id": "10.5281/zenodo.20725024",
                    "product_id": "Abcube_Oli_Pla_Opx_Cpx_Smfe.mat",
                },
            }
    if saved_candidate:
        record = saved_candidate["record"]
        if record.get("mineral_composition") is not None:
            return {
                "status": "available",
                **record["mineral_composition"],
                "sample_cell": record.get("sample_cell"),
                "source": _source_summary(saved_candidate["snapshot"]),
                "sampling_note": "Saved Artemis candidate-point value; this point may differ from the named feature center.",
            }
    if product_path is None:
        reason = (
            "The lunar mineral cube is not cached. Run `python -m backend.lunar_minerals` "
            "or POST /api/lunar-minerals/refresh before querying arbitrary lunar locations."
        )
    else:
        reason = "The feature center is outside the mineral map or its pixel has no valid abundance values."
    return {"status": "unavailable", "value": None, "reason": reason}


def lookup_lunar_location(
    name: str,
    opener=urlopen,
    temperature_product_path: Path | str | None = None,
    mineral_product_path: Path | str | None = None,
) -> dict:
    """Return coordinates and available Diviner/M3 values for a named Moon feature."""
    feature, matches = resolve_lunar_feature(name, opener=opener)
    if feature is None:
        if not matches:
            return {
                "schema_version": 1,
                "status": "not-found",
                "query": {"body": "Moon", "name": name.strip()},
                "matches": [],
            }
        return {
            "schema_version": 1,
            "status": "ambiguous",
            "query": {"body": "Moon", "name": name.strip()},
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

    temperature_path = (
        Path(temperature_product_path)
        if temperature_product_path is not None
        else cached_pds_product_path()
    )
    minerals_path = (
        Path(mineral_product_path)
        if mineral_product_path is not None
        else cached_mineral_product_path()
    )
    candidate_temperature, candidate_minerals = _saved_candidate_records(feature["name"])
    latitude = feature["latitude"]
    longitude_east = feature["longitude_east"]
    return {
        "schema_version": 1,
        "status": "resolved",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "query": {"body": "Moon", "name": name.strip()},
        "location": {
            **feature,
            "coordinate_source": "USGS/IAU Gazetteer of Planetary Nomenclature via GeoCode",
            "coordinate_source_url": GEOCODE_SOURCE_URL,
            "coordinate_type": "gazetteer feature center",
        },
        "temperature": _temperature_result(
            latitude, longitude_east, temperature_path, candidate_temperature
        ),
        "mineral_composition": _mineral_result(
            latitude, longitude_east, minerals_path, candidate_minerals
        ),
    }
