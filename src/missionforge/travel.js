import { sites } from './sites.js';

const cities = {
  'Houston, USA': [29.7604, -95.3698], 'New York, USA': [40.7128, -74.006],
  'Los Angeles, USA': [34.0522, -118.2437], 'London, UK': [51.5072, -0.1276],
  'Santiago, Chile': [-33.4489, -70.6693], 'Reykjavik, Iceland': [64.1466, -21.9426],
};
const defaults = { name: 'New analog expedition', city: 'Houston, USA', travelers: 4, capacity: 8,
  currency: 'USD', flightBase: 260, flightKm: 0.11, charterBase: 2100,
  charterKm: 1.8, groundKm: 0.7, lodging: 95, shortFlightCo2: 125,
  carCo2: 170, stops: [], overrides: {} };
export let trip = structuredClone(defaults);
try { trip = { ...trip, ...JSON.parse(localStorage.getItem('mf-travel-v1') || '{}') }; } catch {}
try {
  const shared = new URLSearchParams(location.search).get('trip');
  if (shared) trip = { ...structuredClone(defaults), ...JSON.parse(decodeURIComponent(escape(atob(shared)))) };
} catch {}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = (v) => Math.max(0, Number(v) || 0);
const rad = Math.PI / 180;
function km(a,b) { const d=(b.lat-a.lat)*rad, l=(b.lon-a.lon)*rad; return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(d/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(l/2)**2))); }
const rates = { USD: 1, EUR: null, GBP: null, CAD: null, INR: null };
let rateDate = '';
try { const cached=JSON.parse(localStorage.getItem('mf-currency-rates')||'{}'); if(cached.date && cached.rates){Object.assign(rates,cached.rates);rateDate=cached.date;} } catch {}
export async function loadRates(){
  if(rateDate===new Date().toISOString().slice(0,10))return;
  try { const res=await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,CAD,INR');if(!res.ok)throw Error('rates');const data=await res.json();Object.assign(rates,data.rates);rateDate=data.date;localStorage.setItem('mf-currency-rates',JSON.stringify({date:rateDate,rates})); } catch {}
}
const symbol = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', INR: '₹' };
function money(v) { const rate=rates[trip.currency];return rate ? `${symbol[trip.currency] || '$'}${(v * rate).toLocaleString(undefined,{maximumFractionDigits:0})}` : 'Rate unavailable'; }
export function saveTrip() { localStorage.setItem('mf-travel-v1', JSON.stringify(trip)); }
export function addSite(s) { trip.stops.push({ name:s.name,lat:s.lat,lon:s.lon,nights:2,mode:'Flight' }); saveTrip(); }
export function routePoints() { const [lat,lon] = cities[trip.city] || [Number(trip.startLat)||0, Number(trip.startLon)||0]; return [{name:trip.city,lat,lon},...trip.stops]; }
export function totals() {
  const points=routePoints(); let transport=0,co2=0;
  const legs=trip.stops.map((stop,i)=>{const distance=km(points[i],stop), mode=stop.mode || 'Flight';
    const base=mode==='Ground' ? distance*n(trip.groundKm) : mode==='Charter' ? Math.ceil(n(trip.travelers)/Math.max(1,n(trip.capacity)))*(n(trip.charterBase)+distance*n(trip.charterKm)) : n(trip.travelers)*(n(trip.flightBase)+distance*n(trip.flightKm));
    const price=trip.overrides[i] === undefined ? base : n(trip.overrides[i]); transport+=price;
    co2+=distance*(mode==='Ground' ? n(trip.carCo2) : n(trip.shortFlightCo2)*n(trip.travelers))/1000;
    return {from:points[i].name,to:stop.name,distance,mode,price}; });
  const lodging=trip.stops.reduce((s,x)=>s+n(x.nights)*n(trip.travelers)*n(trip.lodging),0);
  return {legs,transport,lodging,total:transport+lodging,co2};
}
const field=(id,label,value,step='1')=>`<label class="field">${label}<input data-trip="${id}" type="number" step="${step}" value="${esc(value)}"></label>`;
export function travelHtml() {
  const t=totals();
  return `<span class="eyebrow">Travel / Itinerary</span><h1>Plan the route</h1>
  <label class="field">Project name<input data-trip="name" value="${esc(trip.name)}"></label>
  <div class="actions pills"><button data-travel="import">Import selected site</button><button data-travel="add">Add stop</button><button data-travel="new">New project</button></div>
  <h2>Stops</h2>${trip.stops.map((s,i)=>`<fieldset class="trip-stop"><legend>Stop ${i+1}</legend><label class="field">Location<input data-stop="${i}:name" value="${esc(s.name)}"></label><div class="fields">${['lat','lon','nights'].map(k=>`<label class="field">${k==='lat'?'Latitude':k==='lon'?'Longitude':'Nights'}<input type="number" step="${k==='nights'?1:.0001}" data-stop="${i}:${k}" value="${esc(s[k])}"></label>`).join('')}</div><label class="field">Transport<select data-stop="${i}:mode">${['Flight','Charter','Ground'].map(m=>`<option ${s.mode===m?'selected':''}>${m}</option>`).join('')}</select></label><button data-travel="remove:${i}">Remove stop</button></fieldset>`).join('') || '<p>Add a site or a latitude and longitude stop.</p>'}
  <details><summary>Trip settings</summary><label class="field">Starting city<select data-trip="city">${Object.keys(cities).map(c=>`<option ${c===trip.city?'selected':''}>${c}</option>`).join('')}<option ${trip.city==='Custom'?'selected':''}>Custom</option></select></label><div class="fields">${field('startLat','Start latitude',routePoints()[0].lat,'.0001')}${field('startLon','Start longitude',routePoints()[0].lon,'.0001')}${field('travelers','Travelers',trip.travelers)}${field('capacity','Plane capacity',trip.capacity)}</div><label class="field">Currency<select data-trip="currency">${Object.keys(rates).map(c=>`<option ${c===trip.currency?'selected':''}>${c}</option>`).join('')}</select></label><small>${rateDate?`Reference rates ${esc(rateDate)} · `:'Rates unavailable · '}<a href="https://frankfurter.dev/v1/" target="_blank" rel="noopener">Frankfurter</a>. Trip prices are estimates.</small><div class="fields">${[['flightBase','Flight base fare'],['flightKm','Flight per km'],['charterBase','Charter base'],['charterKm','Charter per km'],['groundKm','Ground per km'],['lodging','Lodging per person/night'],['shortFlightCo2','Short flight g CO₂/passenger km'],['carCo2','Car g CO₂/vehicle km']].map(([k,l])=>field(k,l,trip[k],'.01')).join('')}</div></details>
  <h2>Legs and prices</h2>${t.legs.map((l,i)=>`<div class="trip-leg"><b>${esc(l.from)} → ${esc(l.to)}</b><small>${l.distance.toFixed(0)} km · ${l.mode}</small><label class="field">Price for this leg (${trip.currency})<input type="number" min="0" step="1" data-leg="${i}" value="${Math.round(l.price*(rates[trip.currency]||1))}" ${rates[trip.currency]?'':'disabled'}></label></div>`).join('')}
  <h2>Trip estimate</h2><div class="trip-totals"><div>Transport <b>${money(t.transport)}</b></div><div>Lodging <b>${money(t.lodging)}</b></div><div>Total <b>${money(t.total)}</b></div><div>Per person <b>${money(t.total/Math.max(1,n(trip.travelers)))}</b></div><div>CO₂ estimate <b>${t.co2.toFixed(0)} kg</b></div></div><small>Ground emissions are per vehicle. Air emissions are per passenger. Estimates exclude return legs.</small><div class="actions pills"><button data-travel="map">Show route on globe</button><button data-travel="pdf">Export PDF</button><button data-travel="share">Copy share link</button></div>`;
}
export function changeTrip(target) {
  if (target.dataset.trip) { const k=target.dataset.trip; trip[k]=target.type==='number'?Number(target.value):target.value; if(k==='city'){const c=cities[trip.city];if(c){trip.startLat=c[0];trip.startLon=c[1];}} }
  else if(target.dataset.stop){const [i,k]=target.dataset.stop.split(':');trip.stops[Number(i)][k]=target.type==='number'?Number(target.value):target.value;}
  else if(target.dataset.leg!==undefined && rates[trip.currency]){trip.overrides[Number(target.dataset.leg)]=n(target.value)/rates[trip.currency];}
  saveTrip();
}
export function travelAction(action,selected,onMap) {
  const [kind,index]=action.split(':');
  if(kind==='import') addSite(selected);
  if(kind==='add') trip.stops.push({name:'New stop',lat:0,lon:0,nights:1,mode:'Flight'});
  if(kind==='remove') {trip.stops.splice(Number(index),1);trip.overrides={};}
  if(kind==='new') trip=structuredClone(defaults);
  if(kind==='map') onMap(routePoints());
  if(kind==='pdf') window.print();
  if(kind==='share') {const link=new URL(location.href);link.hash='travel';link.searchParams.set('trip',btoa(unescape(encodeURIComponent(JSON.stringify(trip)))));navigator.clipboard.writeText(link.href).then(()=>alert('Share link copied')).catch(()=>prompt('Copy share link',link.href));}
  saveTrip();
}
