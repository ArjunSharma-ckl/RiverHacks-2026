import test from 'node:test';
import assert from 'node:assert/strict';

const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
globalThis.location=new URL('http://localhost/#travel');
const {trip,ensureScoutedSite,routePoints,changeTrip,travelAction,totals}=await import('../src/missionforge/travel.js');

test('travel route stays on resolved coordinates and follows the scouted site',async()=>{
  ensureScoutedSite({id:'iceland',name:'Icelandic Highlands',lat:65.05,lon:-16.75});
  assert.deepEqual(routePoints().map(x=>[x.lat,x.lon]),[[29.7604,-95.3698],[65.05,-16.75]]);
  changeTrip({dataset:{trip:'originQuery'},type:'text',value:'Paris, France'});
  assert.equal(routePoints()[0].lon,-95.3698);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({results:[{name:'Paris',admin1:'Île-de-France',country:'France',latitude:48.8534,longitude:2.3488}]})});
  try{await travelAction('search:origin');await travelAction('select:0');}finally{globalThis.fetch=originalFetch}
  assert.equal(routePoints()[0].lon,2.3488);
  assert.equal(trip.origin.name,'Paris, Île-de-France, France');
  assert.ok(totals().legs[0].distance>1000);
  ensureScoutedSite({id:'atacama',name:'Atacama Desert',lat:-24.09,lon:-69.86});
  assert.equal(routePoints().at(-1).name,'Atacama Desert');
  assert.equal(trip.stops.length,1);
});
