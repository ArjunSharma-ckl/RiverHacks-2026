import places from './places.json';

const jobs = [
  [/STARLINK|ONEWEB|IRIDIUM|GLOBALSTAR|INTELSAT|EUTELSAT|ASTRA |SES-|INMARSAT|TDRS/i,'Communications'],
  [/NAVSTAR|GPS |GALILEO|BEIDOU|COSMOS.*GLONASS|QZSS/i,'Navigation'],
  [/NOAA|METEOR-M|METOP|GOES |FENGYUN|SUOMI|GPM/i,'Weather'],
  [/LANDSAT|SENTINEL|FLOCK|SKYSAT|AQUA|TERRA\b|WORLDVIEW/i,'Earth observation'],
  [/HST|HUBBLE|CHANDRA|TESS|SWIFT/i,'Astronomy'],
  [/ISS \(ZARYA\)|CSS \(TIANHE\)/i,'Crewed station']
];
export function mission(name) { return jobs.find(([pattern]) => pattern.test(name))?.[1] || 'Unclassified'; }

export function catalogControls(root, fleet, choose) {
  const input = document.createElement('input');
  input.type='search'; input.placeholder='Name, NORAD ID, or mission'; input.setAttribute('aria-label','Search satellites');
  const place = document.createElement('input');
  place.type='search'; place.placeholder='Near city or country (1,000 km)'; place.setAttribute('aria-label','Location');
  const speed = document.createElement('select');
  speed.setAttribute('aria-label','Orbital speed');
  for (const [label,value] of [['Any speed',''],['Below 5 km/s','slow'],['5–7 km/s','medium'],['Above 7 km/s','fast']]) speed.add(new Option(label,value));
  const results = document.createElement('select'); results.setAttribute('aria-label','Matching satellites');
  const count=document.createElement('small');
  root.append(input,place,speed,results,count);
  let limit=60;
  function render() {
    const q=input.value.trim().toLowerCase();
    const loc=place.value.trim().toLowerCase();
    const centers=loc ? places.filter(([city,country]) => city.toLowerCase().includes(loc)||country.toLowerCase().includes(loc)) : [];
    const matches=(fleet.contacts || []).filter(c => {
      if (!c.speed || ![c.name,c.norad,c.job].join(' ').toLowerCase().includes(q)) return false;
      if ((speed.value==='slow' && c.speed>=5)||(speed.value==='medium' && (c.speed<5 || c.speed>7))||(speed.value==='fast' && c.speed<=7)) return false;
      if (!loc) return true;
      return centers.some(([, ,lon,lat]) => {
        const rad=Math.PI/180;
        return Math.sin((lat-c.lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(c.lat*rad)*Math.sin((lon-c.lon)*rad/2)**2 <= 0.00615;
      });
    });
    results.replaceChildren(new Option('Select a satellite',''));
    for (const c of matches.slice(0,limit)) results.add(new Option(c.name+' · '+c.speed.toFixed(2)+' km/s',c.catalogIndex));
    if (matches.length>limit) results.add(new Option('Show more…','more'));
    count.textContent=fleet.contacts?.length ? matches.length.toLocaleString()+' matches' : 'Loading catalog…';
  }
  for (const field of [input,place,speed]) field.oninput=()=>{limit=60;render();};
  results.onchange=()=>{if(results.value==='more'){limit+=100;render();}else if(results.value!=='')choose(fleet.contacts[Number(results.value)]);};
  fleet.refreshSearch=()=>{if(document.activeElement!==results)render();};
  render();
}
