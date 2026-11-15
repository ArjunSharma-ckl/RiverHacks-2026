import { answerQuestion, research } from './analog-api.js';
import { sourceLink } from './serp-links.js';
import { thermalPoints } from './thermal.js';
import { weatherMap } from './weather-map.js';
import { report } from './reports.js';
import { siteRankings } from './site-rankings.js';
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
    getJson('https://serpapi.com/search.json?' + query),
    getJson('https://serpapi.com/search.json?' + mapParams).catch(() => ({}))
  ]);
  if(search.error)throw Error('Place search unavailable');
  const graph = search.knowledge_graph || {};
  const local = maps.local_results?.[0] || maps.place_results || {};
  const organic = search.organic_results?.find(r=>/https:\/\/[^\s]*(?:nasa\.gov|usgs\.gov|gov\.is|wikipedia\.org)/i.test(r.displayed_link||r.link||'')) || {};
  const localTitle = local.title || '';
  const coordinateTitle = !localTitle || /^[\s\d°'".,+\-NSEW]+$/i.test(localTitle) || /^(gps|coordinates?|latitude)/i.test(localTitle);
  const name = (!coordinateTitle ? localTitle : '') || location.locality || graph.title || `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`;
  const imageResults = async (query) => {
    const imageParams = new URLSearchParams({ engine: 'google_images', q: query, hl: 'en', num: '8', api_key: key });
    const result = await getJson('https://serpapi.com/search.json?' + imageParams).catch(() => ({}));
    return result.images_results || [];
  };
  const imageResultsRaw = await imageResults(`${name} ${location.region} landscape`);
  const imageSearch = { images_results: imageResultsRaw };
  const useful = (text) =>
    typeof text === 'string' && text.trim().length > 24 && !/^no information|not available|cookie|consent/i.test(text.trim());
  const description =
    (useful(local.description) && local.description) ||
    (useful(graph.description) && graph.description) ||
    (useful(organic.snippet) && organic.snippet) ||
    `An Earth observation point ${location.region ? 'near ' + location.region : 'at the selected coordinates'}${local.type ? ' · ' + local.type : ''}.`;
  const images = await Promise.all((imageSearch.images_results || [])
    .filter((image) => /^https:\/\//.test(image.thumbnail || image.original || ''))
    .slice(0, 6)
    .map(async (image) => ({
      src: image.thumbnail || image.original,
      title: image.title || name,
      link: await sourceLink({link:image.link || image.original || image.thumbnail}) || image.original || image.thumbnail
    })));
  if (local.thumbnail && /^https:\/\//.test(local.thumbnail) && !images.some((image) => image.src === local.thumbnail)) {
    images.unshift({ src: local.thumbnail, title: local.title || name, link: mapsUrl });
  }
  const sourceLinkResolved=await sourceLink({link:local.website || graph.source?.link || organic.link || mapsUrl});
  const source=sourceLinkResolved && !/(?:facebook|instagram|tiktok|pinterest)\.com$/i.test(new URL(sourceLinkResolved).hostname)
    ? sourceLinkResolved : mapsUrl;
  return {
    name,
    subtitle: [local.type || graph.type, location.region].filter(Boolean).join(' · ') || 'Earth observation point',
    description,
    address: local.address || '',
    rating: local.rating || null,
    reviews: local.reviews || null,
    coordinates: { latitude, longitude },
    images: images.slice(0, 6),
    source,
    mapsUrl,
    provider: 'SerpApi',
    configured: true
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

  // Planetary analog endpoints are served by the local Python API in backend/.
  const missionBackend = String(env.MISSION_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const proxyMissionBackend = async (path, params) => {
    const query = params.toString();
    const response = await fetch(`${missionBackend}/api${path}${query ? `?${query}` : ''}`, {
      signal: AbortSignal.timeout(300000),
      headers: { accept: 'application/json' }
    });
    const result = await response.json().catch(() => ({}));
    return response.ok ? result : { ...result, __proxyStatus: response.status };
  };

  async function pointResearch(q, subject) {
        async function search(engine) {
          if (!serpKey) throw new Error('Search unavailable');
          const params = new URLSearchParams({engine, q, api_key: serpKey});
          const data = await getJson('https://serpapi.com/search.json?' + params);
          if (data.error) throw new Error('Search unavailable');
          if (engine === 'google') {
            return (data.organic_results || []).slice(0, 5).map(({title,link}) => ({title,link}));
          }
          if (engine === 'google_news') {
            // Google News groups related coverage under `stories`; flatten so a
            // grouped result still yields individual headlines.
            const flat = [];
            for (const item of data.news_results || []) {
              for (const story of (item.stories?.length ? item.stories : [item])) {
                if (story?.title && story?.link) {
                  flat.push({
                    title: story.title,
                    link: story.link,
                    source: story.source?.name || story.source || '',
                    date: story.date || '',
                    thumbnail: story.thumbnail || ''
                  });
                }
              }
            }
            return flat.slice(0, 5);
          }
          return (data.images_results || []).slice(0, 4)
            .map(({title,link,thumbnail}) => ({title,link,thumbnail}));
        }
        const nasaQuery = subject.replace(/[^\w .-]/g, ' ').slice(0,60).trim();
        const [web, images, news, nasa] = await Promise.allSettled([
          search('google'), search('google_images'), search('google_news'),
          routes['/nasa/images'](new URLSearchParams({name:nasaQuery}))
        ]);
        return { links: web.value || [], images: images.value || [], news: news.value || [],
          nasa: nasa.value?.photos || [],
          searchUnavailable: web.status === 'rejected' || images.status === 'rejected' };
  }
  const routes = {
    '/earth-analogs': p => proxyMissionBackend('/earth-analogs', p),
    '/mars-analogs': p => proxyMissionBackend('/mars-analogs', p),
    '/earth-analog-attribute': p => proxyMissionBackend('/earth-analog-attribute', p),
    '/analog/site-rankings': p => {
      let target = {};
      try {
        const parsed = JSON.parse(p.get('target') || '{}');
        target = parsed?.target && typeof parsed.target === 'object' ? parsed.target : parsed;
      } catch {}
      return siteRankings(target);
    },
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
      if(serpKey&&sorted.length>1&&sorted[0].name.toLowerCase()===sorted[1].name.toLowerCase())try{
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
        const links=await Promise.all((data.organic_results||[]).slice(0,12).map(async r=>({r,link:await sourceLink(r)})));
        return {results:links.filter(({r,link})=>r.title&&link).slice(0,8).map(({r,link})=>({title:r.title,link,snippet:r.snippet||''})),source:'SerpAPI Google search',category};
      });
    },
    '/analog/climate': p => {
      const lat = number(p, 'lat', -90, 90), lon = number(p, 'lon', -180, 180);
      const q = new URLSearchParams({latitude:lat.toFixed(4), longitude:lon.toFixed(4), community:'RE', format:'JSON', parameters:'T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M,PS'});
      return cached('analog:'+q, DAY, ()=>getJson('https://power.larc.nasa.gov/api/temporal/climatology/point?'+q));
    },
    '/analog/research': p => cached('research:v2:' + (p.get('q') ?? '').slice(0,200), 60 * MINUTE, () => research(p, serpKey)),
    '/analog/ask': p => cached('ask:v2:' + (p.get('q') ?? '').slice(0,200).toLowerCase(), 60 * MINUTE, () => answerQuestion(p, serpKey)),
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
    '/nasa/events': () => cached('events', 5 * MINUTE, async () => {
      const data = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open');
      const events = [];
      for (const event of data.events ?? []) {
        const last = event.geometry?.[event.geometry.length - 1];
        const point = coordinate(last);
        if (!point) continue;
        events.push({
          id: event.id,
          title: event.title,
          category: event.categories?.[0]?.title ?? 'Event',
          date: last.date,
          longitude: point[0],
          latitude: point[1],
          sources: (event.sources ?? []).slice(0, 3).map((source) => ({ id: source.id, url: source.url }))
        });
      }
      return { events };
    }),

    '/nasa/thermal-points': params => {
      const date = params.get('date');
      return cached('thermal:'+date, 30*MINUTE, () => thermalPoints(date));
    },
    '/nasa/point-detail': params => {
      const kind = params.get('kind');
      let subject, query;
      if (kind === 'fires') {
        const lat = number(params,'lat',-90,90), lon = number(params,'lon',-180,180);
        const date = params.get('date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
        subject = 'VIIRS thermal anomalies';
        query = 'satellite thermal hotspot near '+lat.toFixed(2)+', '+lon.toFixed(2)+' '+date;
      } else {
        subject = (params.get('name') || '').slice(0,80);
        if (!subject || !['Stars','Planets','Satellites'].includes(kind)) throw new Error('Invalid point');
        query = subject+' '+kind+' NASA';
      }
      return cached('point:'+query, 6*60*MINUTE, () => pointResearch(query,subject));
    },
    '/nasa/event-detail': async params => {
      const { events } = await routes['/nasa/events']();
      const event = events.find(item => item.id === params.get('id'));
      if (!event) throw new Error('Unknown event');
      return cached('event-detail:' + event.id, 6 * 60 * MINUTE, async () => {
        const q = event.title + ' ' + event.date.slice(0, 4);
        return pointResearch(q, event.title);
      });
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

    '/object': params => {if(!serpKey)throw Error('SerpAPI key required');return report(params.get('name'), serpKey)}
  };

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/weather/map' && req.method === 'GET') {
      return weatherMap(url.searchParams, res);
    }
    if (url.pathname.startsWith('/arcgis/imagery/')) {
      if (!extras.imageryTile) {
        res.statusCode = 404;
        return res.end('{}');
      }
      return extras.imageryTile(req, res, env, url.pathname);
    }
    const category=url.pathname.match(/^\/research\/(site|incident|logistics|news|medical-support)$/)?.[1];
    if(category)url.searchParams.set("category",category);
    const route = category ? p=>cached("gt:v2:"+category+":"+p.get("q"),60*MINUTE,()=>research(p,serpKey)) : routes[url.pathname];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || !route) {
      res.statusCode = 404;
      return res.end('{}');
    }
    try {
      const result = await route(url.searchParams);
      if (Number.isInteger(result?.__proxyStatus)) {
        res.statusCode = result.__proxyStatus;
        delete result.__proxyStatus;
      }
      res.end(JSON.stringify(result));
    } catch {
      res.statusCode = 503;
      const serpRoute=Boolean(category)||['/vendors','/analog/research','/analog/ask','/object'].includes(url.pathname);
      res.end(JSON.stringify({error:!serpKey&&serpRoute?'missing_key':'upstream_unavailable'}));
    }
  };
}

// Vite plugin for `npm run dev` and `npm run preview`.
export function nasaApiPlugin(loadEnv, extras = {}) {
  const configure = (server) => {
    // Only the local dev/preview server reads .env.local. The deployed Worker
    // builds its API from Cloudflare's env, so GroundTruth's SerpApi calls use
    // the SERPAPI_KEY secret, never a key from a local file.
    const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
    const handle = createApi(env, extras);
    server.middlewares.use('/api', (req, res, next) => {
      handle(req, res).catch(next);
    });
  };
  return { name: 'nasa-api', configureServer: configure, configurePreviewServer: configure };
}
