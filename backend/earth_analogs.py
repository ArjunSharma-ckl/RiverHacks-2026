"""Combine lunar temperature, mineral, and image-roughness analog scores."""

from datetime import datetime, timezone
from functools import lru_cache
import json
import math
import os
from pathlib import Path

from backend import env_config as _env_config  # noqa: F401 - load local .env values.
from backend.earth_mineral_matches import (
    DEFAULT_OUTPUT_FILE as DEFAULT_EARTH_MINERAL_MATCHES,
    _load_rows as _load_earth_mineral_rows,
    _match_percentage as _mineral_match_percentage,
    _normalized as _normalize_minerals,
    build_match_collection as _build_mineral_matches,
)
from backend.earth_chemical_matches import (
    EARTHCHEM_FORMULAS,
    build_formula_match_collection as _build_formula_matches,
    is_oxide_analysis_csv as _is_oxide_analysis_csv,
)
from backend.image_roughness import (
    ROUGHNESS_LIMITATIONS,
    credentials_available as roughness_credentials_available,
    estimate_surface_roughness,
)


DATA_DIR = Path(__file__).parent / "data"
LUNAR_TEMPERATURE_FILE = DATA_DIR / "lunar_temperatures.json"
LUNAR_MINERAL_FILE = DATA_DIR / "lunar_minerals.json"
EARTH_TEMPERATURE_MATCH_FILE = DATA_DIR / "earth_temperature_matches.geojson"
EARTH_MINERAL_MATCH_FILE = DEFAULT_EARTH_MINERAL_MATCHES
DEFAULT_EARTHCHEM_CSV_FILE = DATA_DIR / "earthchem_data" / "earthchem_export_nov14_26_21815.csv"
DEFAULT_TOP_N = 10
MAX_TOP_N = 10
DEFAULT_JOIN_RADIUS_KM = 25.0
EARTH_TEMPERATURE_SOURCE = {
    "name": "NASA MODIS Terra Land Surface Temperature/Emissivity Monthly L3 Global CMG V061",
    "product_id": "MOD11C3.061",
    "url": "https://doi.org/10.5067/MODIS/MOD11C3.061",
}


