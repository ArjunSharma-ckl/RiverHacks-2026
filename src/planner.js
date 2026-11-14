import './planner.css';
import { estimateImageRelief, ReliefInputError } from './image-depth.js';
import { compareTerrain } from './terrain-compare.js';
import { loadEarthCatalog, loadTerrainGrid, validateTerrainGrid } from './terrain-data.js';
import { createTerrainPreview } from './terrain-preview.js';

const examples = {
  shackleton: 'Shackleton crater area, Moon · LOLA',
  haworth: 'Haworth crater area, Moon · LOLA',
  jezero: 'Jezero western delta, Mars · MOLA',
};
const sitesWithContextPhotos = new Set([
  'askja', 'atacama', 'death-valley', 'kilauea', 'lava-beds',
  'pilot-valley', 'salda', 'verde-valley', 'vikursundar',
]);

const form = document.querySelector('form');
const input = document.querySelector('#render');
const example = document.querySelector('#example');
const preview = document.querySelector('#preview');
const overhead = document.querySelector('#overhead');
const imageOnly = document.querySelector('#image-only');
const result = document.querySelector('#result');
const comparison = document.querySelector('#comparison');
const controls = [...form.querySelectorAll('input, select, button')];
let uploadUrl;

for (const [id, name] of Object.entries(examples)) example.add(new Option(name, id));

function clearResult() {
  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = undefined;
  preview.hidden = true;
  preview.removeAttribute('src');
  overhead.checked = false;
  imageOnly.hidden = true;
  result.textContent = '';
  delete result.dataset.status;
  comparison.hidden = true;
  comparison.replaceChildren();
}

input.addEventListener('change', () => {
  example.value = '';
  clearResult();
  const file = input.files[0];
  if (file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 20 * 1024 ** 2) {
    uploadUrl = URL.createObjectURL(file);
    preview.src = uploadUrl;
    preview.hidden = false;
    imageOnly.hidden = false;
  }
});

example.addEventListener('change', () => {
  input.value = '';
  clearResult();
});

function element(tag, text, container) {
  const node = document.createElement(tag);
  node.textContent = text;
  container.append(node);
  return node;
}

function showComparison(query, outcome, relativeDepth) {
  comparison.hidden = false;
  if (!outcome.candidates.length) return;
  const shortlist = outcome.candidates.slice(0, 3);
  const label = element('label', 'Inspect an Earth candidate ', comparison);
  const options = element('select', '', label);
  for (const [index, candidate] of shortlist.entries()) {
    options.add(new Option(candidate.site.name, String(index)));
  }
  const views = element('div', '', comparison);
  views.className = 'terrain-views';
  createTerrainPreview(element('div', '', views), query,
    relativeDepth ? 'Your inferred relief' : 'Measured target elevation');
  if (query.source) {
    const citation = element('a', query.attribution ?? 'Target elevation source', comparison);
    if (/^https:\/\//.test(query.source)) citation.href = query.source;
  }
  const earthView = element('div', '', views);
  const photo = element('figure', '', comparison);
  const photoImage = element('img', '', photo);
  element('figcaption', 'NASA gallery field photo of the wider Earth analog area', photo);
  const attribution = element('p', '', comparison);
  const evidence = element('ul', '', comparison);
  const distance = element('p', '', comparison);
  const link = element('a', '', comparison);
  const formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  function updateCandidate() {
    const candidate = shortlist[options.selectedIndex];
    const { site } = candidate;
    createTerrainPreview(earthView, site, 'Measured Earth elevation');
    photo.hidden = !sitesWithContextPhotos.has(site.id);
    if (!photo.hidden) {
      photoImage.src = '/analogs/' + site.id + '-earth.webp';
      photoImage.alt = 'NASA gallery view of ' + site.name;
    } else {
      photoImage.removeAttribute('src');
    }
    attribution.textContent = site.attribution;
    evidence.replaceChildren();
    for (const row of candidate.differences) {
      element('li', row.label + ' · Target ' + formatter.format(row.query) + ' / Earth ' +
        formatter.format(row.reference) + ' ' + row.unit, evidence);
    }
    distance.textContent = 'Terrain distance ' + candidate.distance.toFixed(3) +
      ' · Compared at ' + candidate.sampleSize + ' × ' + candidate.sampleSize +
      ' samples. Smaller distances indicate closer terrain measurements.';
    link.textContent = outcome.best === candidate ? 'Open matched site on globe' : 'Inspect candidate on globe';
    link.href = '/?' + new URLSearchParams({ terrain: site.id });
  }
  options.addEventListener('change', updateCandidate);
  updateCandidate();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const file = input.files[0];
  if (!file && !example.value) {
    result.textContent = 'Choose an elevation example or upload terrain.';
    return;
  }
  const relativeDepth = Boolean(file && !file.name.toLowerCase().endsWith('.json'));
  if (file?.size > 20 * 1024 ** 2 || (relativeDepth && !uploadUrl)) {
    result.textContent = 'Choose JSON, JPEG, PNG, or WebP under 20 MB.';
    return;
  }
  if (relativeDepth && !overhead.checked) {
    result.textContent = 'Confirm the image looks straight down at terrain, or use an elevation grid.';
    return;
  }

  controls.forEach(control => { control.disabled = true; });
  comparison.hidden = true;
  comparison.replaceChildren();
  result.dataset.status = 'loading';
  result.textContent = 'Loading terrain data…';
  try {
    const catalog = await loadEarthCatalog();
    const query = relativeDepth
      ? await estimateImageRelief(uploadUrl, message => { result.textContent = message; })
      : validateTerrainGrid(file ? JSON.parse(await file.text())
        : await loadTerrainGrid('/analogs/planetary/' + example.value + '.json'));
    const outcome = compareTerrain(query, catalog.candidates, { relativeDepth });
    result.dataset.status = outcome.status;
    result.textContent = outcome.status === 'match'
      ? 'Terrain candidate found. ' + outcome.reason
      : 'No suitable match found. ' + outcome.reason;
    showComparison(query, outcome, relativeDepth);
  } catch (error) {
    console.error(error);
    result.dataset.status = error instanceof ReliefInputError ? 'no_match' : 'error';
    result.textContent = error instanceof ReliefInputError ? 'No suitable match found. ' + error.message
      : relativeDepth ? 'Terrain analysis failed. Check your connection and try another image.'
        : 'Could not compare this elevation grid. ' + error.message;
  } finally {
    controls.forEach(control => { control.disabled = false; });
  }
});
