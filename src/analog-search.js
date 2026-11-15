const form = document.querySelector("#analog-form");
const bodyInput = document.querySelector("#body");
const modeInput = document.querySelector("#query-mode");
const attributeInput = document.querySelector("#attribute");
const results = document.querySelector("#results");

function syncFields() {
  const locationMode = modeInput.value === "location";
  document.querySelector("#location-fields").hidden = !locationMode;
  document.querySelector("#attribute-fields").hidden = locationMode;
  document.querySelector("#location-name").required = locationMode;
  document.querySelector("#temperature-fields").hidden = attributeInput.value !== "temperature";
  document.querySelector("#mineral-fields").hidden = attributeInput.value !== "mineral";
  document.querySelector("#roughness-fields").hidden = attributeInput.value !== "roughness";
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function pointText(feature) {
  const point = feature?.geometry?.coordinates;
  if (!Array.isArray(point) || point.length < 2) return "coordinates unavailable";
  return `${Number(point[1]).toFixed(4)}°, ${Number(point[0]).toFixed(4)}°`;
}

function featureText(feature, scoreKey) {
  const props = feature.properties ?? {};
  const name = props.earth_sample_name || props.earth_sample_id || props.earth_grid_id || "Earth location";
  const score = props[scoreKey] ?? props.match_percentage;
  const details = [`${name} (${pointText(feature)})`, `${score ?? "—"}% match`];
  if (props.earth_best_fit_formula) details.push(`closest formula ${props.earth_best_fit_formula}`);
  if (props.earth_temperature_kelvin != null && Number.isFinite(Number(props.earth_temperature_kelvin))) {
    details.push(`${Number(props.earth_temperature_kelvin).toFixed(1)} K`);
  }
  const roughness = props.earth_surface_roughness?.surface_roughness_um;
  if (roughness != null && Number.isFinite(Number(roughness))) details.push(`${Number(roughness).toFixed(3)} µm visual proxy`);
  return details.join(" · ");
}

function renderFeatureGroup(parent, title, features, scoreKey, emptyText) {
  const section = document.createElement("section");
  section.className = "result-group";
  addText(section, "h3", title);
  if (!features?.length) {
    addText(section, "p", emptyText || "No comparable records were returned.");
  } else {
    const list = document.createElement("ol");
    for (const feature of features) addText(list, "li", featureText(feature, scoreKey));
    section.append(list);
  }
  parent.append(section);
}

function renderLocationResponse(data) {
  results.replaceChildren();
  addText(results, "h2", `${data.query?.body ?? bodyInput.value} analogs: ${data.query?.location_name ?? data.query?.site_name ?? "location"}`);
  const rankings = data.rankings?.by_environment?.[0] ?? data.rankings?.by_lunar_environment?.[0];
  if (!rankings) {
    const matches = data.matches ?? [];
    if (matches.length) {
      addText(results, "p", "The location name is ambiguous. Possible matches:");
      const list = document.createElement("ul");
      for (const match of matches) addText(list, "li", `${match.name} (${match.feature_type ?? "surface feature"})`);
      results.append(list);
    } else {
      addText(results, "p", "No ranking data was returned for this location.");
    }
    return;
  }
  const measurements = data.source_measurements ?? {};
  for (const [key, label] of [["temperature", "Target temperature"], ["mineral_composition", "Target mineral composition"]]) {
    const measurement = measurements[key];
    if (measurement?.status === "unavailable") {
      addText(results, "p", `${label} unavailable: ${measurement.reason || "source data unavailable"}`, "note");
    }
  }
  const targetRoughness = measurements.surface_roughness;
  if (targetRoughness?.status && targetRoughness.status !== "estimated" && targetRoughness.status !== "provided") {
    addText(results, "p", `Target roughness unavailable: ${targetRoughness.reason || "image estimate unavailable"}`, "note");
  }
  const minerals = rankings.minerals ?? {};
  for (const [key, title] of [
    ["olivine", "Olivine"],
    ["plagioclase", "Plagioclase"],
    ["low_calcium_pyroxene", "Low-calcium pyroxene"],
    ["high_calcium_pyroxene", "High-calcium pyroxene"],
    ["iron", "Iron-bearing minerals"],
  ]) renderFeatureGroup(results, `Mineral: ${title}`, minerals[key], `${key}_match_percentage`);
  renderFeatureGroup(results, "Temperature", rankings.temperature, "temperature_match_percentage");
  const roughnessStatus = data.matching?.environment?.roughness_status ?? data.matching?.lunar_environments?.[0]?.roughness_status;
  renderFeatureGroup(results, "Surface roughness", rankings.roughness, "roughness_match_percentage", roughnessStatus === "not-configured" ? "Set SERPAPI_API_KEY and GEMINI_API_KEY on the backend to estimate target and Earth roughness." : undefined);
  renderFeatureGroup(results, "Combined available attributes", rankings.combined, "combined_match_percentage");
  const limitations = data.matching?.data_limitations ?? [];
  for (const limitation of limitations) addText(results, "p", limitation, "note");
}

function renderAttributeResponse(data, attribute) {
  results.replaceChildren();
  const label = attribute === "mineral" ? `Mineral: ${document.querySelector("#mineral").selectedOptions[0].textContent}` : attribute[0].toUpperCase() + attribute.slice(1);
  addText(results, "h2", `${bodyInput.value} · ${label} matches`);
  const features = data.features ?? [];
  const scoreKey = attribute === "mineral" ? "earth_formula_match_percentage" : `${attribute}_match_percentage`;
  renderFeatureGroup(results, "Top Earth matches", features, scoreKey, data.matching?.reason || (data.matching?.status === "not-configured" ? "Roughness estimation needs SerpAPI and Gemini keys on the backend." : "No matching records were available."));
  if (data.matching?.formula_match_method) addText(results, "p", data.matching.formula_match_method, "note");
}

async function requestResults(url) {
  results.setAttribute("aria-busy", "true");
  results.replaceChildren();
  addText(results, "h2", "Results");
  addText(results, "p", "Searching Earth datasets. This may take a little while.");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.matches?.length && modeInput.value === "location") {
      renderLocationResponse(data);
      return;
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    if (modeInput.value === "location") renderLocationResponse(data);
    else renderAttributeResponse(data, attributeInput.value);
  } catch (error) {
    results.replaceChildren();
    addText(results, "h2", "Search unavailable");
    addText(results, "p", error.message || "The planetary analog backend could not complete this request.", "error");
    addText(results, "p", "For local development, run `python -m backend.server` alongside the web app.", "note");
  } finally {
    results.setAttribute("aria-busy", "false");
  }
}

modeInput.addEventListener("change", syncFields);
attributeInput.addEventListener("change", syncFields);
syncFields();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const params = new URLSearchParams({ top: "10" });
  if (modeInput.value === "location") {
    const name = document.querySelector("#location-name").value.trim();
    if (!name) return;
    params.set("name", name);
    params.set("include_roughness", "true");
    const path = bodyInput.value === "Mars" ? "/api/mars-analogs" : "/api/earth-analogs";
    requestResults(`${path}?${params}`);
    return;
  }

  const attribute = attributeInput.value;
  params.set("body", bodyInput.value);
  params.set("attribute", attribute);
  if (attribute === "temperature") {
    params.set("value", document.querySelector("#temperature-value").value);
    params.set("unit", document.querySelector("#temperature-unit").value);
  } else if (attribute === "mineral") {
    params.set("mineral", document.querySelector("#mineral").value);
  } else {
    params.set("value", document.querySelector("#roughness-value").value);
  }
  requestResults(`/api/earth-analog-attribute?${params}`);
});