def _read_json(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        return json.load(stream)


def _normalize_name(name):
    return " ".join(str(name or "").casefold().split())


def _site_snapshots():
    temperatures = _read_json(LUNAR_TEMPERATURE_FILE).get("records", [])
    minerals = _read_json(LUNAR_MINERAL_FILE).get("records", [])
    mineral_by_id = {item.get("landing_site_id"): item for item in minerals}
    mineral_by_name = {_normalize_name(item.get("site_name")): item for item in minerals}
    sites = []
    for temperature_record in temperatures:
        mineral_record = mineral_by_id.get(temperature_record.get("landing_site_id"))
        if mineral_record is None:
            mineral_record = mineral_by_name.get(_normalize_name(temperature_record.get("site_name")))
        site = dict(temperature_record)
        if mineral_record:
            site["mineral_composition"] = mineral_record.get("mineral_composition")
        sites.append(site)
    return sites


def _select_sites(name):
    sites = _site_snapshots()
    if name is None or _normalize_name(name) in {"all", "moon"}:
        return sites
    normalized = _normalize_name(name)
    selected = [
        site for site in sites
        if normalized in {
            _normalize_name(site.get("site_name")),
            _normalize_name(site.get("landing_site_id")),
        }
    ]
    if not selected:
        raise KeyError(f"No saved lunar environment matches '{name}'.")
    return selected


@lru_cache(maxsize=8)
def _load_earth_temperature_features(path_string, modified_ns, file_size):
    payload = _read_json(path_string)
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError("Earth temperature matches must be a GeoJSON FeatureCollection.")
    return payload


def _earth_temperature_collection():
    path = Path(os.environ.get("EARTH_TEMPERATURE_MATCH_FILE", EARTH_TEMPERATURE_MATCH_FILE))
    if not path.is_file():
        return None
    stat = path.stat()
    return _load_earth_temperature_features(str(path), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=8)
def _load_earth_mineral_features(path_string, modified_ns, file_size, lunar_stamp):
    path = Path(path_string)
    if path.suffix.casefold() in {".json", ".geojson"}:
        payload = _read_json(path)
        if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
            raise ValueError("Earth mineral matches must be a GeoJSON FeatureCollection.")
        return payload

    lunar_records = _read_json(LUNAR_MINERAL_FILE).get("records", [])
    if _is_oxide_analysis_csv(path):
        return _build_formula_matches(lunar_records, path, top_n=DEFAULT_TOP_N)
    rows = _load_earth_mineral_rows(path)
    return _build_mineral_matches(lunar_records, rows, top_n=DEFAULT_TOP_N)


def _earth_mineral_collection():
    configured = os.environ.get("EARTH_MINERAL_MATCH_FILE", "").strip()
    if configured:
        path = Path(configured)
        if not path.is_file():
            raise FileNotFoundError(f"EARTH_MINERAL_MATCH_FILE does not exist: {path}")
        stat = path.stat()
        return _load_earth_mineral_features(str(path), stat.st_mtime_ns, stat.st_size, "saved")

    configured_data = os.environ.get("EARTH_MINERAL_DATA_FILE", "").strip()
    if configured_data:
        path = Path(configured_data)
        if not path.is_file():
            raise FileNotFoundError(f"EARTH_MINERAL_DATA_FILE does not exist: {path}")
        stat = path.stat()
        return _load_earth_mineral_features(str(path), stat.st_mtime_ns, stat.st_size, "source-export")

    if DEFAULT_EARTHCHEM_CSV_FILE.is_file():
        stat = DEFAULT_EARTHCHEM_CSV_FILE.stat()
        return _load_earth_mineral_features(
            str(DEFAULT_EARTHCHEM_CSV_FILE), stat.st_mtime_ns, stat.st_size, "source-export"
        )

    if EARTH_MINERAL_MATCH_FILE.is_file():
        stat = EARTH_MINERAL_MATCH_FILE.stat()
        return _load_earth_mineral_features(str(EARTH_MINERAL_MATCH_FILE), stat.st_mtime_ns, stat.st_size, "saved")
    return None


def _features_for_site(collection, site):
    if not collection:
        return []
    site_id = site.get("landing_site_id")
    site_name = _normalize_name(site.get("site_name"))
    return [
        feature for feature in collection.get("features", [])
        if isinstance(feature, dict)
        and isinstance(feature.get("properties"), dict)
        and (
            feature["properties"].get("lunar_site_id") == site_id
            or _normalize_name(feature["properties"].get("lunar_site_name")) == site_name
        )
    ]


def _coordinates(feature):
    try:
        coordinates = feature["geometry"]["coordinates"]
        longitude, latitude = float(coordinates[0]), float(coordinates[1])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90:
        return None
    return longitude, latitude


def _distance_km(first, second):
    lon1, lat1 = first
    lon2, lat2 = second
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlat = lat2 - lat1
    dlon = math.radians(lon2 - lon1)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371.0088 * 2 * math.asin(min(1.0, math.sqrt(value)))


def _temperature_score(lunar_kelvin, earth_kelvin):
    if lunar_kelvin <= 0 or earth_kelvin <= 0:
        return None
    return 100.0 * min(lunar_kelvin, earth_kelvin) / max(lunar_kelvin, earth_kelvin)


def _roughness_score(lunar_um, earth_um):
    if lunar_um is None or earth_um is None:
        return None
    if lunar_um <= 0 or earth_um <= 0:
        return None
    return 100.0 * min(lunar_um, earth_um) / max(lunar_um, earth_um)


def _raw_lunar_minerals(site):
    abundance = (site.get("mineral_composition") or {}).get("abundance_values")
    if not isinstance(abundance, dict):
        return None
    keys = ("olivine", "plagioclase", "low_calcium_pyroxene", "high_calcium_pyroxene")
    try:
        values = {key: float(abundance[key]) for key in keys}
    except (KeyError, TypeError, ValueError):
        return None
    if any(not math.isfinite(value) or value < 0 for value in values.values()):
        return None
    return values


def _mineral_score(site, properties):
    if properties.get("earth_ideal_formula_family") or properties.get("earth_mineral_matches"):
        lunar_values = _raw_lunar_minerals(site)
        component_scores = _mineral_component_scores(site, properties)
        if lunar_values is None:
            return None
        scores = [
            component_scores[mineral]
            for mineral, abundance in lunar_values.items()
            if abundance > 0 and mineral in component_scores
        ]
        return sum(scores) / len(scores) if scores else None

    lunar_values = _raw_lunar_minerals(site)
    earth_values = properties.get("earth_mineral_modes")
    if not isinstance(earth_values, dict):
        earth_values = properties.get("earth_normalized_composition")
    if lunar_values is None or not isinstance(earth_values, dict):
        return None
    try:
        earth_values = {key: float(earth_values[key]) for key in lunar_values}
    except (KeyError, TypeError, ValueError):
        return None
    if any(not math.isfinite(value) or value < 0 for value in earth_values.values()):
        return None
    lunar_normalized = _normalize_minerals(lunar_values)
    earth_normalized = _normalize_minerals(earth_values)
    if lunar_normalized is None or earth_normalized is None:
        return None
    score, _distance = _mineral_match_percentage(lunar_normalized, earth_normalized)
    return score


def _mineral_component_scores(site, properties):
    """Score each shared mineral proportion independently on a 0–100 scale."""
    formula_matches = properties.get("earth_mineral_matches")
    formula_scores = {}
    if isinstance(formula_matches, dict):
        for mineral, match in formula_matches.items():
            if isinstance(match, dict) and match.get("match_percentage") is not None:
                try:
                    formula_scores[mineral] = round(float(match["match_percentage"]), 2)
                except (TypeError, ValueError):
                    continue
    direct_class = properties.get("earth_mineral_class")
    direct_score = properties.get("earth_formula_match_percentage")
    if direct_class and direct_score is not None:
        try:
            formula_scores[direct_class] = round(float(direct_score), 2)
        except (TypeError, ValueError):
            pass
    if formula_scores:
        return formula_scores

    lunar_values = _raw_lunar_minerals(site)
    earth_values = properties.get("earth_mineral_modes")
    if not isinstance(earth_values, dict):
        earth_values = properties.get("earth_normalized_composition")
    if lunar_values is None or not isinstance(earth_values, dict):
        return {}
    try:
        earth_values = {key: float(earth_values[key]) for key in lunar_values}
    except (KeyError, TypeError, ValueError):
        return {}
    if any(not math.isfinite(value) or value < 0 for value in earth_values.values()):
        return {}
    lunar_normalized = _normalize_minerals(lunar_values)
    earth_normalized = _normalize_minerals(earth_values)
    if lunar_normalized is None or earth_normalized is None:
        return {}
    return {
        mineral: round(max(0.0, 100.0 * (1.0 - abs(lunar_normalized[mineral] - earth_normalized[mineral]))), 2)
        for mineral in lunar_normalized
    }


def _candidate_key(candidate):
    props = candidate["properties"]
    identity = props.get("earth_grid_id") or props.get("earth_sample_id") or props.get("earth_sample_name")
    coords = candidate.get("geometry", {}).get("coordinates", [])
    mineral_class = props.get("earth_mineral_class")
    return f"{identity or coords}|{mineral_class or ''}".casefold()


def _store_formula_match(properties, source, sample_coords=None, distance_km=None):
    mineral_class = source.get("earth_mineral_class")
    score = source.get("earth_formula_match_percentage")
    if not mineral_class or score is None:
        return
    try:
        score = round(float(score), 2)
    except (TypeError, ValueError):
        return
    matches = properties.setdefault("earth_mineral_matches", {})
    previous = matches.get(mineral_class)
    if previous is None or score > float(previous.get("match_percentage", -1)):
        matches[mineral_class] = {
            "match_percentage": score,
            "sample_id": source.get("earth_sample_id"),
            "sample_name": source.get("earth_sample_name"),
            "material": source.get("earth_material"),
            "sample_coordinates": list(sample_coords) if sample_coords else None,
            "best_fit_formula": source.get("earth_best_fit_formula"),
            "formula_family": source.get("earth_ideal_formula_family"),
            "formula_match_basis": source.get("earth_formula_match_basis"),
            "oxide_wt_percent": source.get("earth_mineral_chemistry_oxide_wt_percent"),
            "source_mineral_class": source.get("earth_source_mineral_class"),
            "sample_distance_km": round(distance_km, 3) if distance_km is not None else None,
        }
    properties[f"{mineral_class}_match_percentage"] = max(
        score, float(previous.get("match_percentage", -1)) if previous else -1
    )
    properties["earth_mineral_data_source"] = source.get("earth_data_source", "EarthChem PetDB")


def _merge_site_candidates(site, temperature_features, mineral_features, include_roughness, candidate_limit=None):
    candidates = {}
    for feature in temperature_features:
        coords = _coordinates(feature)
        if coords is None:
            continue
        candidate = {"type": "Feature", "geometry": {"type": "Point", "coordinates": list(coords)}, "properties": dict(feature["properties"])}
        candidate["properties"]["temperature_match_percentage"] = _temperature_score(
            float(candidate["properties"].get("lunar_annual_average_kelvin", 0) or 0),
            float(candidate["properties"].get("earth_annual_average_kelvin", candidate["properties"].get("earth_temperature_kelvin", 0)) or 0),
        )
        candidates[_candidate_key(candidate)] = candidate

    parsed_minerals = []
    for feature in mineral_features:
        coords = _coordinates(feature)
        if coords is None:
            continue
        parsed_minerals.append((coords, feature))

    # Attach the closest PetDB sample to a MODIS point when it is within a
    # configurable proximity; also keep unmatched mineral sample locations.
    joined_mineral_keys = set()
    temperature_candidates = list(candidates.values())
    for mineral_coords, mineral_feature in parsed_minerals:
        nearest = None
        for candidate in temperature_candidates:
            distance = _distance_km(mineral_coords, tuple(candidate["geometry"]["coordinates"]))
            if nearest is None or distance < nearest[0]:
                nearest = (distance, candidate)
        if nearest is not None and nearest[0] <= DEFAULT_JOIN_RADIUS_KM:
            distance, candidate = nearest
            props = mineral_feature["properties"]
            if props.get("earth_ideal_formula_family"):
                _store_formula_match(candidate["properties"], props, mineral_coords, distance)
            else:
                candidate["properties"].update({
                    "earth_sample_id": props.get("earth_sample_id"),
                    "earth_sample_name": props.get("earth_sample_name"),
                    "earth_material": props.get("earth_material"),
                    "earth_sample_latitude": mineral_coords[1],
                    "earth_sample_longitude": mineral_coords[0],
                    "earth_mineral_modes": props.get("earth_mineral_modes"),
                    "earth_normalized_composition": props.get("earth_normalized_composition"),
                    "mineral_match_percentage": props.get("match_percentage"),
                    "mineral_sample_distance_km": round(distance, 3),
                    "earth_mineral_data_source": props.get("earth_data_source", "EarthChem PetDB"),
                })
            joined_mineral_keys.add(_candidate_key(mineral_feature))
    for mineral_coords, mineral_feature in parsed_minerals:
        key = _candidate_key(mineral_feature)
        if key in joined_mineral_keys:
            continue
        properties = dict(mineral_feature["properties"])
        if properties.get("earth_ideal_formula_family"):
            _store_formula_match(properties, properties, mineral_coords)
        properties["temperature_match_percentage"] = None
        properties["earth_temperature_kelvin"] = None
        properties["temperature_unavailable_reason"] = "No nearby MODIS temperature-match cell within the join radius."
        candidate = {"type": "Feature", "geometry": {"type": "Point", "coordinates": list(mineral_coords)}, "properties": properties}
        candidates[key] = candidate

    values = list(candidates.values())
    if include_roughness:
        lunar_point = site.get("reference_point") or {}
        try:
            lunar_roughness = estimate_surface_roughness(
                site.get("site_name"), "Moon",
                lunar_point.get("latitude"), lunar_point.get("longitude_east"),
            )
        except (RuntimeError, ValueError, OSError) as error:
            lunar_roughness = {"status": "unavailable", "reason": str(error)}
    else:
        lunar_roughness = {"status": "not-requested", "reason": "Roughness analysis was not requested for this query."}

    for candidate in values:
        props = candidate["properties"]
        if lunar_roughness.get("surface_roughness_um") is not None:
            coords = candidate["geometry"]["coordinates"]
            place_name = props.get("earth_sample_name") or props.get("earth_sample_id") or (
                f"Earth terrain at {coords[1]:.5f}, {coords[0]:.5f}"
            )
            try:
                earth_roughness = estimate_surface_roughness(
                    place_name, "Earth", coords[1], coords[0]
                )
            except (RuntimeError, ValueError, OSError) as error:
                earth_roughness = {"status": "unavailable", "reason": str(error)}
            props["earth_surface_roughness"] = earth_roughness
            props["roughness_match_percentage"] = _roughness_score(
                lunar_roughness.get("surface_roughness_um"), earth_roughness.get("surface_roughness_um")
            )
        else:
            props["earth_surface_roughness"] = {"status": "unavailable"}
            props["roughness_match_percentage"] = None

        temperature_score = props.get("temperature_match_percentage")
        mineral_score = _mineral_score(site, props)
        if mineral_score is None and not (
            props.get("earth_ideal_formula_family") or props.get("earth_mineral_matches")
        ):
            mineral_score = props.get("mineral_match_percentage")
        component_scores = _mineral_component_scores(site, props)
        for mineral, score in component_scores.items():
            props[f"{mineral}_match_percentage"] = score
        roughness_match = props.get("roughness_match_percentage")
        metrics = {
            "temperature": temperature_score,
            "minerals": mineral_score,
            "roughness": roughness_match,
        }
        available = {key: float(value) for key, value in metrics.items() if value is not None}
        props["mineral_match_percentage"] = round(mineral_score, 2) if mineral_score is not None else None
        props["roughness_match_percentage"] = round(roughness_match, 2) if roughness_match is not None else None
        props["combined_match_percentage"] = round(sum(available.values()) / len(available), 2) if available else None
        props["match_metrics_available"] = list(available)
        props["match_metrics_missing"] = [key for key, value in metrics.items() if value is None]
        props["match_status"] = "complete" if len(available) == 3 else "partial"
        props["lunar_surface_roughness"] = lunar_roughness

    values.sort(key=lambda item: (
        -len(item["properties"].get("match_metrics_available", [])),
        -(item["properties"].get("combined_match_percentage") or 0),
        str(item["properties"].get("earth_sample_id") or item["properties"].get("earth_grid_id") or ""),
    ))
    return (values[:candidate_limit] if candidate_limit is not None else values), lunar_roughness


def _ranked_feature_copies(features, metric, score_key, top_n, *, combined=False):
    eligible = [
        feature for feature in features
        if feature["properties"].get(score_key) is not None
    ]
    if combined:
        eligible.sort(key=lambda feature: (
            -len(feature["properties"].get("match_metrics_available", [])),
            -(feature["properties"].get(score_key) or 0),
            _candidate_key(feature),
        ))
    else:
        eligible.sort(key=lambda feature: (
            -float(feature["properties"].get(score_key)),
            _candidate_key(feature),
        ))
    ranked = []
    for rank, feature in enumerate(eligible[:top_n], start=1):
        copy = {
            "type": "Feature",
            "geometry": dict(feature["geometry"]),
            "properties": dict(feature["properties"]),
        }
        copy["properties"].update({"match_rank": rank, "ranking_metric": metric})
        ranked.append(copy)
    return ranked


def select_earth_analogs(name=None, top_n=DEFAULT_TOP_N, include_roughness=None):
    """Rank up to ten Earth candidate locations for one or all lunar sites."""
    if isinstance(top_n, bool) or not isinstance(top_n, int) or not 1 <= top_n <= MAX_TOP_N:
        raise ValueError(f"top must be an integer from 1 to {MAX_TOP_N}.")
    sites = _select_sites(name)
    roughness_keys = roughness_credentials_available()
    if include_roughness is None:
        include_roughness = len(sites) == 1 and roughness_keys
    roughness_requested = bool(include_roughness)
    roughness_performed = roughness_requested and roughness_keys

    temperature_collection = _earth_temperature_collection()
    mineral_collection = _earth_mineral_collection()
    all_features = []
    all_candidates = []
    site_summaries = []
    environment_rankings = []
    for site in sites:
        temperature_features = _features_for_site(temperature_collection, site)
        mineral_features = _features_for_site(mineral_collection, site)
        candidates, lunar_roughness = _merge_site_candidates(
            site, temperature_features, mineral_features,
            include_roughness=roughness_performed,
        )
        if roughness_requested and not roughness_keys:
            lunar_roughness = {
                "status": "not-configured",
                "reason": "Set SERPAPI_API_KEY and GEMINI_API_KEY in .env to request image-based roughness.",
            }
            for candidate in candidates:
                candidate["properties"]["lunar_surface_roughness"] = lunar_roughness
        for candidate in candidates:
            candidate["properties"].update({
                "lunar_site_id": site.get("landing_site_id"),
                "lunar_site_name": site.get("site_name"),
                "mission": site.get("mission"),
            })
        all_candidates.extend(candidates)

        mineral_rankings = {
            mineral: _ranked_feature_copies(
                candidates, f"{mineral}_match_percentage", f"{mineral}_match_percentage", top_n
            )
            for mineral in ("olivine", "plagioclase", "low_calcium_pyroxene", "high_calcium_pyroxene", "iron")
        }
        temperature_rankings = _ranked_feature_copies(
            candidates, "temperature", "temperature_match_percentage", top_n
        )
        roughness_rankings = _ranked_feature_copies(
            candidates, "roughness", "roughness_match_percentage", top_n
        )
        combined_rankings = _ranked_feature_copies(
            candidates, "combined", "combined_match_percentage", top_n, combined=True
        )
        for candidate in combined_rankings:
            candidate["properties"].pop("ranking_metric", None)
            all_features.append(candidate)
        environment_rankings.append({
            "lunar_site_id": site.get("landing_site_id"),
            "lunar_site_name": site.get("site_name"),
            "minerals": mineral_rankings,
            "temperature": temperature_rankings,
            "roughness": roughness_rankings,
            "combined": combined_rankings,
        })
        site_summaries.append({
            "lunar_site_id": site.get("landing_site_id"),
            "lunar_site_name": site.get("site_name"),
            "earth_candidates": len(candidates),
            "temperature_data_available": bool(temperature_features),
            "mineral_data_available": bool(mineral_features),
            "roughness_status": lunar_roughness.get("status", "not-requested"),
        })

    available_metrics = set()
    missing_metrics = set()
    for feature in all_candidates:
        available_metrics.update(feature["properties"].get("match_metrics_available", []))
        missing_metrics.update(feature["properties"].get("match_metrics_missing", []))
    return {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "query": {"body": "Moon", "site_name": name or "all saved lunar environments"},
        "features": all_features,
        "rankings": {"by_lunar_environment": environment_rankings},
        "matching": {
            "top_n_per_lunar_environment": top_n,
            "lunar_environments": site_summaries,
            "metrics_used_when_available": [key for key in ("temperature", "minerals", "roughness") if key in available_metrics],
            "metrics_missing": [key for key in ("temperature", "minerals", "roughness") if key in missing_metrics],
            "combined_match_percentage": "Arithmetic mean of available temperature, mineral, and roughness similarity scores. For the current oxide dataset, the mineral score averages ideal-formula-family fits only for mineral groups present in the lunar pixel.",
            "individual_mineral_match_percentage": "For oxide chemistry, 100 × (1 − normalized elemental-vector L1 distance / 2) against the closest fixed end-member formula. Silicate formulas compare cation proportions; iron formulas include oxygen. For modal files, it is normalized abundance similarity.",
            "ranking_note": "Complete three-metric matches rank ahead of partial matches. Partial candidates are ranked only over available dimensions and are not directly equivalent to complete scores.",
            "temperature_method": "100 × min(lunar K, Earth K) / max(lunar K, Earth K), from the saved NASA MODIS match grid.",
            "mineral_method": "Converts reported oxide wt% values to atom proportions and compares each EarthChem analysis with fixed ideal end-member formulas. The closest end-member is selected; intermediate solid-solution compositions score between end-members, and unclassified pyroxenes are assigned to the closer low- or high-calcium family.",
            "roughness_method": "100 × min(lunar visual-proxy µm, Earth visual-proxy µm) / max(...); requires one Gemini image estimate per site and candidate.",
            "earth_mineral_input": str(
                os.environ.get("EARTH_MINERAL_MATCH_FILE")
                or os.environ.get("EARTH_MINERAL_DATA_FILE")
                or (DEFAULT_EARTHCHEM_CSV_FILE if DEFAULT_EARTHCHEM_CSV_FILE.is_file() else EARTH_MINERAL_MATCH_FILE)
            ),
            "earth_temperature_input": str(os.environ.get("EARTH_TEMPERATURE_MATCH_FILE", EARTH_TEMPERATURE_MATCH_FILE)),
            "roughness_analysis_requested": roughness_requested,
            "roughness_analysis_performed": roughness_performed,
            "roughness_provider_keys_configured": roughness_keys,
            "roughness_limitations": list(ROUGHNESS_LIMITATIONS),
            "data_limitations": [
                "The committed Earth MODIS match grid is based on one monthly composite, not a full-year climatology.",
                "Current EarthChem CSV contains georeferenced mineral oxide analyses, so mineral percentages are formula-family chemistry-fit scores, not Earth modal abundance percentages. Lunar map values only mark which mineral families occur; they are not lunar oxide chemistry for a direct chemical comparison.",
                "MODIS candidate cells and PetDB sample coordinates are joined only when within 25 km; this is a regional association, not a co-located measurement.",
            ],
        },
    }
