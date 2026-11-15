import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../server/analog-api.js';
import { parseSiteRankings, siteAiRequest } from '../src/missionforge/site-ai.js';
import { applyMaterialAssessment } from '../src/missionforge/material-model.js';
import { start, thermalDemand } from '../src/missionforge/simulation.js';

test('one SerpAPI search turns nested AI overview content into a usable answer',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async url=>{
    calls++;
    assert.equal(new URL(url).searchParams.get('engine'),'google');
    return Response.json({ai_overview:{text_blocks:[{type:'paragraph',snippet:'Basalt is volcanic rock.'},{type:'heading',snippet:'Properties'},{type:'list',list:[{title:'Texture',snippet:'Fine grained after rapid cooling.'}]}],references:[{title:'NASA geology',link:'https://science.nasa.gov/geology',snippet:'Volcanic rock'}]},organic_results:[]});
  });
  const result=await answerQuestion(new URLSearchParams({q:'What is basalt?'}),'key');
  assert.equal(calls,1);
  assert.match(result.answer,/Fine grained/);
  assert.equal(result.sources[0].source,'science.nasa.gov');
});

test('site AI contract rejects invented or invalid measurements',()=>{
  const input=siteAiRequest({olivine:27,roughness:''});
  assert.equal(input.target.olivine,27);
  assert.equal(input.target.roughness,null);
  const rankings=parseSiteRankings({version:1,modelVersion:'m1',results:[{siteId:'atacama',score:82,features:{olivine:11}},{siteId:'unknown',score:99},{siteId:'iceland',score:140}]},new Set(['atacama','iceland']));
  assert.equal(rankings.size,1);
  assert.equal(rankings.get('atacama').features.plagioclase,null);
});

test('validated material output changes future thermal demand only',()=>{
  const mission=start({crew:1,days:1,array:8,sun:5,battery:50,oxygen:30,water:100,food:20,load:2,mode:'Earth analog test',parts:2});
  const baseline=thermalDemand(mission);
  applyMaterialAssessment(mission,{version:1,facilities:[{id:'habitat',material:'model-a',thermalLoadMultiplier:1.2}]});
  assert.equal(thermalDemand(mission),baseline*1.2);
  assert.throws(()=>applyMaterialAssessment(mission,{version:2,facilities:[]}));
});
