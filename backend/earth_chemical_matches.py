"""Match EarthChem mineral analyses to ideal mineral formula families.

The repository's EarthChem export is a mineral-analysis table with oxide
weight-percent columns, not a modal-abundance table. This module converts
those oxide analyses into atom proportions and compares them with ideal
end-member or solid-solution formulas.
"""

import csv
from datetime import datetime, timezone
import math
from pathlib import Path
import re


EARTHCHEM_URL = "https://earthchem.org/petdb"
EARTHCHEM_FORMULAS = {
    "olivine": "(Mg,Fe)2SiO4; forsterite Mg2SiO4 ↔ fayalite Fe2SiO4",
    "plagioclase": "NaAlSi3O8 ↔ CaAl2Si2O8 (albite–anorthite solid solution)",
    "low_calcium_pyroxene": "(Mg,Fe)2Si2O6 (enstatite–ferrosilite series)",
    "high_calcium_pyroxene": "Ca(Mg,Fe)Si2O6 (diopside–hedenbergite series)",
    "iron": "Fe, FeO, or Fe2O3 (closest iron-bearing end member)",
}

OXIDE_MOLAR_MASS = {
    "SiO2": 60.0843,
    "TiO2": 79.866,
    "Al2O3": 101.9613,
    "FeO": 71.844,
    "Fe2O3": 159.688,
    "MgO": 40.304,
    "MnO": 70.9374,
    "CaO": 56.0774,
    "Na2O": 61.9789,
    "K2O": 94.196,
    "Cr2O3": 151.99,
    "NiO": 74.6928,
}

OXIDE_ATOMS = {
    "SiO2": {"Si": 1, "O": 2},
    "TiO2": {"Ti": 1, "O": 2},
    "Al2O3": {"Al": 2, "O": 3},
    "FeO": {"Fe": 1, "O": 1},
    "Fe2O3": {"Fe": 2, "O": 3},
    "MgO": {"Mg": 1, "O": 1},
    "MnO": {"Mn": 1, "O": 1},
    "CaO": {"Ca": 1, "O": 1},
    "Na2O": {"Na": 2, "O": 1},
    "K2O": {"K": 2, "O": 1},
    "Cr2O3": {"Cr": 2, "O": 3},
    "NiO": {"Ni": 1, "O": 1},
}

OXIDE_HEADERS = {
    oxide: (f"{oxide} (wt%)", oxide, f"{oxide} wt%")
    for oxide in OXIDE_MOLAR_MASS
}

FORMULA_SCORE_METHOD = "100 × (1 − normalized elemental-vector L1 distance / 2) against fixed mineral end-member formulas; oxygen is omitted for silicate comparisons and included for iron/iron-oxide comparisons."


def _normal_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value).casefold())


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(",", "")
    if not text or text.casefold() in {"na", "n/a", "null", "none", "bdl", "b.d.l."}:
        return None
    if text[0] in "<>~":
        return None
    try:
        result = float(text.replace("%", ""))
    except ValueError:
        return None
    return result if math.isfinite(result) and result >= 0 else None


def _field(row, aliases, header_index=None):
    by_key = header_index or {
        _normal_key(key): key for key in row if key is not None
    }
    for alias in aliases:
        key = _normal_key(alias)
        column = by_key.get(key)
        if column is not None and row.get(column) not in (None, ""):
            return row.get(column)
    return None


def _coordinate(value):
    if value is None:
        return None
    text = str(value).strip().upper()
    hemisphere_match = re.search(r"([NSEW])\s*$", text)
    hemisphere = hemisphere_match.group(1) if hemisphere_match else None
    number_match = re.search(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)", text)
    if not number_match:
        return None
    try:
        number = float(number_match.group(0))
    except ValueError:
        return None
    if hemisphere in {"S", "W"}:
        number = -abs(number)
    elif hemisphere in {"N", "E"}:
        number = abs(number)
    return number if math.isfinite(number) else None


def _sample_name(value):
    text = str(value or "").strip()
    match = re.fullmatch(r'="(.*)"', text)
    return match.group(1).strip() if match else text or None


