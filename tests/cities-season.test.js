import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/nasa-api.js';
import { rankMonths, rankForecast } from '../src/missionforge/seasonal.js';

test('departure lookup returns city records for the requested state only',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('name=Houston+Texas')?{results:[]}:{results:[
    {name:'Houston',admin1:'Texas',country:'United States',feature_code:'PPLA2',population:2314157,latitude:29.76,longitude:-95.36},
    {name:'Houston',admin1:'Missouri',admin2:'Texas County',country:'United States',feature_code:'PPLA2',population:2082,latitude:37.3,longitude:-91.9},
    {name:'Houston Park',admin1:'Texas',country:'United States',feature_code:'PPL',latitude:29.7,longitude:-95.3},
    {name:'Houston Airport',admin1:'Texas',country:'United States',feature_code:'AIRP',latitude:29.8,longitude:-95.3}
  ]}});
  try{
    let body='';const res={statusCode:200,setHeader(){},end(value){body=value}};
    await createApi({})({url:'/cities?q=Houston%20Texas',method:'GET'},res);
    assert.equal(res.statusCode,200);
    assert.deepEqual(JSON.parse(body).results.map(x=>[x.name,x.admin1]),[['Houston','Texas']]);
  }finally{globalThis.fetch=old}
});

test('field season ranks observed months and upcoming dates without inventing a solar forecast',()=>{
  const power={properties:{parameter:{T2M:{JAN:-8,JUL:20},PRECTOTCORR:{JAN:0,JUL:5},WS2M:{JAN:4,JUL:10},ALLSKY_SFC_SW_DWN:{JAN:2,JUL:5}}}};
  assert.equal(rankMonths(power,'Mars')[0].month,'January');
  const ranked=rankForecast({time:['2026-11-15','2026-11-16'],temperature_2m_mean:[-5,20],precipitation_sum:[0,5],wind_speed_10m_max:[25,50]},'Mars');
  assert.equal(ranked[0].date,'2026-11-15');
});
