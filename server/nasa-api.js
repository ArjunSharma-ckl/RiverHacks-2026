import { research } from './analog-api.js';
import { report } from './reports.js';
// One API surface, used by the Vite dev/preview middleware and by the
// production Node server. Keys stay on the server; the browser only ever
// talks to /api/*.
import { SUBJECTS } from '../src/catalog.js';

const MINUTE = 60000;
const DAY = 86400000;
const cache = new Map();

async function cached(key, ttl, factory) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await factory();
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

function coordinate(geometry) {
  if (!geometry) return undefined;
  const { type, coordinates } = geometry;
  if (type === 'Point') return coordinates;
  if (type === 'Polygon') {
    const ring = coordinates?.[0] ?? [];
    if (ring.length === 0) return undefined;
    const sum = ring.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return undefined;
}

function number(params, key, min, max) {
  const value = Number(params.get(key));
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`bad ${key}`);
  return value;
}

function searchTerm(params) {
  const raw = (params.get('name') ?? '').slice(0, 60);
  if (!/^[\w .'()—-]+$/.test(raw)) throw new Error('bad name');
  return raw;
}

async function reverseGeocode(latitude, longitude) {
  try {
    const query = new URLSearchParams({
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      localityLanguage: 'en'
    });
    const data = await getJson('https://api.bigdatacloud.net/data/reverse-geocode-client?' + query);
    const locality = data.city || data.locality || data.principalSubdivision || '';
    const region = [data.principalSubdivision, data.countryName].filter(Boolean).join(', ');
    return {
      locality,
      region,
      country: data.countryName || '',
      label: locality || `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`
    };
  } catch {
    try {
      const photon = await getJson(
        `https://photon.komoot.io/reverse?lat=${latitude.toFixed(5)}&lon=${longitude.toFixed(5)}&lang=en`
      );
      const detail = photon.features?.[0]?.properties || {};
      const locality = detail.name || detail.city || detail.locality || detail.district || '';
      const region = [detail.city && detail.city !== locality ? detail.city : detail.district, detail.country]
        .filter(Boolean)
        .join(', ');
      if (locality || region) {
        return {
          locality,
          region,
          country: detail.country || '',
          label: locality || region
        };
      }
    } catch {
      // Fall through to coordinates when the OSM service is unavailable.
    }
    return {
      locality: '',
      region: '',
      country: '',
      label: `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`
    };
  }
}

async function placeCard(latitude, longitude, key) {
  const location = await reverseGeocode(latitude, longitude);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  if (!key) {
    return {
      name: location.label,
      subtitle: location.region || 'Earth observation point',
      description: 'SerpApi is not configured on this deployment. Add SERPAPI_KEY as a Cloudflare secret to identify this point and load nearby imagery.',
      coordinates: { latitude, longitude },
      images: [],
      mapsUrl,
      provider: 'SerpApi',
      configured: false
    };
  }
  const coordinateText = `${latitude}, ${longitude}`;
  const regionParts = location.region
    .split(', ')
    .filter((part) => part && part.toLowerCase() !== location.locality.toLowerCase());
  const queryText = [location.locality, ...regionParts].filter(Boolean).join(' ') || coordinateText;
  const query = new URLSearchParams({ engine: 'google', q: queryText, hl: 'en', num: '8', api_key: key });
  const mapParams = new URLSearchParams({
    engine: 'google_maps', q: coordinateText, ll: `@${latitude},${longitude},14z`, type: 'search', hl: 'en', api_key: key
  });
  const [search, maps] = await Promise.all([
    getJson('https://serpapi.com/search.json?' + query).catch(() => ({})),
    getJson('https://serpapi.com/search.json?' + mapParams).catch(() => ({}))
  ]);
  const graph = search.knowledge_graph || {};
  const local = maps.local_results?.[0] || maps.place_results || {};
  const organic = search.organic_results?.[0] || {};
  const localTitle = local.title || '';
  const coordinateTitle = !localTitle || /^[\s\d°'".,+\-NSEW]+$/i.test(localTitle) || /^(gps|coordinates?|latitude)/i.test(localTitle);
  const name = (!coordinateTitle ? localTitle : '') || location.locality || graph.title || `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`;
  const imageResults = async (query) => {
    const imageParams = new URLSearchParams({ engine: 'google_images', q: query, hl: 'en', num: '8', api_key: key });
    const result = await getJson('https://serpapi.com/search.json?' + imageParams).catch(() => ({}));
    return result.images_results || [];
  };
  let imageResultsRaw = await imageResults(`${name} landmark`);
  if (!imageResultsRaw.length && location.region)
    imageResultsRaw = await imageResults(`${name} ${location.region}`);
  if (!imageResultsRaw.length)
    imageResultsRaw = await imageResults(`${name} skyline`);
  const imageSearch = { images_results: imageResultsRaw };
  const useful = (text) =>
    typeof text === 'string' && text.trim().length > 24 && !/^no information|not available|cookie|consent/i.test(text.trim());
  const description =
    (useful(local.description) && local.description) ||
    (useful(graph.description) && graph.description) ||
    (useful(organic.snippet) && organic.snippet) ||
    `An Earth observation point ${location.region ? 'near ' + location.region : 'at the selected coordinates'}${local.type ? ' · ' + local.type : ''}.`;
  const images = (imageSearch.images_results || [])
    .filter((image) => /^https:\/\//.test(image.thumbnail || image.original || ''))
    .slice(0, 6)
    .map((image) => ({
      src: image.thumbnail || image.original,
      title: image.title || name,
      link: image.link || image.original
    }));
  if (local.thumbnail && /^https:\/\//.test(local.thumbnail) && !images.some((image) => image.src === local.thumbnail)) {
    images.unshift({ src: local.thumbnail, title: local.title || name, link: mapsUrl });
  }
  return {
    name,
    subtitle: [local.type || graph.type, location.region].filter(Boolean).join(' · ') || 'Earth observation point',
    description,
    address: local.address || '',
    rating: local.rating || null,
    reviews: local.reviews || null,
    coordinates: { latitude, longitude },
    images: images.slice(0, 6),
    source: local.website || graph.source?.link || organic.link || mapsUrl,
    mapsUrl,
    provider: 'SerpApi',
    configured: true
  };
}

// ---------------------------------------------------------------------------
// Natural-event intelligence. EONET supplies the timeline and the agency
// sources; SerpApi supplies the wider web and the pictures; the NASA Image and
// Video Library supplies official imagery. Nothing here needs a model to
// explain an event, so every sentence is traceable to one of those sources.
// ---------------------------------------------------------------------------

const EVENT_EXPLAINERS = {
  Wildfires: 'An open wildfire: active burning confirmed by satellite thermal detections and by the agencies managing the fire.',
  'Severe Storms': 'An open severe-storm event — a named tropical cyclone or a destructive frontal system, tracked from formation to dissipation.',
  Volcanoes: 'An open volcanic event: an eruption, ash emission or lava flow reported by volcano observatories and satellite instruments.',
  Floods: 'An open flood event, from river flooding to coastal inundation, assembled from response agencies and satellite observations.',
  'Sea and Lake Ice': 'An open ice event: sea-ice extent, iceberg calving or lake freeze-up observed from orbit.',
  Drought: 'A drought event, tracked from precipitation deficits and vegetation stress.',
  'Dust and Haze': 'An atmospheric dust or haze event, mapped from aerosol optical depth and satellite imagery.',
  Earthquakes: 'A seismic event reported by the USGS and partner monitoring networks.',
  'Temperature Extremes': 'A temperature-extreme event — a heatwave or cold snap outside the normal range for the region.',
  Snow: 'A significant snowfall event reported by weather agencies.',
  'Water Color': 'A water-colour anomaly, usually an algal bloom or sediment plume seen from orbit.',
  Manmade: 'A human-caused event tracked by NASA EONET, such as an industrial fire or an oil spill.'
};

function ago(date) {
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 90) return `${Math.max(1, minutes)} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function eonetEvents() {
  return cached('events', 5 * MINUTE, async () => {
    const data = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200&days=45');
    const events = [];
    for (const event of data.events ?? []) {
      const last = event.geometry?.[event.geometry.length - 1];
      const point = coordinate(last);
      if (!point) continue;
      events.push({
        id: event.id,
        title: event.title,
        description: event.description ?? '',
        category: event.categories?.[0]?.title ?? 'Event',
        date: last.date,
        firstSeen: event.geometry?.[0]?.date ?? last.date,
        longitude: point[0],
        latitude: point[1],
        sources: (event.sources ?? []).slice(0, 3).map((source) => ({ id: source.id, url: source.url }))
      });
    }
    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { events };
  });
}

async function nasaPhotos(term) {
  const query = new URLSearchParams({ q: term, media_type: 'image', page_size: '6' });
  const data = await getJson(`https://images-api.nasa.gov/search?${query}`);
  return (data?.collection?.items ?? [])
    .map((item) => {
      const thumbnail = item.links?.find((link) => link.rel === 'preview')?.href ?? item.links?.[0]?.href;
      const meta = item.data?.[0];
      if (!thumbnail || !meta?.nasa_id) return undefined;
      return {
        thumbnail,
        title: meta.title ?? term,
        link: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

async function serpBundle(query, key) {
  const web = new URLSearchParams({ engine: 'google', q: query, hl: 'en', num: '6', api_key: key });
  const images = new URLSearchParams({ engine: 'google_images', q: query, hl: 'en', num: '8', api_key: key });
  const [search, pictures] = await Promise.all([
    getJson('https://serpapi.com/search.json?' + web).catch(() => ({})),
    getJson('https://serpapi.com/search.json?' + images).catch(() => ({}))
  ]);
  return {
    description: search.knowledge_graph?.description
      || search.answer_box?.snippet
      || search.organic_results?.[0]?.snippet
      || '',
    links: (search.organic_results ?? [])
      .filter((result) => /^https:\/\//.test(result.link ?? ''))
      .slice(0, 5)
      .map((result) => ({ title: result.title, link: result.link, snippet: result.snippet ?? '' })),
    images: (pictures.images_results ?? [])
      .filter((image) => /^https:\/\//.test(image.thumbnail || image.original || ''))
      .slice(0, 5)
      .map((image) => ({
        src: image.thumbnail || image.original,
        title: image.title || query,
        link: image.link || image.original,
        source: 'SerpApi'
      }))
  };
}

async function eventDetail(id, key) {
  let event;
  try {
    const data = await getJson(`https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(id)}`);
    // The single-event endpoint returns the event at the top level; the list
    // endpoint wraps it in `events`. Accept either shape.
    event = data?.events?.[0] ?? (data?.id ? data : undefined);
  } catch {
    event = undefined;
  }
  const geometry = event?.geometry ?? [];
  const latest = geometry[geometry.length - 1];
  const point = coordinate(latest);
  const title = event?.title ?? 'Natural event';
  const category = event?.categories?.[0]?.title ?? 'Event';
  const first = geometry[0]?.date ?? latest?.date;
  const query = `${title} ${category}`.trim().slice(0, 180);

  const [serp, photos] = await Promise.all([
    key ? serpBundle(query, key).catch(() => undefined) : Promise.resolve(undefined),
    nasaPhotos(query).catch(() => [])
  ]);

  const explainer = EVENT_EXPLAINERS[category]
    ?? 'An open natural event tracked by NASA EONET from satellite and agency reports.';
  const where = point ? `${point[1].toFixed(1)}°, ${point[0].toFixed(1)}°` : 'an unmapped position';
  const recency = ago(latest?.date);
  const timing = recency ? `The latest update was ${recency}` : 'No update time is published';
  const magnitude = latest?.magnitudeValue
    ? `${latest.magnitudeValue}${latest.magnitudeUnit ? ' ' + latest.magnitudeUnit : ''}`
    : '';

  return {
    id,
    title,
    category,
    summary: `${explainer} ${timing}, at ${where}.`,
    webSummary: serp?.description || event?.description || '',
    facts: [
      ['Category', category],
      ['Latest update', latest?.date ? new Date(latest.date).toUTCString() : 'Not reported'],
      ['First reported', first ? new Date(first).toUTCString() : 'Not reported'],
      ['Position', point ? `${point[1].toFixed(2)}°, ${point[0].toFixed(2)}°` : 'Unmapped'],
      ...(magnitude ? [['Reported intensity', magnitude]] : []),
      ['Agencies', (event?.sources ?? []).map((source) => source.id).join(', ')]
    ],
    links: serp?.links ?? [],
    images: [
      ...(serp?.images ?? []),
      ...photos.map((photo) => ({ src: photo.thumbnail, title: photo.title, link: photo.link, source: 'NASA' }))
    ].slice(0, 8),
    sources: (event?.sources ?? []).slice(0, 4).map((source) => ({ id: source.id, url: source.url })),
    eonetUrl: `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(id)}`,
    serpapi: { enabled: Boolean(key), query }
  };
}

async function hotspotDetail(latitude, longitude, query, key, source, frp) {
  const place = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  const term = (query || 'wildfire thermal anomaly').slice(0, 140);
  const search = `${term} ${place}`;
  const firms = /firms/i.test(source);

  const [serp, photos] = await Promise.all([
    key ? serpBundle(search, key).catch(() => undefined) : Promise.resolve(undefined),
    nasaPhotos(term).catch(() => [])
  ]);

  return {
    summary: firms
      ? `A NASA FIRMS thermal detection at ${place}: a VIIRS pixel reporting a heat source far above the surrounding land, captured in the last 24 hours. These are the raw satellite detections behind the thermal-anomaly layer, before any agency turns them into a named fire.`
      : `A thermal anomaly at ${place}: a hotspot far warmer than the surrounding land. In NASA's EONET wildfire record these coincide with active burning, which is why the satellite thermal layer and these dots line up.`,
    webSummary: serp?.description ?? '',
    facts: [
      ['Position', place],
      ['Source', firms ? 'NASA FIRMS · VIIRS NOAA-20' : 'NASA EONET wildfire detections'],
      ...(frp ? [['Radiative power', `${Math.round(frp)} MW`]] : []),
      ['Layer', 'VIIRS thermal anomalies, 375 m'],
      ['Reading', 'Brightness, not fire size']
    ],
    links: serp?.links ?? [],
    images: [
      ...(serp?.images ?? []),
      ...photos.map((photo) => ({ src: photo.thumbnail, title: photo.title, link: photo.link, source: 'NASA' }))
    ].slice(0, 8),
    sources: [],
    serpapi: { enabled: Boolean(key), query: search }
  };
}

// Fire detections. NASA FIRMS publishes the global VIIRS NOAA-20 24-hour
// bundle as a plain CSV, so the dots are real satellite detections and need no
// key. EONET's named wildfire events ride on top of them.
const FIRMS_GLOBAL_CSV =
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';

async function firmsDetections(limit = 900) {
  const response = await fetch(FIRMS_GLOBAL_CSV, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`firms ${response.status}`);
  const text = await response.text();
  const [header, ...rows] = text.trim().split('\n');
  const columns = header.trim().split(',');
  const index = (name) => columns.indexOf(name);
  const iLat = index('latitude'), iLon = index('longitude'), iFrp = index('frp'),
    iBright = index('bright_ti4'), iDate = index('acq_date'), iTime = index('acq_time'),
    iConfidence = index('confidence');
  if (iLat < 0 || iLon < 0) throw new Error('firms schema');
  const detections = [];
  for (const row of rows) {
    const cells = row.split(',');
    const latitude = Number(cells[iLat]), longitude = Number(cells[iLon]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    detections.push({
      latitude: Number(latitude.toFixed(3)),
      longitude: Number(longitude.toFixed(3)),
      frp: Number(cells[iFrp]) || 0,
      brightness: Number(cells[iBright]) || 0,
      date: cells[iDate] ?? '',
      time: cells[iTime] ?? '',
      confidence: cells[iConfidence] ?? ''
    });
  }
  detections.sort((a, b) => b.frp - a.frp);
  return detections.slice(0, limit);
}

async function thermalDots() {
  const [{ events }, detections] = await Promise.all([
    eonetEvents(),
    cached('firms-global', 15 * MINUTE, () => firmsDetections(900)).catch(() => [])
  ]);
  const dots = [];
  for (const event of events) {
    if (!/wildfire/i.test(event.category)) continue;
    dots.push({
      key: `eonet:${event.id}`,
      id: event.id,
      title: event.title,
      category: event.category,
      latitude: event.latitude,
      longitude: event.longitude,
      date: event.date,
      source: 'NASA EONET'
    });
  }
  for (const detection of detections) {
    const clock = String(detection.time).padStart(4, '0');
    dots.push({
      key: `firms:${detection.latitude}:${detection.longitude}:${detection.date}:${detection.time}`,
      id: `firms:${detection.latitude}:${detection.longitude}`,
      title: `VIIRS hotspot${detection.frp ? ' · ' + Math.round(detection.frp) + ' MW' : ''}`,
      category: 'Wildfires',
      latitude: detection.latitude,
      longitude: detection.longitude,
      date: detection.date ? `${detection.date}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:00Z` : '',
      source: 'NASA FIRMS',
      frp: detection.frp,
      brightness: detection.brightness,
      confidence: detection.confidence
    });
  }
  return {
    dots,
    counts: { events: dots.length - detections.length, detections: detections.length },
    source: 'NASA FIRMS VIIRS NOAA-20, last 24 hours, plus NASA EONET wildfire events'
  };
}

// One satellite, expanded: CelesTrak orbital facts plus the SerpApi report.
async function satelliteDetail(params, key) {
  const name = (params.get('name') ?? '')
    .replace(/[^\p{L}\p{M}\w .'()\[\]+\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  if (!name) throw new Error('bad name');
  const norad = (params.get('norad') ?? '').replace(/\D/g, '').slice(0, 9);
  const job = (params.get('job') ?? '').slice(0, 40);
  const altitude = Number(params.get('alt'));
  const speed = Number(params.get('speed'));
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lon'));

  const query = `${name} satellite mission`;
  const [serp, photos] = await Promise.all([
    key ? serpBundle(query, key).catch(() => undefined) : Promise.resolve(undefined),
    nasaPhotos(name).catch(() => [])
  ]);

  const clauses = [];
  if (Number.isFinite(altitude) && altitude > 0) clauses.push(`about ${Math.round(altitude)} km above the ground`);
  if (Number.isFinite(speed) && speed > 0) clauses.push(`moving at ${speed.toFixed(2)} km/s`);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    clauses.push(`currently over ${latitude.toFixed(1)}°, ${longitude.toFixed(1)}°`);
  }
  const orbit = clauses.length ? ` It is ${clauses.join(', ')}.` : '';
  const label = job ? job.toLowerCase() : 'tracked';
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  return {
    name,
    summary: `${name} is ${article} ${label} satellite in the CelesTrak catalogue${norad ? `, NORAD ${norad}` : ''}.${orbit} Orbital position is propagated from its published two-line elements.`,
    webSummary: serp?.description ?? '',
    links: serp?.links ?? [],
    images: [
      ...(serp?.images ?? []),
      ...photos.map((photo) => ({ src: photo.thumbnail, title: photo.title, link: photo.link, source: 'NASA' }))
    ].slice(0, 8),
    serpapi: { enabled: Boolean(key), query }
  };
}

const POWER_PARAMETERS = [
  ['T2MDEW', 'Dew point', '°C'],
  ['PS', 'Surface pressure', 'kPa'],
  ['T2M', 'Air temperature', '°C'],
  ['T2M_MAX', 'Daily maximum', '°C'],
  ['T2M_MIN', 'Daily minimum', '°C'],
  ['RH2M', 'Relative humidity', '%'],
  ['WS2M', 'Wind speed', 'm/s'],
  ['PRECTOTCORR', 'Precipitation', 'mm/day'],
  ['ALLSKY_SFC_SW_DWN', 'Solar irradiance', 'kWh/m²/day']
];

export function createApi(env = {}, extras = {}) {
  const nasaKey = env.NASA_API_KEY || 'DEMO_KEY';
  const serpKey = env.SERPAPI_KEY;
  const firmsKey = env.FIRMS_MAP_KEY;

  const routes = {
    '/cities': async p => {
      const input=(p.get('q')||'').trim().slice(0,80);
      if(!/^[\p{L}\p{M} .,'-]{2,80}$/u.test(input)) throw Error('bad city');
      const chunks=input.split(',').map(x=>x.trim());
      let city=chunks[0],region=chunks.length>1?chunks.slice(1).join(' ').toLowerCase():'';
      const lookup=name=>cached('cities:'+name.toLowerCase(),DAY,()=>getJson('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name,count:'100',language:'en',format:'json'})));
      const cities=data=>(data.results||[]).filter(x=>/^PPL(?:A\d?|C|F|G|R|S)?$/.test(x.feature_code||'')&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
      let candidates=cities(await lookup(city));
      if(!region&&city.includes(' ')&&!candidates.some(x=>x.name.toLowerCase()===city.toLowerCase())){
        const words=city.split(/\s+/);region=words.pop().toLowerCase();city=words.join(' ');candidates=cities(await lookup(city));
      }
      const exact=candidates.filter(x=>x.name.toLowerCase()===city.toLowerCase());
      if(exact.length)candidates=exact;
      const matching=region?candidates.filter(x=>[x.admin1,x.country,x.country_code].some(v=>v?.toLowerCase().includes(region))):candidates;
      const sorted=matching.sort((a,b)=>(b.population||0)-(a.population||0));
      let serpMatch=false;
      if(serpKey&&sorted.length)try{
        const q=new URLSearchParams({engine:'google',q:`${city} ${region} city municipality`,num:'3',api_key:serpKey});
        const evidence=await cached('city-serp:'+input.toLowerCase(),60*MINUTE,()=>getJson('https://serpapi.com/search.json?'+q));
        serpMatch=[evidence.knowledge_graph?.title,...(evidence.organic_results||[]).slice(0,3).map(x=>x.title)].some(title=>title?.toLowerCase().includes(city.toLowerCase()));
      }catch{}
      return {results:sorted.slice(0,8).map(({name,admin1,country,latitude,longitude})=>({name,admin1,country,latitude,longitude})),source:'Open-Meteo city gazetteer',serpMatch};
    },
    '/vendors': p => {
      if(!serpKey)throw Error('SerpAPI key required');
      const category=p.get('category')==='materials'?'materials':'transport';
      const place=(p.get('place')||'').slice(0,80).replace(/[^\p{L}\p{M}\w ,.'-]/gu,'').trim();
      if(!place)throw Error('place required');
      return cached('vendor:'+category+':'+place,60*MINUTE,async()=>{
        const q=category==='materials'?`${place} research expedition equipment supplier laboratory field materials`:`${place} expedition travel charter ground transport agency`;
        const params=new URLSearchParams({engine:'google',q,num:'8',api_key:serpKey});
        const data=await getJson('https://serpapi.com/search.json?'+params);
        if(data.error)throw Error('Vendor search unavailable');
        return {results:(data.organic_results||[]).filter(r=>/^https:\/\//.test(r.link||'')).slice(0,8).map(({title,link,snippet})=>({title,link,snippet})),source:'SerpAPI Google search',category};
      });
    },
    '/analog/climate': p => {
      const lat = number(p, 'lat', -90, 90), lon = number(p, 'lon', -180, 180);
      const q = new URLSearchParams({latitude:lat.toFixed(4), longitude:lon.toFixed(4), community:'RE', format:'JSON', parameters:'T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M,PS'});
      return cached('analog:'+q, DAY, ()=>getJson('https://power.larc.nasa.gov/api/temporal/climatology/point?'+q));
    },
    '/analog/research': p => cached('research:' + (p.get('q') ?? '').slice(0,200), 60 * MINUTE, () => research(p, serpKey)),
    '/place': p => {
      const latitude = number(p, 'lat', -90, 90), longitude = number(p, 'lon', -180, 180);
      const key = `place:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
      return cached(key, 30 * MINUTE, () => placeCard(latitude, longitude, serpKey));
    },
    '/ion/v1/assets/1/endpoint': async () => {
      const response = await fetch('https://api.cesium.com/v1/assets/1/endpoint', {
        headers: { Authorization: 'Bearer ' + env.CESIUM_ION_ACCESS_TOKEN },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Terrain unavailable');
      return response.json();
    },
    // Open natural events: storms, wildfires, floods, volcanoes, ice.
    '/nasa/events': () => eonetEvents(),

    // One event, expanded: the EONET timeline plus a SerpApi and NASA briefing.
    '/nasa/event': (params) => {
      const id = (params.get('id') ?? '').trim();
      if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) throw new Error('bad id');
      return cached(`event:${id}:${Boolean(serpKey)}`, 20 * MINUTE, () => eventDetail(id, serpKey));
    },

    // One thermal dot, expanded with the same briefing.
    '/nasa/hotspot': (params) => {
      const latitude = number(params, 'lat', -90, 90);
      const longitude = number(params, 'lon', -180, 180);
      const query = (params.get('q') ?? '')
        .replace(/[^\p{L}\p{M}\w ,.'"-]/gu, ' ')
        .trim()
        .slice(0, 120);
      const source = (params.get('src') ?? '').slice(0, 40);
      const frp = Number(params.get('frp'));
      return cached(`hotspot:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${query}:${source}`, 30 * MINUTE,
        () => hotspotDetail(latitude, longitude, query, serpKey, source, Number.isFinite(frp) ? frp : undefined));
    },

    // The dots behind the thermal-anomaly layer.
    '/nasa/thermal': () => cached('thermal-dots', 10 * MINUTE, thermalDots),

    // Satellite briefing: CelesTrak facts plus SerpApi coverage.
    '/nasa/satellite': (params) => {
      const name = (params.get('name') ?? '').slice(0, 70);
      const norad = (params.get('norad') ?? '').slice(0, 12);
      return cached(`satellite:${name}:${norad}:${Boolean(serpKey)}`, 30 * MINUTE,
        () => satelliteDetail(params, serpKey));
    },

    // Point meteorology and solar resource from NASA POWER.
    '/nasa/power': (params) => {
      const latitude = number(params, 'lat', -90, 90);
      const longitude = number(params, 'lon', -180, 180);
      const key = `power:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;
      return cached(key, 6 * 60 * MINUTE, async () => {
        const stamp = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
        const query = new URLSearchParams({
          parameters: POWER_PARAMETERS.map(([id]) => id).join(','),
          community: 'RE',
          latitude: latitude.toFixed(4),
          longitude: longitude.toFixed(4),
          start: stamp(new Date(Date.now() - 14 * DAY)),
          end: stamp(new Date(Date.now() - 2 * DAY)),
          format: 'JSON'
        });
        const data = await getJson(`https://power.larc.nasa.gov/api/temporal/daily/point?${query}`);
        const parameters = data?.properties?.parameter ?? {};
        const dates = Object.keys(parameters.T2M ?? {}).sort();
        const date = [...dates].reverse().find((day) => parameters.T2M[day] > -900);
        if (!date) throw new Error('no data');
        return {
          latitude,
          longitude,
          date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          values: POWER_PARAMETERS
            .filter(([id]) => parameters[id]?.[date] > -900)
            .map(([id, label, unit]) => ({ label, unit, value: Number(parameters[id][date].toFixed(1)) }))
        };
      });
    },

    // Flares, coronal mass ejections and geomagnetic storms.
    '/nasa/spaceweather': () => cached('donki', 15 * MINUTE, async () => {
      const start = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);
      const url = (kind) => `https://api.nasa.gov/DONKI/${kind}?startDate=${start}&endDate=${end}&api_key=${nasaKey}`;
      const [flares, cmes, storms] = await Promise.all([
        getJson(url('FLR')).catch(() => []),
        getJson(url('CME')).catch(() => []),
        getJson(url('GST')).catch(() => [])
      ]);
      const items = [];
      for (const flare of (flares ?? []).slice(-4).reverse()) {
        items.push({
          label: `${flare.classType ?? 'Unclassified'} solar flare`,
          detail: `peaked ${(flare.peakTime ?? '').replace('T', ' ')}`
        });
      }
      for (const cme of (cmes ?? []).slice(-3).reverse()) {
        const speed = cme.cmeAnalyses?.[0]?.speed;
        items.push({
          label: 'Coronal mass ejection',
          detail: speed ? `${Math.round(speed)} km/s` : (cme.startTime ?? '').replace('T', ' ')
        });
      }
      for (const storm of (storms ?? []).slice(-2).reverse()) {
        const kp = storm.allKpIndex?.[storm.allKpIndex.length - 1];
        items.push({
          label: 'Geomagnetic storm',
          detail: kp ? `Kp ${kp.kpIndex} on ${(kp.observedTime ?? '').slice(0, 10)}` : (storm.startTime ?? '')
        });
      }
      return { items: items.slice(0, 9) };
    }),

    // Photographs for the detail panel.
    '/nasa/images': (params) => {
      const term = searchTerm(params);
      return cached(`images:${term}`, 24 * 60 * MINUTE, async () => {
        const query = new URLSearchParams({ q: term, media_type: 'image', page_size: '8' });
        const data = await getJson(`https://images-api.nasa.gov/search?${query}`);
        const photos = (data?.collection?.items ?? [])
          .map((item) => {
            const thumbnail = item.links?.find((link) => link.rel === 'preview')?.href ?? item.links?.[0]?.href;
            const meta = item.data?.[0];
            if (!thumbnail || !meta?.nasa_id) return undefined;
            return {
              thumbnail,
              title: meta.title ?? term,
              link: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`
            };
          })
          .filter(Boolean)
          .slice(0, 4);
        return { photos };
      });
    },

    // Active fire detections. Needs a FIRMS map key.
    '/nasa/fires': (params) => {
      if (!firmsKey) throw new Error('missing FIRMS_MAP_KEY');
      const latitude = number(params, 'lat', -90, 90);
      const longitude = number(params, 'lon', -180, 180);
      const sensor = ['VIIRS_SNPP_NRT','MODIS_NRT'].includes(params.get('sensor')) ? params.get('sensor') : 'VIIRS_NOAA20_NRT';
      const box = [longitude - 5, latitude - 5, longitude + 5, latitude + 5].map((v) => v.toFixed(2)).join(',');
      return cached(`fires:${sensor}:${box}`, 10 * MINUTE, async () => {
        const response = await fetch(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/${sensor}/${box}/1`,
          { signal: AbortSignal.timeout(25000) }
        );
        if (!response.ok) throw new Error('upstream');
        const [header, ...rows] = (await response.text()).trim().split('\n');
        const columns = header.trim().split(','); if (!columns.includes('acq_date')) throw new Error('FIRMS unavailable');
        const detections = rows.slice(0, 500).map((row) => {
          const cells = row.split(',');
          const record = {};
          columns.forEach((column, index) => { record[column] = cells[index]; });
          return {
            latitude: Number(record.latitude),
            longitude: Number(record.longitude),
            brightness: Number(record.bright_ti4),
            sensor: sensor, date: record.acq_date, time: record.acq_time, confidence: record.confidence
          };
        });
        return { detections };
      });
    },

    '/nasa/apod': () => cached('apod', 60 * MINUTE, () =>
      getJson(`https://api.nasa.gov/planetary/apod?api_key=${nasaKey}`)),

    '/object': params => report(params.get('name'), serpKey)
  };

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/arcgis/imagery/')) {
      if (!extras.imageryTile) {
        res.statusCode = 404;
        return res.end('{}');
      }
      return extras.imageryTile(req, res, env, url.pathname);
    }
    const category=url.pathname.match(/^\/research\/(site|incident|logistics|news|medical-support)$/)?.[1];
    if(category)url.searchParams.set("category",category);
    const route = category ? p=>cached("gt:"+category+":"+p.get("q"),60*MINUTE,()=>research(p,serpKey)) : routes[url.pathname];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || !route) {
      res.statusCode = 404;
      return res.end('{}');
    }
    try {
      res.end(JSON.stringify(await route(url.searchParams)));
    } catch {
      res.statusCode = 503;
      res.end('{}');
    }
  };
}

// Vite plugin for `npm run dev` and `npm run preview`.
export function nasaApiPlugin(loadEnv, extras = {}) {
  const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
  const handle = createApi(env, extras);
  const configure = (server) => {
    server.middlewares.use('/api', (req, res, next) => {
      handle(req, res).catch(next);
    });
  };
  return { name: 'nasa-api', configureServer: configure, configurePreviewServer: configure };
}
