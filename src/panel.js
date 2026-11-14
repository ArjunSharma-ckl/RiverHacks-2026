import { describe } from './catalog.js';
import { surfaceWeather, spaceWeather } from './weather.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPanel(root) {
  const close = element('button', 'close', '×');
  close.setAttribute('aria-label', 'Close details');
  const title = element('h2');
  const subtitle = element('p', 'subtitle');
  const body = element('p', 'body');
  const extra = element('div', 'extra');
  const gallery = element('div', 'gallery');
  root.append(close, title, subtitle, body, extra, gallery);

  let token = 0;
  function hide() {
    root.hidden = true;
    token += 1;
  }
  close.onclick = hide;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });

  function reset(name, sub) {
    const current = ++token;
    root.hidden = false;
    root.scrollTop = 0;
    title.textContent = name;
    subtitle.textContent = sub ?? '';
    body.textContent = describe(name);
    extra.replaceChildren();
    gallery.replaceChildren();
    return current;
  }

  function definitionList(rows) {
    const list = element('dl');
    for (const [key, value] of rows) {
      list.append(element('dt', undefined, key), element('dd', undefined, value));
    }
    return list;
  }

  function externalLink(href, text) {
    const link = element('a', undefined, text);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  async function loadImagery(query, current) {
    try {
      const response = await fetch(`/api/nasa/images?name=${encodeURIComponent(query)}`);
      if (!response.ok) return;
      const { photos = [] } = await response.json();
      if (current !== token || photos.length === 0) return;
      gallery.append(element('p', 'caption', 'NASA Image and Video Library'));
      const grid = element('div', 'grid');
      for (const photo of photos) {
        const link = externalLink(photo.link, '');
        const image = new Image();
        image.src = photo.thumbnail;
        image.alt = photo.title ?? query;
        image.loading = 'lazy';
        link.append(image);
        grid.append(link);
      }
      gallery.append(grid);
    } catch {
      // Imagery is a bonus; the panel still works without it.
    }
  }

  async function loadArticle(name, current) {
    try {
      const response = await fetch(`/api/object?name=${encodeURIComponent(name)}`);
      if (!response.ok) return;
      const { articles, photos } = await response.json();
      if (current !== token) return;
      if (articles.length) extra.append(element('h3',undefined,'Further reading'));
      for (const item of articles) {
        const card = element('section','source-card');
        card.append(element('small',undefined,new URL(item.link).hostname), externalLink(item.link,item.title), element('p',undefined,item.snippet));
        extra.append(card);
      }
      if (photos.length) gallery.append(element('h3',undefined,'Image archive'));
      const grid = element('div','grid');
      for (const photo of photos) {
        const link = externalLink(photo.link,'');
        const img = new Image();
        img.loading = 'lazy'; img.alt = photo.title; img.src = photo.thumbnail;
        img.onerror = () => img.remove();
        link.append(img,element('span',undefined,photo.title));
        grid.append(link);
      }
      gallery.append(grid);
    } catch {
      // Web search is optional and needs a SERPAPI_KEY.
    }
  }

  async function showEarthWeather(location, current) {
    extra.append(element('h3', undefined, 'Surface weather at this point'));
    const status = element('p', 'muted', 'Querying NASA POWER…');
    extra.append(status);
    try {
      const data = await surfaceWeather(location.latitude, location.longitude);
      if (current !== token) return;
      status.remove();
      extra.append(element('p', 'muted',
        `${data.latitude.toFixed(2)}°, ${data.longitude.toFixed(2)}° · ${data.date}`));
      extra.append(definitionList(data.values.map((value) => [value.label, `${value.value} ${value.unit}`])));
    } catch {
      if (current === token) status.textContent = 'NASA POWER did not answer for this point.';
    }
  }

  async function showSpaceWeather(current) {
    extra.append(element('h3', undefined, 'Space weather, last 7 days'));
    const status = element('p', 'muted', 'Querying NASA DONKI…');
    extra.append(status);
    try {
      const data = await spaceWeather();
      if (current !== token) return;
      status.remove();
      if (!data.items?.length) {
        extra.append(element('p', 'muted', 'No flares, CMEs or geomagnetic storms reported.'));
        return;
      }
      extra.append(definitionList(data.items.map((item) => [item.label, item.detail])));
    } catch {
      if (current === token) status.textContent = 'NASA DONKI needs a NASA_API_KEY to answer.';
    }
  }

  function show(name, options = {}) {
    const current = reset(name, options.subtitle);

    loadArticle(name, current);
    if (name === 'Earth' && options.location) showEarthWeather(options.location, current);
    if (name === 'Sun') showSpaceWeather(current);
  }

  function showEvent(event) {
    const current = reset(event.title, `${event.category} · NASA EONET`);
    body.textContent = 'An open natural event from NASA’s Earth Observatory Natural Event Tracker.';
    extra.append(definitionList([
      ['Category', event.category],
      ['Reported', new Date(event.date).toUTCString()],
      ['Position', `${event.latitude.toFixed(2)}°, ${event.longitude.toFixed(2)}°`]
    ]));
    if (event.sources?.length) {
      const sources = element('p', 'sources');
      for (const source of event.sources) {
        sources.append(externalLink(source.url, source.id), document.createTextNode(' '));
      }
      extra.append(sources);
    }
    loadImagery(event.category, current);
  }

  return { show, showEvent, hide, showContact(contact) {
    const current = reset(contact.name, 'Satellite tracking');
    loadArticle(contact.name,current);
    if (contact.speed) extra.append(definitionList([
      ['Mission',contact.job],['Ground position',contact.lat.toFixed(2)+'°, '+contact.lon.toFixed(2)+'°'],
      ['Altitude',contact.alt.toFixed(0)+' km'],['Orbital speed',contact.speed.toFixed(2)+' km/s']
    ]));
    body.textContent = 'NORAD ' + contact.norad + ' · Position propagated from CelesTrak orbital elements.';
  } };
}
