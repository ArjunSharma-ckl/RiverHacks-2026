import { EVENT_COLORS, pin } from './weather.js';
import { LAYER_LEGENDS } from './legends.js';

// The right-hand rail holds the list experiences: every EONET event, every
// thermal dot on the globe and the colour key for whatever gradient layer is
// switched on. Rows expand in place and pull a NASA + SerpApi briefing.

const eventCache = new Map();
const hotspotCache = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ago(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function externalLink(href, text) {
  const link = element('a', undefined, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function serpBrand(enabled = true) {
  const credit = element('div', 'serpapi-credit');
  const mark = new Image();
  mark.src = '/serpapi-logo.svg';
  mark.alt = 'SerpApi';
  credit.append(mark, element('span', undefined,
    enabled ? 'Links and imagery powered by SerpApi' : 'Add SERPAPI_KEY to enrich this card'));
  const link = externalLink('https://serpapi.com/', 'serpapi.com');
  link.className = 'serpapi-link';
  credit.append(link);
  return credit;
}

function factList(rows = []) {
  const list = element('dl', 'dot-facts');
  for (const [key, value] of rows) {
    if (!value) continue;
    list.append(element('dt', undefined, key), element('dd', undefined, value));
  }
  return list;
}

function imageGrid(images = [], caption) {
  const wrap = document.createDocumentFragment();
  if (!images.length) return wrap;
  wrap.append(element('h4', undefined, caption));
  const grid = element('div', 'dot-grid');
  for (const image of images) {
    const src = image.src || image.thumbnail;
    if (!/^https:\/\//.test(src || '')) continue;
    const link = externalLink(image.link || src, '');
    const img = new Image();
    img.loading = 'lazy';
    img.alt = image.title || caption;
    img.title = image.source ? `${image.source} · ${image.title || ''}` : image.title || '';
    img.src = src;
    img.onerror = () => link.remove();
    link.append(img);
    grid.append(link);
  }
  wrap.append(grid);
  return wrap;
}

function linkList(links = [], caption) {
  const wrap = document.createDocumentFragment();
  if (!links.length) return wrap;
  wrap.append(element('h4', undefined, caption));
  const list = element('ul', 'dot-links');
  for (const item of links) {
    if (!/^https:\/\//.test(item.link || '')) continue;
    const entry = element('li');
    entry.append(externalLink(item.link, item.title || host(item.link)));
    if (item.snippet) entry.append(element('small', undefined, item.snippet.slice(0, 150)));
    list.append(entry);
  }
  wrap.append(list);
  return wrap;
}

function renderEventDetail(data) {
  const wrap = element('div', 'dot-detail');
  wrap.append(element('p', 'dot-text', data.summary));
  if (data.webSummary) wrap.append(element('p', 'dot-text web', data.webSummary));
  wrap.append(factList(data.facts));
  wrap.append(linkList(data.links, 'Links · SerpApi'));
  const nasaPhotos = (data.images ?? []).filter((image) => image.source === 'NASA');
  const serpImages = (data.images ?? []).filter((image) => image.source !== 'NASA');
  wrap.append(imageGrid(nasaPhotos, 'NASA Image Library'));
  wrap.append(imageGrid(serpImages, 'Imagery · SerpApi'));
  if (data.sources?.length) {
    const sources = element('p', 'dot-sources');
    sources.append(element('span', undefined, 'Agency sources: '));
    for (const source of data.sources) {
      sources.append(externalLink(source.url, source.id), document.createTextNode(' '));
    }
    wrap.append(sources);
  }
  wrap.append(serpBrand(data.serpapi?.enabled));
  return wrap;
}

function renderHotspotDetail(data) {
  const wrap = element('div', 'dot-detail');
  wrap.append(element('p', 'dot-text', data.summary));
  if (data.webSummary) wrap.append(element('p', 'dot-text web', data.webSummary));
  wrap.append(factList(data.facts));
  wrap.append(linkList(data.links, 'Links · SerpApi'));
  wrap.append(imageGrid((data.images ?? []).filter((image) => image.source === 'NASA'), 'NASA Image Library'));
  wrap.append(imageGrid((data.images ?? []).filter((image) => image.source !== 'NASA'), 'Imagery · SerpApi'));
  wrap.append(serpBrand(data.serpapi?.enabled));
  return wrap;
}

export function createRail(root, { onSelectEvent, onSelectDot } = {}) {
  if (!root) return { setEvents() {}, setHotspots() {}, setLayers() {}, highlight() {}, selectEvent() {}, selectHotspot() {} };

  const rows = { event: new Map(), thermal: new Map() };
  const panels = {};

  function makePanel(key, title, meta) {
    const section = element('section', 'rail-panel');
    section.dataset.panel = key;
    const head = element('button', 'rail-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'true');
    head.append(element('span', 'rail-title', title), element('span', 'rail-meta', meta));
    const body = element('div', 'rail-body');
    head.onclick = () => {
      const collapsed = section.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    };
    section.append(head, body);
    root.append(section);
    const panel = { section, body, head, meta: head.querySelector('.rail-meta') };
    panels[key] = panel;
    return panel;
  }

  const satellitePanel = makePanel('satellites', 'Satellites', 'CelesTrak · SerpApi');
  const events = makePanel('events', 'Natural events', 'NASA EONET');
  const thermal = makePanel('thermal', 'Thermal anomalies', 'NASA FIRMS');
  const legend = makePanel('legend', 'Map key', 'Enabled layers');
  legend.section.hidden = true;

  function open(key) {
    panels[key]?.section.classList.remove('collapsed');
  }

  async function loadEvent(row, body, event) {
    body.replaceChildren(element('p', 'rail-loading', 'Querying NASA EONET and SerpApi…'));
    try {
      let data = eventCache.get(event.id);
      if (!data) {
        const response = await fetch(`/api/nasa/event?id=${encodeURIComponent(event.id)}`);
        if (!response.ok) throw new Error('unavailable');
        data = await response.json();
        eventCache.set(event.id, data);
      }
      if (!row.open) return;
      body.replaceChildren(renderEventDetail(data));
    } catch {
      if (row.open) body.replaceChildren(element('p', 'rail-empty',
        'No briefing came back. NASA EONET or SerpApi did not answer for this event.'));
    }
  }

  function eventRow(event) {
    const row = element('details', 'dot-row');
    row.dataset.id = event.id;
    const summary = element('summary', 'dot-summary');
    const icon = new Image();
    icon.className = 'dot-icon';
    icon.alt = '';
    icon.src = pin(EVENT_COLORS[event.category] ?? '#9aa7b8', event.category);
    const label = element('span', 'dot-label');
    label.append(
      element('b', undefined, event.title),
      element('small', undefined, `${event.category} · ${ago(event.date)}`)
    );
    summary.append(icon, label);
    const body = element('div', 'dot-body');
    row.append(summary, body);

    summary.addEventListener('click', () => onSelectEvent?.(event));
    row.addEventListener('toggle', () => {
      if (!row.open) return;
      if (row.dataset.loaded) return;
      row.dataset.loaded = '1';
      loadEvent(row, body, event);
    });
    rows.event.set(event.id, row);
    return row;
  }

  async function loadHotspot(row, body, dot) {
    body.replaceChildren(element('p', 'rail-loading', 'Querying NASA data and SerpApi…'));
    try {
      let data = hotspotCache.get(dot.key);
      if (!data) {
        const query = new URLSearchParams({
          lat: dot.latitude.toFixed(4),
          lon: dot.longitude.toFixed(4),
          q: dot.title.slice(0, 110),
          src: dot.source ?? '',
          frp: dot.frp ? String(Math.round(dot.frp)) : ''
        });
        const response = await fetch('/api/nasa/hotspot?' + query);
        if (!response.ok) throw new Error('unavailable');
        data = await response.json();
        hotspotCache.set(dot.key, data);
      }
      if (!row.open) return;
      body.replaceChildren(renderHotspotDetail(data));
    } catch {
      if (row.open) body.replaceChildren(element('p', 'rail-empty',
        'No briefing came back for this detection. NASA or SerpApi did not answer.'));
    }
  }

  function hotspotRow(dot) {
    const row = element('details', 'dot-row');
    row.dataset.id = dot.key;
    const summary = element('summary', 'dot-summary');
    const icon = element('span', 'dot-icon heat');
    icon.setAttribute('aria-hidden', 'true');
    const label = element('span', 'dot-label');
    label.append(
      element('b', undefined, dot.title),
      element('small', undefined, `${dot.latitude.toFixed(2)}°, ${dot.longitude.toFixed(2)}° · ${ago(dot.date)}`)
    );
    summary.append(icon, label);
    const body = element('div', 'dot-body');
    row.append(summary, body);
    summary.addEventListener('click', () => onSelectDot?.(dot));
    row.addEventListener('toggle', () => {
      if (!row.open || row.dataset.loaded) return;
      row.dataset.loaded = '1';
      loadHotspot(row, body, dot);
    });
    rows.thermal.set(dot.key, row);
    return row;
  }

  function setEvents(list = []) {
    events.meta.textContent = `NASA EONET · ${list.length}`;
    events.body.replaceChildren();
    rows.event.clear();
    if (!list.length) {
      events.body.append(element('p', 'rail-empty', 'No open events reported in the last 45 days.'));
      return;
    }
    for (const event of list) events.body.append(eventRow(event));
  }

  let hotspotList = [];
  const HOTSPOT_PAGE = 80;
  function renderHotspots(limit = HOTSPOT_PAGE) {
    thermal.body.replaceChildren();
    for (const dot of hotspotList.slice(0, limit)) thermal.body.append(hotspotRow(dot));
    if (hotspotList.length > limit) {
      const more = element('button', 'rail-more', `Show ${Math.min(HOTSPOT_PAGE, hotspotList.length - limit)} more detections`);
      more.type = 'button';
      more.onclick = () => renderHotspots(limit + HOTSPOT_PAGE);
      thermal.body.append(more);
    }
  }

  function setHotspots(list = []) {
    hotspotList = list;
    const detections = list.filter((dot) => dot.source === 'NASA FIRMS').length;
    thermal.meta.textContent = detections
      ? `NASA FIRMS · ${list.length}`
      : `NASA EONET · ${list.length}`;
    renderHotspots();
    if (!list.length) {
      thermal.body.append(element('p', 'rail-empty',
        'No thermal detections returned. Wildfire events appear here while NASA EONET reports them.'));
    }
  }

  function legendCard(spec) {
    const card = element('div', 'legend');
    card.append(element('strong', undefined, spec.title));
    if (spec.unit) card.append(element('small', 'legend-unit', spec.unit));
    if (spec.stops) {
      const bar = element('div', 'legend-bar');
      bar.style.background = `linear-gradient(90deg, ${spec.stops.join(', ')})`;
      card.append(bar);
      if (spec.ticks) {
        const ticks = element('div', 'legend-ticks');
        for (const tick of spec.ticks) ticks.append(element('span', undefined, tick));
        card.append(ticks);
      }
    }
    if (spec.items) {
      const chips = element('div', 'legend-chips');
      for (const [label, colour] of spec.items) {
        const chip = element('span', 'legend-chip');
        const swatch = element('i');
        swatch.style.background = colour;
        chip.append(swatch, document.createTextNode(label));
        chips.append(chip);
      }
      card.append(chips);
    }
    if (spec.note) card.append(element('p', 'legend-note', spec.note));
    return card;
  }

  function setLayers(ids = []) {
    const specs = ids.map((id) => LAYER_LEGENDS[id]).filter(Boolean);
    if (!specs.length) {
      legend.section.hidden = true;
      return;
    }
    legend.section.hidden = false;
    legend.meta.textContent = `${specs.length} active`;
    legend.body.replaceChildren(...specs.map(legendCard));
    legend.body.append(element('p', 'legend-foot', 'Keys follow each NASA GIBS product’s published scale.'));
  }

  let lastHighlight = '';
  function highlight(kind, id) {
    const key = `${kind}:${id}`;
    if (key === lastHighlight) return;
    lastHighlight = key;
    for (const entries of Object.values(rows)) {
      for (const row of entries.values()) row.classList.remove('hover');
    }
    const row = rows[kind]?.get(id);
    if (!row) return;
    open(kind === 'thermal' ? 'thermal' : 'events');
    row.classList.add('hover');
    row.scrollIntoView({ block: 'nearest' });
  }

  function selectEvent(event) {
    highlight('event', event.id);
    const row = rows.event.get(event.id);
    if (row) {
      row.open = true;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function selectHotspot(dot) {
    highlight('thermal', dot.key);
    const row = rows.thermal.get(dot.key);
    if (row) {
      row.open = true;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  return {
    setEvents,
    setHotspots,
    setLayers,
    highlight,
    selectEvent,
    selectHotspot,
    panel: (key) => panels[key]
  };
}