def _mineral_class(value):
    name = re.sub(r"[^A-Z0-9]+", " ", str(value or "").upper()).strip()
    if not name:
        return None
    if any(token in name for token in ("OLIVINE", "FORSTERITE", "FAYALITE", "TEPHROITE")):
        return "olivine"
    if any(token in name for token in ("PLAGIOCLASE", "ALBITE", "ANORTHITE", "LABRADORITE", "BYTOWNITE", "ANDESINE", "OLIGOCLASE")):
        return "plagioclase"
    if any(token in name for token in ("ORTHOPYROXENE", "ENSTATITE", "FERROSILITE")):
        return "low_calcium_pyroxene"
    if any(token in name for token in ("CLINOPYROXENE", "DIOPSIDE", "HEDENBERGITE", "AUGITE", "PIGEONITE")):
        return "high_calcium_pyroxene"
    if "PYROXENE" in name:
        return "pyroxene_unclassified"
    if any(token in name for token in ("NATIVE IRON", "IRON OXIDE", "IRON ORE", "MAGNETITE", "HEMATITE", "ILMENITE")):
        return "iron"
    return None


def _read_atom_moles(row, header_index=None):
    """Convert oxide wt% fields to proportional atom counts.

    FeOT and Fe2O3T are total-iron reporting conventions, so the first
    available total-iron field takes precedence over the separate FeO/Fe2O3
    columns. FeO-equivalent data retain the oxygen count implied by that form.
    """
    measured = {}
    oxide_wt = {}
    for oxide, aliases in OXIDE_HEADERS.items():
        value = _number(_field(row, aliases, header_index))
        if value is not None:
            measured[oxide] = value
            oxide_wt[oxide] = value

    atoms = {}

    def add_oxide(oxide, wt, *, total_iron=False):
        if wt is None or wt <= 0:
            return
        amount = wt / OXIDE_MOLAR_MASS[oxide]
        for atom, count in OXIDE_ATOMS[oxide].items():
            atoms[atom] = atoms.get(atom, 0.0) + amount * count

    feot = _number(_field(row, ("FeOT (wt%)", "FeOT", "FeO Total (wt%)"), header_index))
    fe2o3t = _number(_field(row, ("Fe2O3T (wt%)", "Fe2O3T", "Fe2O3 Total (wt%)"), header_index))
    if feot is not None:
        add_oxide("FeO", feot, total_iron=True)
        oxide_wt["FeOT"] = feot
    elif fe2o3t is not None:
        add_oxide("Fe2O3", fe2o3t, total_iron=True)
        oxide_wt["Fe2O3T"] = fe2o3t
    else:
        add_oxide("FeO", measured.get("FeO"))
        add_oxide("Fe2O3", measured.get("Fe2O3"))
        if "Fe" not in atoms:
            elemental_fe = _number(_field(row, ("Fe (wt%)", "Fe"), header_index))
            if elemental_fe is not None and elemental_fe > 0:
                atoms["Fe"] = atoms.get("Fe", 0.0) + elemental_fe / 55.845

    for oxide in OXIDE_MOLAR_MASS:
        if oxide in {"FeO", "Fe2O3"}:
            continue
        add_oxide(oxide, measured.get(oxide))
    return atoms, oxide_wt


