import { WMS_URL } from './gibs.js';
import { serpBadge } from './serp-badge.js';

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
  let endpoint;
  if (event.sky) {
    row.append(node('p',event.description()), link('Search the NASA Image Library', 'https://images.nasa.gov/search?q='+encodeURIComponent(event.title)));
    endpoint = '/api/nasa/point-detail?' + new URLSearchParams({kind:event.category,name:event.title});
  } else {
  const date = event.date.slice(0,10);
  row.append(node('p', event.category + ' · ' + date + ' UTC · ' +
    event.latitude.toFixed(2) + '°, ' + event.longitude.toFixed(2) + '°'));
  if (!event.fire) row.append(link('NASA EONET event record', 'https://eonet.gsfc.nasa.gov/api/v3/events/' + encodeURIComponent(event.id)));
  for (const source of event.sources) row.append(link(source.id, source.url));
  const box = [Math.max(-180,event.longitude-2),Math.max(-90,event.latitude-2),
    Math.min(180,event.longitude+2),Math.min(90,event.latitude+2)].join(',');
  const map = new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',srs:'EPSG:4326',
    layers:'VIIRS_NOAA20_CorrectedReflectance_TrueColor',bbox:box,width:360,height:240,time:date,format:'image/jpeg'});
  row.append(link('NASA Worldview · satellite imagery for this location and date',
    'https://worldview.earthdata.nasa.gov/?v='+box+'&t='+date,WMS_URL+'?'+map));
    if (event.fire) {
      row.append(node('p','NASA FIRMS · NOAA-20 VIIRS · '+event.date.slice(11,16)+' UTC · Brightness '+event.brightness+' K · Radiative power '+event.power+' MW · Confidence '+event.confidence));
      endpoint = '/api/nasa/point-detail?' + new URLSearchParams({kind:'fires',lat:event.latitude,lon:event.longitude,date});
    } else endpoint = '/api/nasa/event-detail?id=' + encodeURIComponent(event.id);
  }
  const status = node('p','Searching NASA imagery and using SerpApi for web reports and images…');
  row.append(status);
  fetch(endpoint).then(async r => {
    if (!r.ok) throw new Error();
    const data = await r.json();
    status.remove();
    // Dated headlines first: for a storm or a fire burning right now, this is
    // the part of the record that is actually moving.
    if (data.news?.length) {
      const head = node('h3','Live coverage');
      head.append(serpBadge('Google News'));
      row.append(head);
      for (const story of data.news) {
        const item = link(story.title, story.link, story.thumbnail);
        row.append(item);
        const meta = [story.source, story.date].filter(Boolean).join(' · ');
        if (meta) row.append(node('small', meta));
      }
    }
    for (const [heading, items] of [[event.fire ? 'NASA Image Library · VIIRS background' : 'NASA Image Library',data.nasa],['Web reports · SerpApi',data.links],['Images · SerpApi',data.images]]) {
      if (!items.length) continue;
      row.append(node('h3',heading));
      for (const result of items) row.append(link(result.title,result.link,result.thumbnail));
    }
    if (data.searchUnavailable) row.append(node('p','SerpApi search is currently unavailable.'));
    else if (!data.links.length && !data.images.length && !data.news?.length) row.append(node('p','No matching web reports or images.'));
  }).catch(() => { status.textContent = 'Additional reports could not be loaded.'; });
}

export function createEventList() {
  const panel = node('aside');
  panel.id = 'event-list';
  panel.hidden = true;
  panel.setAttribute('aria-label','Map points');
  const heading = node('h2','Natural events');
  const groups = new Map();
  const select = node('select');
  select.setAttribute('aria-label','Point layer');
  const fold = node('button','Hide list');
  fold.type = 'button';
  function collapse(on) {
    panel.classList.toggle('folded',on);
    fold.textContent = on ? 'Show map points' : 'Hide list';
    fold.setAttribute('aria-expanded',String(!on));
  }
  fold.onclick = () => collapse(!panel.classList.contains('folded'));
  const search = node('input');
  search.type = 'search';
  search.placeholder = 'Find a point by name or location';
  search.setAttribute('aria-label',search.placeholder);
  const count = node('p','Loading NASA EONET events…');
  const rows = node('div');
  const prev = node('button','Previous');
  const next = node('button','Next');
  const nav = node('nav');
  nav.append(prev,next);
  const attribution = node('small','Web, news and image search use SerpApi. NASA sources are listed separately.');
  attribution.prepend(serpBadge('Search'), document.createElement('br'));
  panel.append(fold,heading,select,attribution,search,count,rows,nav);
  document.body.append(panel);
  let all = [], matches = [], page = 0;
  const size = 35;
  function render(selected) {
    rows.replaceChildren();
    const start = page * size;
    count.textContent = matches.length ? (start + 1) + '–' + Math.min(start+size,matches.length) + ' of ' + matches.length : (groups.get(select.value)?.message || 'No matching points');
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
  function activate(group) {
    select.value = group;
    heading.textContent = group;
    all = groups.get(group)?.items || [];
    search.value = '';
    search.oninput();
  }
  select.onchange = () => activate(select.value);
  function visible(show, group = 'Natural events') {
    if (show) {
      collapse(false);
      if (!groups.has(group)) {
        groups.set(group,{items:[],message:'Loading…'});
        select.add(new Option(group,group));
      }
      activate(group);
    } else {
      const current = select.value;
      groups.delete(group);
      for (const option of [...select.options]) if (option.value === group) option.remove();
      if (group === current && select.options.length) activate(select.options[0].value);
    }
    panel.hidden = !groups.size;
  }
  return {
    visible,
    message(text,group='Natural events') {
      if (groups.has(group)) groups.get(group).message = text;
      if (select.value === group) count.textContent = text;
    },
    populate(items,group='Natural events') {
      if (!groups.has(group)) return;
      groups.set(group,{items,message:''});
      if (select.value === group) activate(group);
    },
    open(id,group='Natural events') {
      if (!groups.has(group)) return;
      collapse(false);
      activate(group);
      const index = all.findIndex(e => e.id === id);
      if (index < 0) return;
      page = Math.floor(index/size); render(id);
    }
  };
}
