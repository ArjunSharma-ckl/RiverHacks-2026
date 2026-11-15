import { catalogControls } from './catalog-search.js';

// Satellite catalogue and briefing. Lives in the right-hand rail rather than
// the control sidebar, and pairs the CelesTrak orbital facts with a SerpApi
// web and image report for the selected object.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(href, text) {
  const link = element('a', undefined, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function serpBrand(enabled) {
  const credit = element('div', 'serpapi-credit');
  const mark = new Image();
  mark.src = '/serpapi-logo.svg';
  mark.alt = 'SerpApi';
  credit.append(mark, element('span', undefined,
    enabled ? 'Web reports and images powered by SerpApi' : 'Add SERPAPI_KEY for web reports and images'));
  const link = externalLink('https://serpapi.com/', 'serpapi.com');
  link.className = 'serpapi-link';
  credit.append(link);
  return credit;
}

function factList(rows) {
  const list = element('dl', 'dot-facts');
  for (const [key, value] of rows) {
    if (value === undefined || value === null || value === '') continue;
    list.append(element('dt', undefined, key), element('dd', undefined, value));
  }
  return list;
}

function linkList(links) {
  if (!links?.length) return document.createDocumentFragment();
  const fragment = document.createDocumentFragment();
  fragment.append(element('h4', undefined, 'Web reports · SerpApi'));
  const list = element('ul', 'dot-links');
  for (const item of links) {
    if (!/^https:\/\//.test(item.link || '')) continue;
    const entry = element('li');
    entry.append(externalLink(item.link, item.title || item.link));
    if (item.snippet) entry.append(element('small', undefined, item.snippet.slice(0, 150)));
    list.append(entry);
  }
  fragment.append(list);
  return fragment;
}

function imageGrid(images, caption) {
  if (!images?.length) return document.createDocumentFragment();
  const fragment = document.createDocumentFragment();
  fragment.append(element('h4', undefined, caption));
  const grid = element('div', 'dot-grid');
  for (const image of images) {
    const src = image.src || image.thumbnail;
    if (!/^https:\/\//.test(src || '')) continue;
    const link = externalLink(image.link || src, '');
    const img = new Image();
    img.loading = 'lazy';
    img.alt = image.title || caption;
    img.src = src;
    img.onerror = () => link.remove();
    link.append(img);
    grid.append(link);
  }
  fragment.append(grid);
  return fragment;
}

export function createSatellitePanel({ viewer, satellites, onChoose }) {
  const root = element('div', 'sat-panel');

  const selector = document.createElement('select');
  selector.setAttribute('aria-label', 'Track a satellite');
  selector.add(new Option('Earth overview', ''));
  for (const entity of satellites.entities) selector.add(new Option(entity.name, entity.id));
  selector.onchange = () => {
    const target = viewer.entities.getById(selector.value);
    if (target) target.show = true;
    satellites.track(target);
  };
  viewer.trackedEntityChanged.addEventListener(entity => { selector.value = entity?.id || ''; });

  const briefing = element('div', 'sat-briefing');
  briefing.hidden = true;
  let token = 0;
  let current;

  function renderFacts(contact) {
    return factList([
      ['Mission', contact.job],
      ['NORAD', contact.norad],
      ['Altitude', Number.isFinite(contact.alt) ? `${contact.alt.toFixed(0)} km` : ''],
      ['Orbital speed', contact.speed ? `${contact.speed.toFixed(2)} km/s` : ''],
      ['Ground position', Number.isFinite(contact.lat)
        ? `${contact.lat.toFixed(2)}°, ${contact.lon.toFixed(2)}°`
        : '']
    ]);
  }

  async function loadBriefing(contact) {
    const request = ++token;
    briefing.replaceChildren(
      element('h3', undefined, contact.name),
      renderFacts(contact),
      element('p', 'rail-loading', 'Querying SerpApi and the NASA Image Library…')
    );
    const query = new URLSearchParams({
      name: contact.name,
      norad: contact.norad ?? '',
      job: contact.job ?? '',
      alt: Number.isFinite(contact.alt) ? contact.alt.toFixed(0) : '',
      speed: Number.isFinite(contact.speed) ? contact.speed.toFixed(2) : '',
      lat: Number.isFinite(contact.lat) ? contact.lat.toFixed(2) : '',
      lon: Number.isFinite(contact.lon) ? contact.lon.toFixed(2) : ''
    });
    try {
      const response = await fetch('/api/nasa/satellite?' + query);
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (request !== token) return;
      const body = element('div', 'dot-detail');
      body.append(element('p', 'dot-text', data.summary));
      if (data.webSummary) body.append(element('p', 'dot-text web', data.webSummary));
      body.append(renderFacts(contact));
      body.append(linkList(data.links));
      body.append(imageGrid((data.images ?? []).filter((image) => image.source === 'NASA'), 'NASA Image Library'));
      body.append(imageGrid((data.images ?? []).filter((image) => image.source !== 'NASA'), 'Imagery · SerpApi'));
      body.append(serpBrand(data.serpapi?.enabled));
      briefing.replaceChildren(body);
    } catch {
      if (request !== token) return;
      briefing.replaceChildren(
        element('h3', undefined, contact.name),
        renderFacts(contact),
        element('p', 'rail-empty', 'The SerpApi report did not come back. Orbital data above is from CelesTrak.')
      );
    }
  }

  root.append(selector);
  catalogControls(root, satellites, (contact) => {
    current = contact;
    briefing.hidden = false;
    loadBriefing(contact);
    onChoose?.(contact);
  });
  root.append(briefing);

  return {
    root,
    show(contact) {
      current = contact;
      briefing.hidden = false;
      loadBriefing(contact);
    },
    current: () => current
  };
}