def _formula_for(mineral_class, atoms):
    """Compare measured atom proportions with the closest ideal end-member."""
    required = {
        "olivine": {"Si"},
        "plagioclase": {"Si", "Al"},
        "low_calcium_pyroxene": {"Si"},
        "high_calcium_pyroxene": {"Si", "Ca"},
        "iron": {"Fe"},
    }
    if not required.get(mineral_class, set()).issubset(atoms):
        return None
    if mineral_class in {"olivine", "low_calcium_pyroxene", "high_calcium_pyroxene"} and not (atoms.get("Mg", 0) + atoms.get("Fe", 0)):
        return None
    if mineral_class == "plagioclase" and not (atoms.get("Na", 0) + atoms.get("Ca", 0)):
        return None

    if mineral_class == "pyroxene_unclassified":
        family_matches = [
            (family, _formula_for(family, atoms))
            for family in ("low_calcium_pyroxene", "high_calcium_pyroxene")
        ]
        family_matches = [(family, match) for family, match in family_matches if match is not None]
        if not family_matches:
            return None
        family, best_match = max(family_matches, key=lambda item: item[1]["score"])
        return {**best_match, "fitted_mineral_class": family}

    candidates = {
        "olivine": (
            ({"Mg": 2, "Si": 1, "O": 4}, "Mg2SiO4"),
            ({"Fe": 2, "Si": 1, "O": 4}, "Fe2SiO4"),
        ),
        "plagioclase": (
            ({"Na": 1, "Al": 1, "Si": 3, "O": 8}, "NaAlSi3O8"),
            ({"Ca": 1, "Al": 2, "Si": 2, "O": 8}, "CaAl2Si2O8"),
        ),
        "low_calcium_pyroxene": (
            ({"Mg": 2, "Si": 2, "O": 6}, "Mg2Si2O6"),
            ({"Fe": 2, "Si": 2, "O": 6}, "Fe2Si2O6"),
        ),
        "high_calcium_pyroxene": (
            ({"Ca": 1, "Mg": 1, "Si": 2, "O": 6}, "CaMgSi2O6"),
            ({"Ca": 1, "Fe": 1, "Si": 2, "O": 6}, "CaFeSi2O6"),
        ),
        "iron": (
            ({"Fe": 1}, "Fe"),
            ({"Fe": 1, "O": 1}, "FeO"),
            ({"Fe": 2, "O": 3}, "Fe2O3"),
        ),
    }.get(mineral_class)
    if not candidates:
        return None

    # The oxide analyses report oxygen implicitly in each oxide. For silicate
    # minerals, compare cation ratios (which carry the mineral identity) and
    # do not let the oxygen contribution dominate every match. For the iron
    # family, oxygen distinguishes native iron from FeO and Fe2O3.
    include_oxygen = mineral_class == "iron"
    observed_atoms = atoms if include_oxygen else {atom: amount for atom, amount in atoms.items() if atom != "O"}
    actual_total = sum(observed_atoms.values())
    if actual_total <= 0:
        return None
    observed = {atom: amount / actual_total for atom, amount in observed_atoms.items()}
    best = None
    for formula, formula_text in candidates:
        compared_formula = formula if include_oxygen else {atom: amount for atom, amount in formula.items() if atom != "O"}
        formula_total = sum(compared_formula.values())
        predicted = {atom: amount / formula_total for atom, amount in compared_formula.items()}
        all_atoms = set(observed) | set(predicted)
        distance = sum(abs(observed.get(atom, 0.0) - predicted.get(atom, 0.0)) for atom in all_atoms)
        score = max(0.0, min(100.0, (1.0 - distance / 2.0) * 100.0))
        if best is None or score > best[0]:
            best = (score, distance, formula_text, predicted)
    if best is None:
        return None
    score, distance, formula_text, predicted = best
    return {
        "score": round(score, 2),
        "distance": round(distance, 6),
        "formula": formula_text,
        "basis": "all reported elements including oxygen" if include_oxygen else "cation proportions; oxygen excluded",
        "normalized_atom_proportions": {key: round(value, 8) for key, value in predicted.items()},
    }


def _format_formula(atoms):
    def count_text(amount):
        if math.isclose(amount, 1.0, abs_tol=1e-9):
            return ""
        rounded = round(amount, 3)
        if math.isclose(rounded, round(rounded), abs_tol=1e-9):
            return str(int(round(rounded)))
        return f"{rounded:.3f}".rstrip("0").rstrip(".")

    return "".join(f"{atom}{count_text(amount)}" for atom, amount in atoms.items() if amount > 1e-9)


def _header_is_oxide_analysis(header):
    keys = {_normal_key(item) for item in header}
    return "mineral" in keys and "sio2wt" in keys and "mgowt" in keys and "caowt" in keys


