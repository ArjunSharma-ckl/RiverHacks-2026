import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SATELLITE_NAMES, SUBJECTS, describe } from '../src/catalog.js';

const directory = process.env.REPORT_CACHE_DIR || '.cache/reports';
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
const siteFilter = '(' + domains.map(domain => 'site:' + domain).join(' OR ') + ')';
const catalog = readFile(new URL('../public/data/active.tle', import.meta.url),'utf8')
  .then(text => new Set(text.trim().split(/\r?\n/).filter((_,i) => i%3 === 0).map(name => name.trim())));
function trusted(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && domains.some(d => url.hostname === d || url.hostname.endsWith('.'+d));
  } catch { return false; }
}
async function generate(name, key, craft) {
  const subject = missions[name]?.[0] || (/^STARLINK-/i.test(name) ? 'Starlink' : name);
  const matches = text => String(text).toLowerCase().includes(subject.toLowerCase());
  async function search(engine, terms) {
    const params = new URLSearchParams({engine, api_key:key, q:subject+' '+terms+' '+(subject === 'Starlink' ? 'site:starlink.com' : siteFilter)});
    const response = await fetch('https://serpapi.com/search.json?'+params,{signal:AbortSignal.timeout(40000)});
    const result = await response.json();
    if (response.ok && /returned any results/i.test(result.error || '')) return {};
    if (!response.ok || result.error) throw new Error('Search unavailable');
    return result;
  }
  const [web,images,technical] = await Promise.all([
    search('google',craft?'spacecraft mission instruments launch orbit':'astronomy physical characteristics exploration'),
    search('google_images',craft?'spacecraft hardware cleanroom assembly artist illustration -captured -observed -wildfires':'astronomy portrait').catch(()=>({})),
    search('google',craft?'spacecraft design payload operator propulsion specifications':'measurements composition observations research').catch(()=>({}))
  ]);
  const articles = [...(web.organic_results || []),...(technical.organic_results || [])].filter((r,i,all)=>all.findIndex(x=>x.link===r.link)===i).filter(r => trusted(r.link) && r.snippet && matches(r.title+' '+r.snippet)).slice(0,7)
    .map(({title,link,snippet}) => ({title,link,snippet}));
  const photos = (images.images_results || []).filter(r => trusted(r.link) && trusted(r.original) && matches(r.title) &&
    (!craft || (!/captur|spacecraft images|observes|image from|as seen by|observed by|satellite image of|wildfire|hurricane/i.test(r.title) &&
    /spacecraft|space station|observatory|satellite|telescope|clean room|assembly|artist|space shuttle/i.test(r.title))))
    .slice(0,4).map(({title,link,original}) => ({title,link,thumbnail:original}));
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
  const craft = SATELLITE_NAMES.includes(name) || (await catalog).has(name);
  if (!craft && !SUBJECTS.has(name)) throw new Error('Unknown object');
  if (pending.has(name)) return pending.get(name);
  const file = join(directory,createHash('sha256').update('v5:'+(/^STARLINK-/i.test(name)?'Starlink constellation':name)).digest('hex')+'.json');
  const task = (async () => {
    let saved;
    try { saved = JSON.parse(await readFile(file,'utf8')); } catch {}
    if (saved && Date.now()-saved.generated < 7*86400000) return saved;
    try {
      const result = await generate(name,key,craft);
      await mkdir(directory,{recursive:true});
      const temp = file+'.'+randomUUID();
      await writeFile(temp,JSON.stringify(result));
      await rename(temp,file);
      return result;
    } catch (error) { if (saved) return saved; throw error; }
  })();
  pending.set(name,task);
  try { return await task; } finally { pending.delete(name); }
}



