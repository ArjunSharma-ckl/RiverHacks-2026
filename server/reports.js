import { SATELLITE_NAMES, SUBJECTS, describe } from '../src/catalog.js';
import { displayedHost, sourceLink, trustedHost } from './serp-links.js';

// Keep the report cache in memory so the same module runs on Node and on
// Cloudflare Workers, where the filesystem and sharp are unavailable.
const cachedReports = new Map();
const pending = new Map();
const missions = {
  'Aqua satellite':['Aqua','https://science.nasa.gov/mission/aqua/'],
  Terra:['Terra','https://science.nasa.gov/mission/terra/'],
  'Suomi NPP':['Suomi','https://science.nasa.gov/mission/suomi-npp/'],
  'GPM Core Observatory':['GPM','https://science.nasa.gov/mission/gpm/'],
  'Hubble Space Telescope':['Hubble','https://science.nasa.gov/mission/hubble/'],
  'ISS (Zarya)':['International Space Station','https://www.nasa.gov/international-space-station/'],
  'Landsat 9':['Landsat 9','https://science.nasa.gov/mission/landsat-9/']
};
const domains = ['nasa.gov','esa.int','noaa.gov','usgs.gov','stsci.edu','eso.org','jaxa.jp','spaceforce.mil','spacex.com','starlink.com','eumetsat.int'];
const catalog = new Set(SATELLITE_NAMES);

// One report per constellation. Thousands of Starlinks or Flocks asking
// individually would be thousands of identical paid searches.
const families = [
  [/^STARLINK[- ]/i,'Starlink'], [/^ONEWEB/i,'OneWeb'], [/^IRIDIUM/i,'Iridium'],
  [/^GLOBALSTAR/i,'Globalstar'], [/^FLOCK/i,'Planet Flock'], [/^SKYSAT/i,'SkySat'],
  [/^LEMUR/i,'Lemur'], [/^SPACEBEE/i,'SpaceBEE'], [/^ORBCOMM/i,'Orbcomm'],
  [/^(NAVSTAR|GPS )/i,'GPS'], [/^GALILEO/i,'Galileo'], [/^BEIDOU/i,'BeiDou'],
  [/^COSMOS/i,'Cosmos'], [/^SENTINEL/i,'Sentinel'], [/^NOAA /i,'NOAA'],
  [/^GOES /i,'GOES'], [/^METEOR-M/i,'Meteor-M'], [/^METOP/i,'MetOp'],
  [/^INTELSAT/i,'Intelsat'], [/^EUTELSAT/i,'Eutelsat'], [/^TDRS/i,'TDRS'],
  [/^YAOGAN/i,'Yaogan'], [/^QIANFAN|^SPACESAIL/i,'Qianfan']
];
function family(name) { return families.find(([pattern]) => pattern.test(name))?.[1]; }

function trusted(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && domains.some(d => url.hostname === d || url.hostname.endsWith('.'+d));
  } catch { return false; }
}
async function generate(name, key, craft) {
  const subject = missions[name]?.[0] || family(name) || name;
  const matches = text => String(text).toLowerCase().includes(subject.toLowerCase());
  async function search(engine, terms) {
    const params = new URLSearchParams({engine, api_key:key, q:subject+' '+terms, num:'12'});
    const response = await fetch('https://serpapi.com/search.json?'+params,{signal:AbortSignal.timeout(40000)});
    const result = await response.json();
    if (response.ok && /returned any results/i.test(result.error || '')) return {};
    if (!response.ok || result.error) throw new Error('Search unavailable');
    return result;
  }
  const [web,images] = await Promise.all([
    search('google',craft?'spacecraft mission instruments launch orbit':'astronomy physical characteristics exploration'),
    search('google_images',craft?'spacecraft hardware cleanroom assembly artist illustration -captured -observed -wildfires':'astronomy portrait').catch(()=>({}))
  ]);
  const shortlist=(web.organic_results||[]).filter(r=>trustedHost(displayedHost(r),domains)&&r.snippet&&matches(r.title+' '+r.snippet)).slice(0,7);
  const articles=(await Promise.all(shortlist.map(async r=>({title:r.title,link:await sourceLink(r),snippet:r.snippet}))))
    .filter(r=>r.link&&trusted(r.link));
  const photoCandidates = (images.images_results || []).filter(r => trustedHost(displayedHost(r),domains) && trusted(r.original) && matches(r.title) &&
    (!craft || (!/captur|spacecraft images|observes|image from|as seen by|observed by|satellite image of|wildfire|hurricane/i.test(r.title) &&
    /spacecraft|space station|observatory|satellite|telescope|clean room|assembly|artist|space shuttle/i.test(r.title))))
    .slice(0,4);
  const photos=(await Promise.all(photoCandidates.map(async r=>({title:r.title,link:await sourceLink(r),thumbnail:r.original}))))
    .filter(r=>r.link&&trusted(r.link));
  if (subject === 'Starlink') articles.unshift({title:'Starlink satellite technology',link:'https://www.starlink.com/technology',snippet:'SpaceX describes the constellation’s antennas, optical links, solar arrays and propulsion.'});
  if (missions[name]) {
    const link = missions[name][1];
    articles.unshift({title:subject+' mission overview',link,snippet:describe(name)});
    if (name === 'Aqua satellite') photos.unshift({
      title:'Aqua · official mission illustration',link,
      thumbnail:'https://assets.science.nasa.gov/content/dam/science/missions/aqua/aqua_mission_banner.jpg/jcr:content/renditions/cq5dam.web.1280.1280.jpeg'
    });
    if (!photos.length) {
      const params = new URLSearchParams({q:subject+' spacecraft',media_type:'image',page_size:'40'});
      try {
        const response = await fetch('https://images-api.nasa.gov/search?'+params,{signal:AbortSignal.timeout(10000)});
        const library = await response.json();
        for (const item of library.collection?.items || []) {
          const entry = item.data?.[0];
          if (!entry || !matches(entry.title) || !/spacecraft|clean room|assembly|artist|prelaunch|technician/i.test(entry.title)
              || /image of earth|as seen|captur|spacecraft images|observes|satellite image/i.test(entry.title)) continue;
          const thumbnail = item.links?.find(l => trusted(l.href))?.href;
          if (thumbnail) photos.push({title:entry.title,thumbnail,link:'https://images.nasa.gov/details/'+encodeURIComponent(entry.nasa_id)});
          if (photos.length === 4) break;
        }
      } catch {}
    }
  }
  return {articles,photos,generated:Date.now()};
}
export async function report(name,key) {
  const craft = SATELLITE_NAMES.includes(name) || catalog.has(name);
  if (!craft && !SUBJECTS.has(name)) throw new Error('Unknown object');
  if (pending.has(name)) return pending.get(name);
  const cacheKey = 'v6:' + (family(name) ? family(name) + ' constellation' : name);
  const saved = cachedReports.get(cacheKey);
  if (saved && Date.now() - saved.generated < 7 * 86400000) return saved;
  const task = (async () => {
    try {
      const result = await generate(name, key, craft);
      cachedReports.set(cacheKey, result);
      return result;
    } catch (error) {
      if (saved) return saved;
      throw error;
    }
  })();
  pending.set(name, task);
  try { return await task; } finally { pending.delete(name); }
}