def _valid_coordinates(row, header_index=None):
    latitude = _coordinate(_field(row, ("Latitude", "Sample Latitude", "lat"), header_index))
    longitude = _coordinate(_field(row, ("Longitude", "Sample Longitude", "lon"), header_index))
    if latitude is None or longitude is None or not -90 <= latitude <= 90:
        return None
    return latitude, ((longitude + 180.0) % 360.0) - 180.0


def _aggregate_analyses(path):
    """Stream the large PetDB CSV and average available replicate atom counts."""
    buckets = {}
    with Path(path).open("r", encoding="utf-8-sig", errors="replace", newline="") as stream:
        reader = csv.DictReader(stream)
        if not _header_is_oxide_analysis(reader.fieldnames or []):
            raise ValueError("EarthChem input is not a mineral oxide-analysis CSV.")
        header_index = {_normal_key(column): column for column in reader.fieldnames if column}
        for row in reader:
            material = str(_field(row, ("Mineral", "Analyzed Material"), header_index) or "").strip()
            mineral_class = _mineral_class(material)
            coordinates = _valid_coordinates(row, header_index)
            if mineral_class is None or coordinates is None:
                continue
            atoms, oxide_wt = _read_atom_moles(row, header_index)
            atom_total = sum(atoms.values())
            if atom_total > 0:
                atoms = {atom: amount / atom_total for atom, amount in atoms.items()}
            sample_id = _field(row, ("Sample URL", "Sample ID", "PetDB Sample ID"), header_index)
            sample_name = _sample_name(_field(row, ("Sample Name", "Name"), header_index))
            if not sample_id:
                sample_id = f"{sample_name or 'sample'}@{coordinates[0]:.6f},{coordinates[1]:.6f}"
            key = (str(sample_id), mineral_class)
            bucket = buckets.get(key)
            if bucket is None:
                bucket = {
                    "id": str(sample_id),
                    "name": sample_name,
                    "material": material,
                    "mineral_class": mineral_class,
                    "latitude": coordinates[0],
                    "longitude": coordinates[1],
                    "atom_sums": {},
                    "atom_counts": {},
                    "oxide_sums": {},
                    "oxide_counts": {},
                    "analysis_count": 0,
                }
                buckets[key] = bucket
            bucket["analysis_count"] += 1
            for atom, value in atoms.items():
                bucket["atom_sums"][atom] = bucket["atom_sums"].get(atom, 0.0) + value
                bucket["atom_counts"][atom] = bucket["atom_counts"].get(atom, 0) + 1
            for oxide, value in oxide_wt.items():
                bucket["oxide_sums"][oxide] = bucket["oxide_sums"].get(oxide, 0.0) + value
                bucket["oxide_counts"][oxide] = bucket["oxide_counts"].get(oxide, 0) + 1

    samples = []
    for bucket in buckets.values():
        atoms = {
            atom: total / bucket["atom_counts"][atom]
            for atom, total in bucket["atom_sums"].items()
        }
        formula_match = _formula_for(bucket["mineral_class"], atoms)
        if formula_match is None:
            continue
        oxide_wt = {
            oxide: round(total / bucket["oxide_counts"][oxide], 5)
            for oxide, total in bucket["oxide_sums"].items()
        }
        fitted_class = formula_match.pop("fitted_mineral_class", bucket["mineral_class"])
        samples.append({
            "id": bucket["id"],
            "name": bucket["name"],
            "material": bucket["material"],
            "mineral_class": fitted_class,
            "source_mineral_class": bucket["mineral_class"],
            "latitude": bucket["latitude"],
            "longitude": bucket["longitude"],
            "analysis_count": bucket["analysis_count"],
            "atoms": atoms,
            "oxide_wt": oxide_wt,
            "formula_match": formula_match,
        })
    return samples


def is_oxide_analysis_csv(path):
    with Path(path).open("r", encoding="utf-8-sig", errors="replace", newline="") as stream:
        reader = csv.reader(stream)
        return _header_is_oxide_analysis(next(reader, []))


