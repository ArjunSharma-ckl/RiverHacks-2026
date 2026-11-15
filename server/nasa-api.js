import { research } from './analog-api.js';
import { report } from './reports.js';
import { imageryTile } from './arcgis.js';
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

export function createApi(env = {}) {
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
      const data = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200&days=45');
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
    if (url.pathname.startsWith('/arcgis/imagery/')) return imageryTile(req, res, env, url.pathname);
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
export function nasaApiPlugin(loadEnv) {
  const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
  const handle = createApi(env);
  const configure = (server) => {
    server.middlewares.use('/api', (req, res, next) => {
      handle(req, res).catch(next);
    });
  };
  return { name: 'nasa-api', configureServer: configure, configurePreviewServer: configure };
}
