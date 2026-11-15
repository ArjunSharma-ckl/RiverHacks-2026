"""Resolve a named Mars feature and return available temperature/mineral data."""

from datetime import datetime, timezone
import json
import math
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from backend.mars_minerals import MARS_MINERALS_SOURCE, sample_mars_minerals
from backend.mars_temperature import MCD_SOURCE, query_mars_temperature


GEOCODE_SEARCH_URL = "https://geocode.openspaceproject.com/1/search/mars"
GEOCODE_SOURCE_URL = "https://planetarynames.wr.usgs.gov/"
MAX_NAME_LENGTH = 120
MAX_GEOCODE_RESPONSE_BYTES = 2_000_000


def _normalized_name(value):
    return " ".join((value or "").casefold().split())


def _name_without_descriptor(value):
    normalized = _normalized_name(value)
    for descriptor in (" crater", " mountain", " mount", " mons"):
        if normalized.endswith(descriptor):
            return normalized[: -len(descriptor)].strip()
    return normalized


def _descriptor(value):
    normalized = _normalized_name(value)
    for descriptor in ("crater", "mountain", "mount", "mons"):
        if normalized.endswith(f" {descriptor}"):
            return descriptor
    return None


def _valid_feature(feature):
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
        "longitude_east": longitude % 360.0,
        "diameter_km": diameter_km,
        "origin": feature.get("origin"),
    }


def resolve_mars_feature(name, opener=urlopen):
    """Resolve a Mars crater, mountain, valley, or other Gazetteer feature."""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("name must be a non-empty Mars feature name.")
    name = name.strip()
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"name must be no longer than {MAX_NAME_LENGTH} characters.")

    def search(search_name):
        request = Request(
            f"{GEOCODE_SEARCH_URL}?{urlencode({'query': search_name})}",
            headers={"User-Agent": "RiverHacksMissionBackend/1.0"},
        )
        try:
            with opener(request, timeout=20) as response:
                if getattr(response, "status", 200) != 200:
                    raise URLError(f"Mars gazetteer resolver returned HTTP {response.status}.")
                raw = response.read(MAX_GEOCODE_RESPONSE_BYTES + 1)
        except (OSError, URLError, TimeoutError) as error:
            raise RuntimeError(f"Could not resolve the Mars feature name: {error}") from error
        if len(raw) > MAX_GEOCODE_RESPONSE_BYTES:
            raise RuntimeError("The Mars gazetteer response exceeded the 2 MB limit.")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("The Mars gazetteer returned invalid JSON.") from error
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
            raise RuntimeError("The Mars gazetteer returned an unexpected response schema.")
        return [
            valid
            for item in payload["result"]
            if isinstance(item, dict)
            for valid in [_valid_feature(item)]
            if valid is not None
        ]

    matches = search(name)
    exact = [item for item in matches if _normalized_name(item["name"]) == _normalized_name(name)]
    if len(exact) == 1:
        return exact[0], matches
    if len(exact) > 1:
        return None, exact

    descriptor = _descriptor(name)
    query_core = _name_without_descriptor(name)
    if descriptor:
        descriptor_terms = {
            "crater": ("crater",),
            "mountain": ("mountain", "mons", "montes"),
            "mount": ("mount", "mons", "montes"),
            "mons": ("mons", "montes"),
        }[descriptor]

        def descriptor_matches(items):
            return [
                item for item in items
                if _name_without_descriptor(item["name"]) == query_core
                and any(term in str(item.get("feature_type", "")).casefold() for term in descriptor_terms)
            ]

        exact = descriptor_matches(matches)
        if not exact:
            # GeoCode can omit descriptor-suffixed queries or return fuzzy
            # results; retry the base name and filter to the requested class.
            base_matches = search(query_core)
            matches_by_name = {_normalized_name(item["name"]): item for item in matches}
            matches_by_name.update({_normalized_name(item["name"]): item for item in base_matches})
            matches = list(matches_by_name.values())
            exact = descriptor_matches(matches)
        if len(exact) == 1:
            return exact[0], matches
        if len(exact) > 1:
            return None, exact
        return None, matches
    if len(matches) == 1:
        return matches[0], matches
    return None, matches


def feature_location(feature):
    return {
        **feature,
        "coordinate_source": "USGS/IAU Gazetteer of Planetary Nomenclature via GeoCode",
        "coordinate_source_url": GEOCODE_SOURCE_URL,
        "coordinate_type": "gazetteer feature center",
        "coordinate_system": "Mars planetocentric latitude and east longitude",
    }


def _unavailable(error, source):
    return {
        "status": "unavailable",
        "value": None,
        "reason": str(error),
        "source": source,
    }


def lookup_mars_location(name, solar_longitude=0.0, local_time=12.0, dust_scenario=1):
    """Return coordinates and colocated MCD/TES measurements, like lunar-location."""
    feature, matches = resolve_mars_feature(name)
    if feature is None:
        if not matches:
            return {
                "schema_version": 1,
                "status": "not-found",
                "query": {"body": "Mars", "name": name.strip()},
                "matches": [],
            }
        return {
            "schema_version": 1,
            "status": "ambiguous",
            "query": {"body": "Mars", "name": name.strip()},
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

    try:
        temperature = query_mars_temperature(
            feature["latitude"], feature["longitude_east"],
            solar_longitude=solar_longitude,
            local_time=local_time,
            dust_scenario=dust_scenario,
        )
    except (OSError, RuntimeError) as error:
        temperature = _unavailable(error, MCD_SOURCE)

    try:
        minerals = sample_mars_minerals(feature["latitude"], feature["longitude_east"])
    except (OSError, RuntimeError) as error:
        minerals = _unavailable(error, MARS_MINERALS_SOURCE)

    return {
        "schema_version": 1,
        "status": "resolved",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "query": {"body": "Mars", "name": name.strip()},
        "location": feature_location(feature),
        "temperature": temperature,
        "mineral_composition": minerals,
    }