def build_formula_match_collection(lunar_records, earthchem_csv, top_n=10):
    """Return per-site top chemical matches from the EarthChem oxide CSV."""
    if not 1 <= top_n <= 100:
        raise ValueError("top_n must be between 1 and 100.")
    earth_samples = _aggregate_analyses(earthchem_csv)
    features = []
    rankings = {}
    classes = ("olivine", "plagioclase", "low_calcium_pyroxene", "high_calcium_pyroxene", "iron")
    for mineral_class in classes:
        candidates = [sample for sample in earth_samples if sample["mineral_class"] == mineral_class]
        candidates.sort(key=lambda item: (-item["formula_match"]["score"], item["id"].casefold()))
        rankings[mineral_class] = len(candidates)

    for lunar in lunar_records:
        site_id = lunar.get("landing_site_id")
        site_name = lunar.get("site_name")
        abundance = (lunar.get("mineral_composition") or {}).get("abundance_values") or {}
        for mineral_class in classes:
            candidates = [sample for sample in earth_samples if sample["mineral_class"] == mineral_class]
            candidates.sort(key=lambda item: (-item["formula_match"]["score"], item["id"].casefold()))
            for rank, sample in enumerate(candidates[:top_n], start=1):
                match = sample["formula_match"]
                properties = {
                    "lunar_site_id": site_id,
                    "lunar_site_name": site_name,
                    "lunar_mineral_abundance_value": abundance.get(mineral_class),
                    "earth_sample_id": sample["id"],
                    "earth_sample_name": sample["name"],
                    "earth_material": sample["material"],
                    "earth_mineral_class": mineral_class,
                    "earth_source_mineral_class": sample["source_mineral_class"],
                    "earth_analysis_count": sample["analysis_count"],
                    "earth_mineral_chemistry_oxide_wt_percent": sample["oxide_wt"],
                    "earth_mineral_chemistry_atom_proportions": {
                        key: round(value / sum(sample["atoms"].values()), 8)
                        for key, value in sample["atoms"].items()
                    },
                    "earth_ideal_formula_family": EARTHCHEM_FORMULAS[mineral_class],
                    "earth_best_fit_formula": match["formula"],
                    "earth_formula_match_percentage": match["score"],
                    "earth_formula_match_basis": match["basis"],
                    f"{mineral_class}_match_percentage": match["score"],
                    "mineral_match_percentage": match["score"],
                    "formula_atom_l1_distance": match["distance"],
                    "formula_match_method": FORMULA_SCORE_METHOD,
                    "earth_data_source": "EarthChem PetDB mineral oxide chemistry",
                    "earth_data_source_url": EARTHCHEM_URL,
                    "match_rank": rank,
                }
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [sample["longitude"], sample["latitude"]]},
                    "properties": properties,
                })

    return {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": {
            "name": "EarthChem PetDB mineral analyses",
            "url": EARTHCHEM_URL,
            "input_file": str(earthchem_csv),
            "measurement": "Reported mineral oxide weight percentages converted to atom proportions.",
        },
        "matching": {
            "top_n_per_lunar_site_and_mineral": top_n,
            "earth_samples_eligible_by_mineral": rankings,
            "mineral_formula_families": EARTHCHEM_FORMULAS,
            "formula_match_percentage": FORMULA_SCORE_METHOD,
            "interpretation": "Ranks EarthChem analyses by chemical fit to the closest fixed ideal end-member formula for the named mineral. Lunar abundance pixels identify which minerals occur at the site; they are not oxide chemistry and are not compared numerically to Earth wt% values.",
            "limitations": [
                "EarthChem analyses are point samples with publication and sampling biases, not continuous Earth surface mineral maps.",
                "A formula match score measures fit to an ideal mineral family, not a direct Lunar-to-Earth sample composition match.",
                "Each Earth analysis is compared with the fixed end-member formulas listed in the response; intermediate solid-solution compositions can score between end-members.",
                "Silicate formula scores compare cation proportions and exclude oxygen; iron and iron-oxide scores include reported oxygen to distinguish Fe, FeO, and Fe2O3.",
                "Unreported oxide fields are not treated as zero, while reported accessory elements reduce the formula similarity.",
            ],
        },
        "features": features,
    }
