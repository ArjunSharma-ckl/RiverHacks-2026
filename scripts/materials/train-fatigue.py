"""Train on Agrawal et al.'s room-temperature steel fatigue measurements."""
import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("csv", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
with args.csv.open(newline="") as file:
    rows = list(csv.DictReader(file))
target = "Fatigue Strength"
columns = [key for key in rows[0] if key not in ("", target, "Sample Number", "chemical_formula")]
elements = ["C", "Mn", "Cu", "Si", "P", "S", "Ni", "Cr", "Mo"]
formulas = [
    dict((element, float(value)) for element, value in
         re.findall(r"([A-Z][a-z]?)([0-9.]+)", row["chemical_formula"]))
    for row in rows
]
composition = [[formula.get(element, 0) for element in elements] for formula in formulas]
x = np.array([[float(row[key]) for key in columns] + alloy
              for row, alloy in zip(rows, composition)])
y = np.array([float(row[target]) for row in rows])
# Equal supplied compositions stay together even if heat treatments differ.
groups = np.array([json.dumps(alloy) for alloy in composition])
rng = np.random.default_rng(2026)
all_groups = rng.permutation(np.unique(groups))
boundary = int(np.ceil(len(all_groups) * .2))
test = np.flatnonzero(np.isin(groups, all_groups[:boundary]))
train = np.flatnonzero(np.isin(groups, all_groups[boundary:]))
assert not set(groups[train]) & set(groups[test])
folds = np.array_split(all_groups[boundary:], 5)

def kernel(a, b, family, width):
    squared = np.maximum(0, (a * a).sum(axis=1)[:, None] +
                         (b * b).sum(axis=1) - 2 * a @ b.T)
    if family == "RBF":
        return np.exp(-squared / (2 * width**2))
    radius = np.sqrt(3 * squared) / width
    return (1 + radius) * np.exp(-radius)

def fit(indices, family, width, penalty):
    center = x[indices].mean(axis=0)
    scale = x[indices].std(axis=0)
    scale[scale == 0] = 1
    samples = (x[indices] - center) / scale
    bias = y[indices].mean()
    gram = kernel(samples, samples, family, width)
    coefficients = np.linalg.solve(gram + penalty * np.eye(len(samples)), y[indices] - bias)
    return center, scale, samples, bias, coefficients

def predict(model, features, family, width):
    center, scale, samples, bias, coefficients = model
    return bias + kernel((features - center) / scale, samples, family, width) @ coefficients

def r2(truth, predicted):
    return float(1 - np.sum((truth - predicted)**2) / np.sum((truth - truth.mean())**2))

results = []
for family in ("RBF", "Matérn 3/2"):
    for width in (1, 2, 4, 8, 16):
        for penalty in (.0001, .001, .01, .1):
            scores = []
            for fold in folds:
                valid = np.isin(groups[train], fold)
                model = fit(train[~valid], family, width, penalty)
                predictions = predict(model, x[train[valid]], family, width)
                scores.append(r2(y[train[valid]], predictions))
            results.append({"family": family, "width": width, "penalty": penalty,
                            "cvR2": float(np.mean(scores))})
selected = max(results, key=lambda result: result["cvR2"])
family, width = selected["family"], selected["width"]
model = fit(train, family, width, selected["penalty"])
predictions = predict(model, x[test], family, width)
residuals = y[test] - predictions
metrics = {
    "target": "Room-temperature rotating-bending steel fatigue strength (MPa)",
    "source": "https://doi.org/10.1186/2193-9772-3-8",
    "dataSha256": hashlib.sha256(args.csv.read_bytes()).hexdigest(),
    "trainRows": len(train), "testRows": len(test),
    "trainCompositions": len(np.unique(groups[train])),
    "testCompositions": len(np.unique(groups[test])),
    "selected": selected, "configurationsTried": len(results),
    "testR2": r2(y[test], predictions),
    "testMaeMpa": float(np.mean(np.abs(residuals))),
    "testRmseMpa": float(np.sqrt(np.mean(residuals**2))),
    "testBaselineR2": r2(y[test], np.full(len(test), y[train].mean())),
}
center, scale, samples, bias, coefficients = model
reference = float(np.median(y[train]))
profile = x[train[np.argmin(np.abs(y[train] - reference))]]
artifact = {
    "features": columns + elements, "metrics": metrics, "family": family, "width": width,
    "center": center.tolist(), "scale": scale.tolist(), "samples": samples.tolist(),
    "coefficients": coefficients.tolist(), "bias": float(bias),
    "profile": profile.tolist(),
    "profilePredictionMpa": float(predict(model, profile[None, :], family, width)[0]),
    "referenceMpa": reference,
}
args.output.write_text(json.dumps(artifact, separators=(",", ":")) + "\n")
print(json.dumps(metrics, indent=2))
