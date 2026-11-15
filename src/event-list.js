import { WMS_URL } from './gibs.js';

function node(tag, text) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  return item;
}

function link(title, url, thumbnail) {
  if (!/^https?:\/\//i.test(url)) return document.createTextNode('');
  const a = node('a', title);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (thumbnail && /^https?:\/\//i.test(thumbnail)) {
    const img = new Image();
    img.loading = 'lazy';
    img.alt = '';
    img.src = thumbnail;
    img.onerror = () => img.remove();
    a.prepend(img);
  }
  return a;
}

function research(row, event) {
  const date = event.date.slice(0,10);
  row.append(node('p', event.category + ' · ' + date + ' UTC · ' +
    event.latitude.toFixed(2) + '°, ' + event.longitude.toFixed(2) + '°'));
  row.append(link('NASA EONET event record', 'https://eonet.gsfc.nasa.gov/api/v3/events/' + encodeURIComponent(event.id)));
  for (const source of event.sources) row.append(link(source.id, source.url));
  const box = [Math.max(-180,event.longitude-2),Math.max(-90,event.latitude-2),
    Math.min(180,event.longitude+2),Math.min(90,event.latitude+2)].join(',');
  const map = new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',srs:'EPSG:4326',
    layers:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',bbox:box,width:360,height:240,time:date,format:'image/jpeg'});
  row.append(link('NASA Worldview · satellite imagery for this location and date',
    'https://worldview.earthdata.nasa.gov/?v='+box+'&t='+date,WMS_URL+'?'+map));
  const status = node('p','Searching for reports and images…');
  row.append(status);
  fetch('/api/nasa/event-detail?id=' + encodeURIComponent(event.id)).then(async r => {
    if (!r.ok) throw new Error();
    const data = await r.json();
    status.remove();
    for (const [heading, items] of [['NASA Image Library',data.nasa],['Web reports · SerpApi',data.links],['Images · SerpApi',data.images]]) {
      if (!items.length) continue;
      row.append(node('h3',heading));
      for (const result of items) row.append(link(result.title,result.link,result.thumbnail));
    }
    if (data.searchUnavailable) row.append(node('p','Web search is currently unavailable.'));
    else if (!data.links.length && !data.images.length) row.append(node('p','No matching web reports or images.'));
  }).catch(() => { status.textContent = 'Additional reports could not be loaded.'; });
}

export function createEventList() {
  const panel = node('aside');
  panel.id = 'event-list';
  panel.hidden = true;
  panel.setAttribute('aria-label','Natural events');
  const heading = node('h2','Natural events');
  const search = node('input');
  search.type = 'search';
  search.placeholder = 'Find an event or category';
  search.setAttribute('aria-label',search.placeholder);
  const count = node('p','Loading NASA EONET events…');
  const rows = node('div');
  const prev = node('button','Previous');
  const next = node('button','Next');
  const nav = node('nav');
  nav.append(prev,next);
  panel.append(heading,search,count,rows,nav);
  document.body.append(panel);
  let all = [], matches = [], page = 0;
  const size = 35;
  function render(selected) {
    rows.replaceChildren();
    const start = page * size;
    count.textContent = matches.length ? (start + 1) + '–' + Math.min(start+size,matches.length) + ' of ' + matches.length + ' · NASA EONET' : 'No matching events';
    prev.disabled = page === 0;
    next.disabled = start + size >= matches.length;
    for (const event of matches.slice(start,start+size)) {
      const row = node('details');
      row.append(node('summary',event.title));
      let loaded = false;
      row.ontoggle = () => {
        if (row.open && !loaded) { loaded = true; research(row,event); }
      };
      rows.append(row);
      if (event.id === selected) { row.open = true; row.scrollIntoView({block:'nearest'}); }
    }
  }
  search.oninput = () => {
    const term = search.value.trim().toLowerCase();
    matches = all.filter(e => (e.title+' '+e.category).toLowerCase().includes(term));
    page = 0; render();
  };
  prev.onclick = () => { page--; render(); panel.scrollTop = 0; };
  next.onclick = () => { page++; render(); panel.scrollTop = 0; };
  return {
    visible(show) { panel.hidden = !show; },
    message(text) { count.textContent = text; },
    populate(events) { all = events.sort((a,b) => b.date.localeCompare(a.date)); search.oninput(); },
    open(id) {
      const index = all.findIndex(e => e.id === id);
      if (index < 0) return;
      panel.hidden = false; search.value = ''; matches = all; page = Math.floor(index/size); render(id);
    }
  };
}
