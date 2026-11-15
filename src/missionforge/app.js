import { roverSteel } from './steel-fatigue.js';
import { condition, damage, equipment, equipmentForModel, equipmentIds, exposureRates, maintain, maintenancePlan, unavailable, weather, recordCheckpoint } from './exposure.js';
import { cue, toggleSound } from "./audio.js";
import { launchSequence } from "./launch.js";
import { cacheFilm } from "./launch.js";
import { trip, travelHtml, changeTrip, travelAction, routePoints, loadRates, loadSeason, ensureScoutedSite } from './travel.js';

import { stations, prepareDuties, assignDuty, dutyPose } from "./duties.js";
import { SITE_FEATURES, parseSiteRankings, siteAiRequest } from './site-ai.js';
import morphdom from "morphdom";
import "./design.css";
import './workspace.css';
import { sites, profiles, coords, rank, interpret, factors } from "./sites.js";
import {
  SOL,
  roles,
  roster,
  start,
  advance,
  generation,
  thermalDemand,
  surfaceGravity,
  failures,
  medicalCases,
  inject,
  respond,
  vitals,
  log,
} from "./simulation.js";
const app = document.querySelector("#app"),
  atlas = document.querySelector("#atlas"),
  notice = document.querySelector("#notice");
function applyQuality(mode) {
  quality = mode;
  try { localStorage.setItem("mf-quality", mode); } catch {}
  scene?.quality(mode);
  for (const button of document.querySelectorAll(".atlas-quality button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
}

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (act, label, cls = "") =>
  `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;
const opts = (values, selected) =>
  values
    .map(
      (v) =>
        `<option${String(v) === String(selected) ? " selected" : ""}>${esc(v)}</option>`,
    )
    .join("");
const select = (id, label, values, value) =>
  `<label class="field">${label}<select id="${id}">${opts(values, value)}</select></label>`;
const num = (id, label, value, min, max, step = 1) =>
  `<label class="field">${label}<input id="${id}" type="number" required min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const line = (a, b) =>
  `<div class="line"><strong>${a}</strong><span>${b}</span></div>`;
const bar = (n) =>
  `<span class="chart"><i style="width:${Math.max(0, Math.min(100, n))}%"></i></span>`;
const label = (s) => `<span class="eyebrow"><i class="tick"></i>${s}</span>`;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "Unavailable");
const SITE_PHOTO_FALLBACK = {
  snake: '/analogs/lava-beds-earth.webp',
  kilauea: '/analogs/kilauea-earth.webp'
};
const photo = (s) => {
  const fallback = SITE_PHOTO_FALLBACK[s.id] || '/analogs/atacama-earth.webp';
  return `<img alt="Satellite view of ${s.name}" loading="lazy" src="/assets/mission/${s.id}.jpg" onerror="this.onerror=null;this.src='${fallback}'">`;
};
const cache = {},
  obs = new Map();
let sortBy = "Suitability",
  researchType = "Studies",
  searchTimer,
  groundQuestion = "";
let drawerOpen = true, drawerWidth = Number(localStorage.getItem('mf-drawer-width')) || 390, filterTemp = 'Any', filterMineral = 'Any', researchQuestion = '', researchAnswer = '';
const explorerFields=SITE_FEATURES;
let explorerValues={};
try{explorerValues=JSON.parse(localStorage.getItem('mf-explorer-inputs')||'{}')}catch{}
let aiRankings=new Map(),aiRankingStatus='AI rankings not loaded';
let aiRequestId=0,aiTimer=null;
const AI_PAGES=['discover','inspect','design','past','control'];
async function refreshAiRankings(){
  const request=++aiRequestId;
  aiRankingStatus='Scoring sites…';
  try{
    const target=encodeURIComponent(JSON.stringify(siteAiRequest(explorerValues)));
    const response=await fetch('/api/analog/site-rankings?target='+target,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('service');
    const parsed=parseSiteRankings(await response.json(),new Set(sites.map(s=>s.id)));
    if(request!==aiRequestId)return;
    aiRankings=parsed;
    aiRankingStatus=aiRankings.size?`AI model scored ${aiRankings.size} sites`:'AI returned no scores';
  }catch{
    if(request!==aiRequestId)return;
    aiRankingStatus='AI rankings unavailable · server offline';
  }
  if(AI_PAGES.includes(page))update();
}
function scheduleAiRefresh(){clearTimeout(aiTimer);aiTimer=setTimeout(refreshAiRankings,450);}
const aiFeatureText=(s)=>{
  const ai=aiRankings.get(s.id);
  if(!ai)return '';
  return SITE_FEATURES.filter(([key])=>Number.isFinite(ai.features?.[key]))
    .slice(0,3)
    .map(([key,name])=>`${name} ${fmt(ai.features[key],ai.features[key]<2?2:0)}`)
    .join(' · ');
};
function aiPanel(s){
  const ai=aiRankings.get(s.id);
  if(!ai)
    return `<h2>AI site match</h2><p class="note">${esc(aiRankingStatus)}. Describe a target in the site explorer and every site is scored against the same seven inputs.</p><div class="actions pills">${btn('explorer','Enter AI inputs')}</div>`;
  return `<h2>AI site match</h2>${line('AI score',ai.score+' / 100')}${line('Model',esc(ai.modelVersion))}${SITE_FEATURES.map(([key,name])=>line(name,Number.isFinite(ai.features?.[key])?fmt(ai.features[key],ai.features[key]<2?2:1):'Unavailable')).join('')}<p class="note">These seven features are exactly what the model reads. Change the target inputs in the site explorer to re-rank every candidate.</p>`;
}
function uptimeLabel(m){
  if(!m)return '—';
  const start=Number(m.startedAt)||Date.now();
  const total=Math.max(0,Math.floor((Date.now()-start)/1000));
  const d=Math.floor(total/86400),h=Math.floor((total%86400)/3600),min=Math.floor((total%3600)/60),sec=total%60;
  return (d?d+'d ':'')+[h,min,sec].map(n=>String(n).padStart(2,'0')).join(':');
}
let missionHistory=[];
try{missionHistory=JSON.parse(localStorage.getItem('mf-mission-history')||'[]')}catch{}
let facilitySearch='';
const extraFacilities={storage:'Storage depot',comms:'Communications relay',landing:'Descent vehicle',recycler:'Water recycling module',lab:'Research laboratory',habitat:'Habitat module',medical:'Medical module',solar:'Solar array'};
let gtAnswer = "",
  // Performance renders at 0.7x resolution, which is what made the globe look
  // soft the moment the site opened. Start at Balanced and remember whatever
  // the viewer picks.
  quality = "Balanced";
try { quality = localStorage.getItem("mf-quality") || quality; } catch {}
let crewIndex = 0;
let cameraPreset = "Overview";
let site = sites[0],
  profile = 0,
  query = "",
  priority = 1,
  compare = "iceland",
  page = "",
  scene,
  mission,
  playing = false,
  speed = 1,
  tab = "Systems",
  incident = "solar",
  medical = medicalCases[0],
  sensor = "VIIRS_NOAA20_NRT",
  equip = "",
  measurement = "",
  research = "",
  researchResults = [],
  mapMode = "Detail imagery",
  timer,
  observationVersion = 0;
let cfg = {
  crew: 4,
  crewMembers: roster.map(name=>({name,age:'',heightCm:'',weightKg:'',baselinePulse:66,sleepHours:7.5,notes:''})),
  days: 7,
  array: 8,
  battery: 48,
  load: 1.8,
  water: 64,
  oxygen: 36,
  food: 27,
  parts: 3,
  medkits: 2,
  regolith: 0,
  components: 0,
  rover: true,
  backup: true,
  roles: [...roles, "Systems engineer", "Geologist"],
  mode: "Earth analog test",
  objective: "Habitat endurance and rover exploration",
};
try {
  const saved = JSON.parse(localStorage.getItem("missionforge-v1"));
  if (saved?.cfg) {
    cfg = { ...cfg, ...saved.cfg, food: saved.cfg.food ?? cfg.food, medkits: saved.cfg.medkits ?? cfg.medkits, regolith:saved.cfg.regolith??cfg.regolith, components:saved.cfg.components??cfg.components };
    site = saved.site;
    profile = saved.profile ?? 0;
    mission = saved.mission;
  }
} catch {}
function ensureCrew(){
  cfg.crew=Math.max(1,Math.min(12,Number(cfg.crew)||4));
  cfg.crewMembers??=[];
  for(let i=0;i<cfg.crew;i++){
    cfg.crewMembers[i]??={name:roster[i]||`Crew ${i+1}`,age:'',heightCm:'',weightKg:'',baselinePulse:66,sleepHours:7.5,notes:''};
    cfg.roles[i]??=roles[i%roles.length];
  }
}
ensureCrew();
const crewName=i=>cfg.crewMembers?.[i]?.name||roster[i]||`Crew ${i+1}`;
const crewNames=()=>Array.from({length:cfg.crew},(_,i)=>crewName(i));
try{const session=JSON.parse(localStorage.getItem('mf-sim-session')||'{}');playing=Boolean(mission&&mission.outcome==='In progress'&&session.playing);speed=[1,2,3,4,10,50].includes(session.speed)?session.speed:1;const elapsed=Math.max(0,Date.now()-(session.savedAt||Date.now()))/3000*.1;if(playing&&elapsed)advance(mission,Math.min(elapsed*speed,mission.cfg.days*SOL-mission.h));for(const entry of missionHistory){if(entry.id===mission?.id||!entry.playing||entry.snapshot?.outcome!=='In progress')continue;advance(entry.snapshot,Math.min(elapsed*(entry.speed||1),entry.snapshot.cfg.days*SOL-entry.snapshot.h));entry.h=entry.snapshot.h;entry.outcome=entry.snapshot.outcome;entry.resources=entry.snapshot.resources;entry.logs=entry.snapshot.logs;entry.parts=entry.snapshot.parts;entry.medkits=entry.snapshot.medkits;entry.playing=entry.outcome==='In progress'} }catch{}
function save() {
  try {
    if(mission?.cfg?.site){mission.id??=String(Date.now());const snapshot={...mission,logs:mission.logs.slice(-80),history:mission.history.slice(-160)};const entry={id:mission.id,site:mission.cfg.site,mode:mission.cfg.mode,crew:mission.cfg.crew,h:mission.h,outcome:mission.outcome,playing,speed,logs:snapshot.logs,parts:mission.parts,medkits:mission.medkits,resources:mission.resources,snapshot};missionHistory=[entry,...missionHistory.filter(x=>x.id!==entry.id)].slice(0,16);}
    localStorage.setItem('mf-mission-history',JSON.stringify(missionHistory));
    localStorage.setItem('mf-sim-session',JSON.stringify({playing,speed,savedAt:Date.now()}));
    localStorage.setItem(
      "missionforge-v1",
      JSON.stringify({ cfg, site, mission:mission?{...mission,logs:mission.logs.slice(-80),history:mission.history.slice(-160)}:null, profile }),
    );
  } catch {}
}
function toast(s) {
  notice.textContent = s;
  clearTimeout(timer);
  timer = setTimeout(() => (notice.textContent = ""), 4000);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(28000) });
  if (!r.ok) throw Error((await r.json().catch(()=>({}))).error || 'upstream_unavailable');
  return r.json();
}
await Promise.all(
  sites.map(async (s) => {
    try {
      cache[s.id] = await json("/data/" + s.id + ".json");
    } catch {}
  }),
);
const ranking = (s) => rank(s, cache[s.id], profile, query, priority);
const displayScore=s=>aiRankings.get(s.id)?.score??ranking(s).score;
const featureValue=(s,key)=>key==='surfaceTemperature'?aiRankings.get(s.id)?.features[key]??annual(s,'T2M'):aiRankings.get(s.id)?.features[key];
const ranked = () =>
  [...sites].sort((a, b) =>
    sortBy === "Site name"
      ? a.name.localeCompare(b.name)
      : sortBy === "Solar resource"
        ? (annual(b, "ALLSKY_SFC_SW_DWN") ?? -1) -
          (annual(a, "ALLSKY_SFC_SW_DWN") ?? -1)
        : SITE_FEATURES.some(([key,label])=>label===sortBy)
          ? (featureValue(b,SITE_FEATURES.find(([,label])=>label===sortBy)[0])??-Infinity)-(featureValue(a,SITE_FEATURES.find(([,label])=>label===sortBy)[0])??-Infinity)
          : (displayScore(b) ?? -1) - (displayScore(a) ?? -1),
  );
const annual = (s, k) => {
  const n = cache[s.id]?.properties?.parameter?.[k]?.ANN;
  return Number.isFinite(n) && n > -900 ? n : null;
};
const units = { battery: "kWh", oxygen: "kg", water: "L", food: "kg" };
const resourceName = {
  battery: "Battery",
  oxygen: "Oxygen",
  water: "Water",
  food: "Food",
};
const current = () => obs.get(site.id) || {};
function lensContent() {
  if (page !== "control") return "";
  if (cameraPreset === "Rover")
    return `<div><b>ROVER CHASE CAM　/　MF-001</b><span>${mission?.traverse ? "Survey traverse active" : "Parked at the survey loop"} · ${fmt(mission?.km ?? 0, 1)} km</span></div>${btn("overviewCamera", "Exit camera")}`;
  return ["Helmet", "Follow crew"].includes(cameraPreset)
    ? `<div><b>${cameraPreset === "Helmet" ? "HELMET CAM" : "CHASE CAM"}　/　${esc(crewName(crewIndex))}</b><span>${dutyPose(mission, crewIndex).status} · ${vitals(mission, crewIndex).pulse} BPM</span></div>${btn("overviewCamera", "Exit camera")}`
    : "";
}
const viewport = () =>
  `<div class="viewport"><div class="crew-lens">${lensContent()}</div><div class="zoom">${btn("zoomIn", "+")}<button data-act="zoomOut" aria-label="Zoom out">−</button><div class="mission-orbit-controls" hidden><button type="button" data-act="orbit-left" aria-label="Orbit settlement left">↶</button><button type="button" data-act="orbit-right" aria-label="Orbit settlement right">↷</button></div></div><aside id="mission-hud" hidden></aside>${equip ? `<div class="scene-note">${esc(equip)}</div>` : ""}</div>`;
function missionHud(m) {
  if (!m) return "";
  prepareDuties(m);
  const crew = m.duties.slice(0, m.cfg.crew);
  const working = crew.filter((d) => dutyPose(m, m.duties.indexOf(d)).working).length;
  const alerts = Object.keys(m.active || {});
  const roverState = !m.cfg.rover
    ? "Not deployed"
    : m.active.rover
      ? "Repair needed"
      : m.traverse
        ? "Surveying"
        : "Parked";
  const status = alerts.length ? `${alerts.length} active alert${alerts.length > 1 ? "s" : ""}` : "All systems nominal";
  return `<header><span>MF-001 / LIVE</span><b>SOL ${Math.floor(m.h / SOL) + 1} · ${fmt(m.h % SOL, 1)} h</b><i class="hud-dot ${alerts.length ? "warn" : ""}"></i></header>
    <div class="hud-grid">
      <div><small>Battery</small><strong>${fmt(m.resources.battery, 1)} <em>kWh</em></strong>${bar((m.resources.battery / m.initial.battery) * 100)}</div>
      <div><small>Oxygen</small><strong>${fmt(m.resources.oxygen, 1)} <em>kg</em></strong>${bar((m.resources.oxygen / m.initial.oxygen) * 100)}</div>
      <div><small>Water</small><strong>${fmt(m.resources.water, 1)} <em>L</em></strong>${bar((m.resources.water / m.initial.water) * 100)}</div>
      <div><small>Food</small><strong>${fmt(m.resources.food, 1)} <em>kg</em></strong>${bar((m.resources.food / m.initial.food) * 100)}</div>
    </div>
    <div class="hud-lines">
      <span><b>Crew</b>${working}/${m.cfg.crew} working</span>
      <span><b>Power</b>${fmt(generation(m), 2)} / ${fmt(thermalDemand(m), 2)} kW</span>
      <span><b>Rover</b>${roverState} · ${fmt(m.km, 1)} km</span>
      <span><b>Transports</b>2 pressurized cars ready</span>
      <span><b>Integrity</b>${fmt(m.integrity ?? 100, 1)}%</span>
    </div>
    <div class="hud-timer"><b>Settlement uptime</b><span data-uptime>${uptimeLabel(m)}</span></div>
    <footer class="hud-status ${alerts.length ? "warn" : ""}">${esc(status)}</footer>`;
}
function reasoning(s) {
  const r = ranking(s),
    total = r.w.reduce((sum, w, i) => sum + (r.scores[i] === null ? 0 : w), 0);
  if (!total) return "Environmental inputs unavailable.";
  const entries = r.scores.flatMap((value, i) =>
    value === null
      ? []
      : [
          {
            i,
            points: (value * r.w[i]) / total,
            loss: ((100 - value) * r.w[i]) / total,
          },
        ],
  );
  const best = entries.slice().sort((a, b) => b.points - a.points)[0],
    limit = entries.slice().sort((a, b) => b.loss - a.loss)[0];
  const observations = [
    fmt(annual(s, "T2M")) +
      " °C mean, " +
      fmt(annual(s, "PRECTOTCORR"), 2) +
      " mm/day rain",
    s.surface,
    fmt(annual(s, "ALLSKY_SFC_SW_DWN"), 2) + " kWh/m²/day",
    s.isolation + "/100 field estimate",
    s.access + "/100 field estimate",
    fmt(annual(s, "T2M")) + " °C mean",
  ];
  return (
    factors[best.i] +
    " contributes " +
    fmt(best.points) +
    " points (" +
    observations[best.i] +
    "). " +
    (limit.loss > 0.05
      ? factors[limit.i] +
        " costs " +
        fmt(limit.loss) +
        " points relative to a perfect match."
      : "All available criteria meet their targets.")
  );
}
function rows() {
  const minerals={atacama:'Salt',iceland:'Basalt',haughton:'Impact breccia',death:'Silica',mauna:'Basalt',mcmurdo:'Basalt'};
  return ranked().filter(s => (filterTemp==='Any' || (filterTemp==='Below 0°C' ? (annual(s,'T2M')??100)<0 : filterTemp==='0–15°C' ? (annual(s,'T2M')??100)>=0 && (annual(s,'T2M')??100)<=15 : (annual(s,'T2M')??-100)>15)) && (filterMineral==='Any' || minerals[s.id]===filterMineral))
    .map(
      (s) =>
        `<button class="site-card" data-act="site:${s.id}"><span class="site-card-image">${photo(s)}</span><span class="site-card-content"><small>${esc(s.country)} · ${esc(s.type)}</small><strong>${esc(s.name)}</strong><span class="score-reason">${esc(aiRankings.has(s.id)?`AI ${aiRankings.get(s.id).modelVersion} · ${aiFeatureText(s)}`:reasoning(s))}</span>${SITE_FEATURES.some(([,name])=>name===sortBy)?`<span class="score-reason">${esc(sortBy)}: ${featureValue(s,SITE_FEATURES.find(([,name])=>name===sortBy)[0])??'Awaiting measurement'}</span>`:''}</span><b class="site-card-score">${displayScore(s)??"—"}<small>/100</small></b></button>`,
    )
    .join("");
}
function discover() {
  return `${siteExplorer()}${backendAnalogPanel()}<div class="site-catalog">${label("Site atlas / Discovery")}<h2>Find a field site</h2><p>Rank terrestrial environments against your mission requirements.</p><label class="field">Mission description<input id="query" value="${esc(query)}" placeholder="e.g. A cold volcanic site for rover testing"></label><div class="fields">${select("profile", "Mission profile", profiles, profiles[profile])}${select("priority", "Climate weight", ["Standard", "Double", "Triple"], ["Standard", "Double", "Triple"][priority - 1])}${select('temperature-filter','Mean temperature',['Any','Below 0°C','0–15°C','Above 15°C'],filterTemp)}${select('mineral-filter','Surface material',['Any','Basalt','Salt','Silica','Impact breccia'],filterMineral)}</div><div class="headrow"><h2>Candidate sites</h2><small>Suitability / 100</small></div><p class="note">Temperature uses NASA POWER normals. Mineral measurements are shown only when a matching AI provides them.</p>${select("sort", "Sort candidates", ["Suitability",...SITE_FEATURES.map(([,name])=>name),"Solar resource", "Site name"], sortBy)}<div class="ai-bar"><small>${esc(aiRankingStatus)}</small><button type="button" class="ai-refresh" data-act="refresh-ai">Refresh</button></div><div id="rankings">${rows()}</div><p class="note">Derived estimates · NASA POWER climate normals and editorial field criteria. AI results replace these scores when available.</p>${btn("manual", "Evaluate a point on the globe")}</div>`;
}
function pastMissions(){
  const entries=missionHistory;
  const card=x=>{
    const m=x.snapshot, alerts=Object.keys(m?.active||{});
    return `<article class="mission-card">${photo(x.site)}<div><small>${esc(x.mode||'Earth analog test')} · ${fmt(x.h||0,1)} h elapsed${m&&x.outcome==='In progress'?' · T+'+uptimeLabel(m):''}</small><h2>${esc(x.site?.name||'Field mission')}</h2><p>${esc(x.crew)} crew · ${esc(x.outcome||'In progress')}${x.outcome==='In progress'?(x.playing?' · Running':' · Paused'):''}</p><div class="actions pills">${m?btn('resume-mission:'+esc(x.id),'Open mission'):''}${x.outcome==='In progress'?btn('end-mission:'+esc(x.id),'End mission'):''}${btn('archive-site:'+esc(x.site?.id||''),'Explore site')}</div><details><summary>Full mission summary</summary>${m?`${line('Objective',esc(m.cfg.objective))}${line('Duration',`${fmt(m.h,1)} / ${fmt(m.cfg.days*SOL,1)} h`)}${line('Active failures',alerts.length?alerts.map(k=>esc(failures[k]?.[0]||k)).join(', '):'None')}${line('Crew',m.cfg.crewMembers?.slice(0,m.cfg.crew).map(p=>esc(p.name)).join(', ')||`${m.cfg.crew} members`)}${line('Facilities',Object.entries(facilityNames).filter(([key])=>m.cfg.facilities?.[key]!==false).map(([,name])=>name).join(', '))}${Object.entries(x.resources||{}).map(([key,value])=>line(esc(key),fmt(value)+' '+(units[key]||''))).join('')}${line('Repair spares / medical kits',`${x.parts??'—'} / ${x.medkits??'—'}`)}${(x.logs||[]).slice(-12).reverse().map(item=>`<p class="archive-log">${fmt(item.h,1)} h · ${esc(item.msg)}</p>`).join('')}`:'<p>Detailed snapshot unavailable for this older mission.</p>'}</details></div></article>`;
  };
  const active=entries.filter(x=>x.outcome==='In progress');
  return `${label('Mission archive')}<h1>Missions</h1><p>Every mission you start is stored here and keeps running while you use other tabs. Each one carries a settlement uptime clock.</p><h2>Active missions</h2>${active.length?active.map(card).join(''):'<p class="empty-card">No active missions.</p>'}<h2>Past missions</h2>${entries.length?entries.map(card).join(''):'<p class="empty-card">Start a mission and it is saved here immediately.</p>'}${entries.length?'':btn('discover','Browse sites','primary')}`;
}
let analogBody='Moon',analogGroups=[],analogLoading=false,analogTimer=null,analogRequest=0;
const ANALOG_MINERALS={olivine:'olivine',plagioclase:'plagioclase',lowCalciumPyroxene:'low_calcium_pyroxene',highCalciumPyroxene:'high_calcium_pyroxene',smfe:'iron'};
// The same inputs that feed the site model also drive the planetary backend.
function analogQueries(){
  const queries=[];
  const temperature=Number(explorerValues.surfaceTemperature);
  if(Number.isFinite(temperature))
    queries.push({key:'temperature',label:'Surface temperature',params:{attribute:'temperature',value:String(temperature),unit:'C'}});
  const mineral=Object.entries(ANALOG_MINERALS)
    .map(([field,family])=>[family,Number(explorerValues[field])])
    .filter(([,value])=>Number.isFinite(value))
    .sort((a,b)=>b[1]-a[1])[0];
  if(mineral)
    queries.push({key:'mineral',label:'Mineral family · '+mineral[0].replace(/_/g,' '),params:{attribute:'mineral',mineral:mineral[0]}});
  const roughness=Number(explorerValues.roughness);
  if(Number.isFinite(roughness))
    queries.push({key:'roughness',label:'Surface roughness',params:{attribute:'roughness',value:String(roughness)}});
  return queries;
}
async function runBackendAnalogs(){
  const queries=analogQueries();
  const request=++analogRequest;
  if(!queries.length){analogGroups=[];analogLoading=false;if(page==='discover')update();return;}
  analogLoading=true;
  if(page==='discover')update();
  const groups=[];
  for(const query of queries){
    const params=new URLSearchParams({top:'10',body:analogBody,...query.params});
    try{
      const response=await fetch('/api/earth-analog-attribute?'+params,{signal:AbortSignal.timeout(120000)});
      const data=await response.json().catch(()=>({}));
      if(request!==analogRequest)return;
      if(!response.ok){groups.push({...query,error:data.error||('Backend request failed ('+response.status+')'),items:[]});continue;}
      const items=(data.features||[]).map(feature=>{
        const properties=feature.properties||{},coordinates=feature.geometry?.coordinates||[];
        return {
          name:properties.earth_sample_name||properties.earth_sample_id||properties.earth_grid_id||'Earth location',
          score:properties[query.key+'_match_percentage']??properties.earth_formula_match_percentage??properties.match_percentage,
          lat:Number(coordinates[1]),lon:Number(coordinates[0]),
          formula:properties.earth_best_fit_formula,
          kelvin:properties.earth_temperature_kelvin,
          roughness:properties.earth_surface_roughness?.surface_roughness_um,
        };
      });
      groups.push({...query,items,note:data.matching?.formula_match_method||data.matching?.reason||''});
    }catch{
      if(request!==analogRequest)return;
      groups.push({...query,error:'The planetary backend is not reachable. Start it with python -m backend.server.',items:[]});
    }
  }
  analogLoading=false;
  analogGroups=groups;
  if(page==='discover')update();
}
function scheduleAnalogRun(){clearTimeout(analogTimer);analogTimer=setTimeout(runBackendAnalogs,700);}
function analogItems(group){
  if(group.error)return `<p class="analog-error">${esc(group.error)}</p>`;
  if(!group.items?.length)return '<p class="analog-error">No Earth matches returned.</p>';
  return `<ol class="analog-list">${group.items.map(item=>{
    const where=Number.isFinite(item.lat)?item.lat.toFixed(2)+'°, '+item.lon.toFixed(2)+'°':'coordinates unavailable';
    const score=Number.isFinite(item.score)?' · '+Math.round(item.score)+'% match':'';
    const formula=item.formula?' · '+esc(item.formula):'';
    const kelvin=Number.isFinite(item.kelvin)?' · '+fmt(item.kelvin,1)+' K':'';
    const roughness=Number.isFinite(item.roughness)?' · '+fmt(item.roughness,2)+' µm':'';
    return `<li><b>${esc(item.name)}</b><small>${where}${score}${formula}${kelvin}${roughness}</small></li>`;
  }).join('')}</ol>`;
}
function backendAnalogPanel(){
  const queries=analogQueries();
  const controls=queries.length
    ? `<div class="analog-controls">${select('analog-body','Target body',['Moon','Mars'],analogBody)}<button type="button" class="ai-refresh" data-act="refresh-analogs">${analogLoading?'Querying…':'Re-query'}</button></div>`
    : '';
  const results=queries.length
    ? (analogGroups.length
      ? analogGroups.map(group=>`<details class="analog-group" open><summary>${esc(group.label)}${group.items?.length?' · top '+group.items.length:''}</summary>${analogItems(group)}${group.note?`<p class="note">${esc(group.note)}</p>`:''}</details>`).join('')
      : `<p class="note">${analogLoading?'Querying the mission backend…':'No results yet.'}</p>`)
    : '<p class="note">Enter a surface temperature, mineral value or terrain roughness above and the backend ranks real Earth locations against it.</p>';
  return `<section class="analog-panel">${label('Planetary backend / Earth analogs')}<h2>Earth analog matches</h2><p class="note">These inputs go to the mission backend, which scores Earth mineralogy, MODIS temperature and visual roughness against the target.</p>${controls}${results}</section>`;
}
function siteExplorer(){return `${label('Site explorer / AI input')}<h1>Describe a target site</h1><p>These seven measurements are the model's entire input. Fill any of them and every candidate site is re-scored against your target.</p><div class="explorer-grid">${explorerFields.map(([key,name])=>`<label class="field">${name}<input type="number" step="any" data-explorer="${key}" value="${esc(explorerValues[key]??'')}" placeholder="${esc({olivine:'modal %',plagioclase:'modal %',lowCalciumPyroxene:'modal %',highCalciumPyroxene:'modal %',smfe:'band depth',roughness:'µm',surfaceTemperature:'°C mean'}[key]||'Number')}"></label>`).join('')}</div><div class="actions pills">${btn('save-explorer','Save site inputs','primary')}${btn('clear-explorer','Clear')}</div><details><summary>Structured input preview</summary><pre class="input-preview">${esc(JSON.stringify(siteAiRequest(explorerValues),null,2))}</pre></details><p class="note">Mineral values and roughness retain the units of your source data. Missing values remain null.</p>`;}
function researchPanel(){return `<div class="groundtruth-hero">${label('GroundTruth / Evidence desk')}<h1>Ask GroundTruth</h1><p>Ask about this site, mission operations or any research topic. Answers include the search sources used.</p></div><div class="research-search"><label class="field">Question<input id="research-question" value="${esc(researchQuestion)}" placeholder="What terrain risks affect our rover?"></label>${btn('ask-research','Get answer →','primary')}</div><div class="prompt-suggestions">${['Equipment risks','Terrain hazards','Crew health'].map(x=>`<button data-research-prompt="${x}">${x}</button>`).join('')}</div><div class="research-results" id="research-answer" role="status">${researchAnswer||'<p class="empty-card">Enter a question to see an answer with source links.</p>'}</div>`;}
const facilityNames={science:'Science module',medical:'Medical bay',quarters:'Crew quarters',water:'Water reclamation',logistics:'Logistics depot',fabrication:'Fabrication workshop',construction:'Construction yard',rover:'Rover'};
function facilityControls(){const added=cfg.addedFacilities||[];const matches=Object.entries(extraFacilities).filter(([key,name])=>!added.includes(key)&&facilitySearch&&name.toLowerCase().includes(facilitySearch.toLowerCase()));return `<details open><summary>Planned settlement facilities</summary><p class="note">Core facilities. Optional search lists only modules with a local 3D model. Pressurized modules connect by enclosed corridors; surface work requires EVA protection.</p><div class="facility-list">${Object.entries(facilityNames).map(([key,name])=>`<label><input type="checkbox" data-facility="${key}" ${cfg.facilities?.[key]===false?'':'checked'}> ${name}</label>`).join('')}</div><label class="field facility-search">Find another facility<input id="facility-search" value="${esc(facilitySearch)}" placeholder="e.g. recycler, laboratory"></label>${matches.length?`<div class="facility-search-results">${matches.map(([key,name])=>btn('add-facility:'+key,'+ '+name)).join('')}</div>`:''}${added.length?`<div class="facility-extra"><small>Added to settlement</small>${added.map(key=>`<div class="line"><strong>${esc(extraFacilities[key]||key)}</strong>${btn('remove-facility:'+key,'Remove')}</div>`).join('')}</div>`:''}</details>`;}
function breakdown(s) {
  const r = ranking(s);
  return factors
    .map(
      (f, i) =>
        `${line(f, `${r.scores[i] === null ? "Unavailable" : Math.round(r.scores[i]) + " / 100"} · weight ${r.w[i]}`)}${bar(r.scores[i] ?? 0)}`,
    )
    .join("");
}
function coverage(s) {
  const r = ranking(s);
  return Math.round(r.coverage * 100) + "% of weighted criteria available";
}
function terrainText() {
  const t = current().terrain;
  return t
    ? `${fmt(t.height, 0)} m / ${fmt(t.slope)}°`
    : "Terrain samples unavailable";
}
function inspect() {
  const o = current(),
    power = o.power,
    fire = o.fires,
    other = sites.find((s) => s.id === compare) || sites[1];
  return `${btn("discover", "← Candidate sites", "back")}${label(site.country + " / Site inspection")}<h1>${site.name}</h1><small>${coords(site)}</small><p>${site.surface}. ${site.hazard}.</p><div class="actions">${btn("design", "Establish research habitat　→", "primary")}</div><h2>Site suitability</h2>${line(profiles[profile], (ranking(site).score ?? "—") + " / 100")}${aiPanel(site)}<details><summary>Scoring factors and comparison</summary><small>${coverage(site)} · relative suitability model</small>${breakdown(site)}${select(
    "compare",
    "Compare with",
    sites.filter((s) => s.id !== site.id).map((s) => s.name),
    other.name,
  )}${line(other.name, (ranking(other).score ?? "—") + " / 100")}${breakdown(other)}<small>Climate and solar use POWER normals. Geology, isolation and access are editorial estimates. Hazards require independent assessment.</small></details><h2>Environmental profile</h2><small>NASA POWER · Historical climatology, 2001–2025</small>${line("Annual mean temperature", fmt(annual(site, "T2M")) + " °C")}${line("Solar resource", fmt(annual(site, "ALLSKY_SFC_SW_DWN"), 2) + " kWh/m²/day")}${line("Precipitation", fmt(annual(site, "PRECTOTCORR"), 2) + " mm/day")}${line("Wind", fmt(annual(site, "WS2M")) + " m/s")}${line("Elevation / slope", terrainText())}<div class="pills">${btn("imagery", mapMode)}${btn("measure", "Measure distance")}${btn("move", "Choose deployment point")}</div><span class="note">${esc(measurement)}</span><details><summary>Recent surface readings</summary>${power?.values ? `<small>NASA POWER · ${esc(power.date)}</small>` + power.values.map((v) => line(esc(v.label), esc(v.value) + " " + esc(v.unit))).join("") : o.power === null ? "Daily readings unavailable." : "Retrieving NASA POWER readings…"}</details><details><summary>FireWatch and regional events</summary>${select("sensor", "FIRMS sensor", ["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"], sensor)}<p>${fire?.detections ? `${fire.detections.length} detections returned in the regional 10° window, last 24 hours.` : fire === null ? "FIRMS unavailable. A configured key and upstream access are required." : "Retrieving FIRMS observations…"}</p>${(
    fire?.detections ?? []
  )
    .slice(0, 12)
    .map((p) =>
      line(
        esc(p.date) + " " + esc(p.time) + " UTC",
        `${fmt(p.latitude, 2)}, ${fmt(p.longitude, 2)} · ${esc(p.confidence)}`,
      ),
    )
    .join(
      "",
    )}<small>Detection coverage varies. An empty result cannot establish site safety.</small><h3>EONET · within 500 km</h3>${o.events?.map((e) => line(esc(e.title), esc(e.date?.slice(0, 10)))).join("") ?? (o.events === null ? "Event feed unavailable." : "Retrieving events…")}${o.events?.length === 0 ? "No regional events returned." : ""}</details><details><summary>GroundTruth AI · Site evidence</summary><a href="${site.source}" target="_blank" rel="noopener">Field research reference ↗</a>${select("research-type", "Evidence collection", ["Studies", "Operations", "News", "Logistics"], researchType)}<label class="field">Research question<input id="research" maxlength="170" value="${esc(research)}" placeholder="Why test rovers at this site?"></label>${btn("research", "Search evidence")}${researchResults.map((r) => `<p><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a><br>${esc(r.snippet)}<br><small>${esc(r.source)} · ${esc(r.category || researchType)} · ${esc(r.date || "Date unavailable")}</small></p>`).join("")}</details>`;
}
function design() {
  return `${btn("inspect", "← Site inspection", "back")}${mission ? btn("control", "Open mission control") : ""}${label("MF-001 / Mission design")}<h1>Configure expedition</h1><p>${site.name} · ${coords(site)}</p>${aiRankings.has(site.id)?line('AI site match', aiRankings.get(site.id).score+' / 100 · '+esc(aiRankings.get(site.id).modelVersion)):''}<form id="config"><div class="fields">${num("crew", "Crew members", cfg.crew, 1, 12)}${num("days", "Duration (sols)", cfg.days, 3, 30)}${select("mode", "Environment", ["Earth analog test", "Moon projection", "Mars projection"], cfg.mode)}${select("objective", "Objective", ["Habitat endurance and rover exploration", "Geological survey", "Crew survival", "Equipment reliability"], cfg.objective)}</div><details open><summary>Habitat and equipment</summary><div class="fields">${[
    ["array", "Array rating (kW)", 1, 40],
    ["battery", "Battery capacity (kWh)", 1, 300],
    ["load", "Habitat load (kW)", 0.1, 10],
    ["water", "Water (L)", 1, 700],
    ["oxygen", "Oxygen (kg)", 1, 300],
    ["food", "Food (kg)", 0, 1000],
    ["parts", "Repair spares", 0, 20],
    ["medkits", "Medical kits", 0, 30],
    ["regolith", "Packed regolith (kg)", 0, 200],
    ["components", "Fabrication components", 0, 100],
  ]
    .map(([id, l, min, max]) =>
      num(id, l, cfg[id], min, max, id === "load" ? 0.1 : 1),
    )
    .join(
      "",
    )}</div>${["rover", "backup"].map((k) => `<label><input id="${k}" type="checkbox" ${cfg[k] ? "checked" : ""}> ${k === "rover" ? "Robotic rover" : "Backup power"}</label>　`).join("")}</details>${facilityControls()}${crewManifest()}<small>Solar input ${fmt(annual(site, "ALLSKY_SFC_SW_DWN") ?? 5, 2)} kWh/m²/day · ${annual(site, "ALLSKY_SFC_SW_DWN") === null ? "demo assumption" : "POWER climatology"}. Mars projection scales available solar energy.</small><div class="actions"><button class="primary" type="submit">Launch mission　→</button></div></form>`;
}
function crewManifest(){
  return `<details><summary>Crew manifest · ${cfg.crew} people</summary><p class="note">Personal details remain in this browser. Baseline pulse and sleep targets adjust the training display; this is not a medical prediction.</p>${cfg.crewMembers.slice(0,cfg.crew).map((person,i)=>`<fieldset class="crew-person"><legend>Person ${i+1}</legend><label class="field">Name<input data-crew="${i}:name" maxlength="70" value="${esc(person.name)}"></label>${select('role'+i,'Role',roles,cfg.roles[i])}<div class="fields">${[['age','Age (years)',18,100,1],['heightCm','Height (cm)',100,230,1],['weightKg','Weight (kg)',30,250,.1],['baselinePulse','Resting pulse (bpm)',35,130,1],['sleepHours','Sleep target (hours)',3,12,.5]].map(([key,title,min,max,step])=>`<label class="field">${title}<input type="number" data-crew="${i}:${key}" min="${min}" max="${max}" step="${step}" value="${esc(person[key]??'')}"></label>`).join('')}</div><label class="field">Operational notes<input data-crew="${i}:notes" maxlength="180" value="${esc(person.notes||'')}"></label></fieldset>`).join('')}</details>`;
}
const metrics = (m) =>
  Object.entries(m.resources)
    .map(
      ([k, v]) =>
        `<div class="metric"><small>${resourceName[k]}</small><b>${fmt(v)} <small>${units[k]}</small></b>${bar((v / m.initial[k]) * 100)}</div>`,
    )
    .join("");
function spark(vals) {
  if (vals.length < 2) return "<small>Collecting samples</small>";
  const data = vals.slice(-36),
    lo = Math.min(...data) - 1,
    hi = Math.max(...data) + 1;
  return `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="Trend from ${fmt(data[0])} to ${fmt(data.at(-1))}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${data.map((v, i) => `${(i * 119) / (data.length - 1)},${26 - ((v - lo) / (hi - lo)) * 24}`).join(" ")}"/></svg>`;
}
function pulseMonitor(m, i) {
  const v = vitals(m, i),
    alert = v.status !== "Nominal",
    live = page === "control" && playing && m.outcome === "In progress";
  const beat = "l 11 0 3 -2 4 2 4 0 2 4 3 -22 3 33 3 -17 3 2 4 0 4 -4 5 4 11 0";
  return `<section class="pulse-monitor ${alert ? "attention" : ""}"><header><small>ASTRA / SUIT TELEMETRY</small><small>${live ? "STREAMING" : "HOLD"} · SIMULATED</small></header><div class="pulse-body"><div><strong>${v.pulse}</strong><small>BPM</small></div><svg viewBox="0 0 260 64" role="img" aria-label="Synthetic heartbeat at ${v.pulse} beats per minute"><g style="--beat:${60 / v.pulse}s;animation-play-state:${live ? "running" : "paused"}"><path d="M0 33 ${Array(7).fill(beat).join(" ")}"/></g></svg></div><footer><b>${v.name}</b><span>SpO₂ ${v.spo2}%　·　${v.status}</span></footer></section>`;
}
function crewControls(m) {
  prepareDuties(m);
  crewIndex = Math.min(crewIndex, m.cfg.crew - 1);
  const duty = m.duties[crewIndex],
    station = stations[duty.key];
  return `<section class="crew-ops"><h2>Crew operations</h2><div class="fields">${select("operator", "Astronaut", crewNames(), crewName(crewIndex))}${select(
    "workorder",
    "Assignment",
    Object.values(stations).map((s) => s.task),
    station.task,
  )}</div><div class="pills crew-locations">${crewNames().map((name, index) =>
    `<button type="button" data-act="locate-crew:${index}" aria-label="Find ${esc(name)}">${esc(name)}</button>`).join("")}</div>${line(station.name, dutyPose(m, crewIndex).status)}<div class="actions pills">${btn("helmet", "Helmet view")}${btn("follow", "Follow astronaut")}${m.cfg.rover ? btn("followRover", "Follow rover") : ""}${btn("overviewCamera", "Station overview")}</div></section>`;
}
function workTotals(m) {
  prepareDuties(m);
  return (
    "<h2>Station output</h2>" +
    line(
      "Material stocks",
      fmt(m.inventory.regolith, 0) +
        " kg regolith / " +
        m.inventory.components +
        " components",
    ) +
    line("Greenhouse construction", m.construction + "/4 sections") +
    '<p class="note">Mine 8 kg → fabricate a component using 2 kWh → build a section. Four sections complete the greenhouse.</p>' +
    Object.entries(stations)
      .map(([k, s]) =>
        line(
          s.output,
          fmt(m.production[k], k === "water" ? 2 : 0) + " " + s.unit,
        ),
      )
      .join("")
  );
}
function astra(m) {
  return `<h2>ASTRA crew health</h2>${pulseMonitor(m, Math.min(crewIndex, m.cfg.crew - 1))}<small>Simulated training telemetry · ${m.medkits} medical kits</small>${crewNames()
    .map((_, i) => {
      const v = vitals(m, i);
      return `<details ${i === 0 ? "open" : ""}><summary>${v.name} · ${v.status}</summary><p>${v.role}</p>${line("Heart rate / SpO₂", `${v.pulse} bpm / ${v.spo2}%`)}${line("Temperature / hydration", `${v.temp} °C / ${v.hydration}%`)}${line("Activity", dutyPose(m, i).status)}${line("Stress estimate", v.status === "Nominal" ? "Baseline" : "Elevated")}${line("Fatigue / sleep", `${v.fatigue}% / ${v.sleep} h`)}${i === 0 ? spark(m.history.map((x) => x.hr)) : ""}</details>`;
    })
    .join("")}`;
}
function groundTruth() {
  return (
    '<details class="mission-groundtruth"><summary>GroundTruth AI · Mission evidence</summary><p class="note">Search context includes the site, active incidents and selected crew telemetry. Evidence supports training decisions.</p><label class="field">Question<input id="gt-question" value="' +
    esc(groundQuestion) +
    '" maxlength="180" placeholder="How does dust affect solar output?"></label>' +
    btn("groundtruth", "Investigate with GroundTruth AI") +
    '<div id="gt-results" role="status">' +
    gtAnswer +
    "</div></details>"
  );
}
let inspectedEquipment = 'solar';
let replayFrame = null;
function updateWeatherLayer() {
  const layer = app.querySelector('.weather-layer');
  if (!layer) return;
  if (page !== 'control' || !mission) {
    layer.style.opacity = '0';
    return;
  }
  const sample = replayFrame ? { ...mission, environment: replayFrame.environment } : mission;
  const w = weather(sample);
  const wind = w.moon ? 0 : Math.max(sample.manualStorm ? 35 : 0, sample.environment.wind ?? 0);
  layer.style.opacity = String(Math.min(.8, w.dust * (w.moon ? .28 : .7)));
  layer.style.animationDuration = Math.max(.4, 3 - wind / 20) + 's';
  layer.style.animationPlayState = w.moon || replayFrame ? 'paused' : 'running';
}
function replayControls(m) {
  const choices = (m.checkpoints ?? []).map((frame, index) =>
    '<option value="' + index + '"' + (frame === replayFrame ? ' selected' : '') + '>+' +
    fmt(frame.h, 1) + ' h · ' + esc(frame.label) + '</option>').join('');
  if (!choices) return '';
  return '<details><summary>Historical event replay</summary><label class="field">Checkpoint<select id="engineering-replay"><option value="">Live mission</option>' +
    choices + '</select></label>' + (replayFrame ? line('Replayed battery / spares', fmt(replayFrame.battery, 1) + ' kWh / ' + replayFrame.parts) : '') + '</details>';
}
function environmentControls() {
  const m = mission;
  const sample = replayFrame ? { ...m, environment: replayFrame.environment } : m;
  const env = sample.environment;
  const w = weather(sample);
  const fields = [
    ['temperature', 'Temperature °C', -180, 130, 1, env.temperature],
    ...(!w.moon ? [['wind', 'Wind m/s', 0, 60, 1, env.wind]] : []),
    ['dust', w.moon ? 'Local dust disturbance %' : 'Suspended dust scenario %', 0, 100, 1, env.dust],
    ...(!w.moon && !w.mars ? [['humidity', 'Relative humidity %', 0, 100, 1, env.humidity ?? 35], ['cloud', 'Cloud cover %', 0, 100, 1, env.cloud ?? 0]] : []),
    ['radiation', 'Exposure rate mSv/day', 0, 5, .1, env.radiation],
  ];
  return `<details open><summary>Weather and exposure</summary>
    <p class="note">Editable scenario inputs · ${w.moon ? 'Vacuum and local dust' : 'Representative surface pressure'}</p>
    ${line('Pressure', w.pressure + ' kPa')}${line('Dust optical depth', fmt(w.tau, 2))}
    ${line('Relative solar transmission', fmt(w.transmission * 100, 1) + '%')}
    ${fields.map(([key, title, min, max, step, value]) => `<label class="field">${title}<input type="range" ${replayFrame ? 'disabled' : ''} data-environment="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${value}</output></label>`).join('')}</details>`;
}
function engineeringControls(m) {
  const ids = equipmentIds(m);
  const id = ids.includes(inspectedEquipment) ? inspectedEquipment : 'solar';
  const c = condition(m, id);
  const [name, material] = equipment[id];
  const plan = maintenancePlan(m, id);
  const rate = exposureRates(m, id);
  const possible = plan && m.parts >= plan.parts && m.outcome === 'In progress';
  const status = unavailable(m, id) ? 'Offline' : c.dust >= .15 || damage(c) >= .15 ? 'Degraded' : 'Operational';
  return `<details open><summary>Materials and maintenance</summary>
    <div class="pills">${ids.map(key => btn('inspect-equipment:' + key, equipment[key][0])).join('')}</div>
    <h3>${name}</h3><p>${material} · ${status}</p>
    ${line('Condition · starting 100%', fmt(100 * (1 - damage(c)), 1) + '%')}
    ${line('Surface coverage', fmt(100 * c.dust, 1) + '%')}
    ${line('Exposure duration', fmt(c.hours, 1) + ' h')}
    ${line('Damage rate', fmt((rate.wear + rate.fatigue + rate.corrosion) * 100, 4) + ' percentage points/h')}
    ${id === 'rover' ? line('Steel bearing proxy strength', fmt(roverSteel.predictedMpa, 0) + ' MPa') +
      line('Laboratory model test R² / RMSE', fmt(roverSteel.testR2, 4) + ' / ' + fmt(roverSteel.testRmseMpa, 1) + ' MPa') +
      line('Estimated fatigue per 24 h at current temperature', fmt(rate.fatigue * 2400, 4) + ' percentage points') : ''}
    ${line('Internal fatigue index', fmt(c.fatigue, 4))}
    ${line('Wear / corrosion indices', fmt(c.wear, 4) + ' / ' + fmt(c.corrosion, 4))}
    <p class="note">Provisional engineering estimates. Offline threshold is 80% modeled damage.</p>
    ${line('Available repair spares', m.parts)}
    ${plan ? line(plan.label, plan.parts + ' spares · ' + plan.hours + ' h') : ''}
    ${plan?.parts ? line('Repairs possible with current stock', Math.floor(m.parts / plan.parts)) : ''}
    ${possible ? btn('maintain:' + id, plan.label) : plan && m.parts < plan.parts ? '<p>Service blocked by insufficient spares.</p>' : ''}
    </details><details><summary>Energy and safety</summary>
    ${line('Generation / thermal demand', fmt(generation(m), 2) + ' / ' + fmt(thermalDemand(m), 2) + ' kW')}
    ${line('Battery history', spark(m.history.map(v => v.battery)))}
    ${line('Airlock seals', unavailable(m, 'oxygen') ? 'Pressure integrity at risk' : 'Available')}
    ${line('Thermal regulation', unavailable(m, 'thermal') ? 'Modeled failure' : 'Available')}
    ${line('External exposure', fmt(m.environment.radiation, 2) + ' mSv/day scenario')}
    ${line('Dust contamination', weather(m).dust >= .45 ? 'Elevated' : 'Low')}
    ${line('Life support reserve', m.resources.oxygen > 0 && m.resources.battery > 0 ? 'Available' : 'Depleted')}
    ${line('Research load', m.powerLimited ? 'Shed to protect essential loads' : 'Available')}
    ${line('Backup energy', fmt(m.backup, 1) + ' kWh')}
    </details>`;
}
function missionOverview(m){
  const crew=crewNames().map((name,i)=>{
    const v=vitals(m,i),safe=v.status==='Nominal';
    return `<div class="status-row"><div><strong>${esc(name)}</strong><small>${esc(v.status)} · ${v.pulse} bpm · SpO₂ ${v.spo2}%</small></div>${bar(Math.min(100,v.spo2))}</div>`;
  }).join('');
  const equipment=[['Habitat',m.integrity??100,m.active.oxygen?'Oxygen failure':'Operational'],['Solar array',Math.round(100*(1-damage(condition(m,"solar")))),unavailable(m,"solar")?'Array failure':'Operational'],['Rover',Math.round(100*(1-damage(condition(m,"rover")))),unavailable(m,"rover")?'Disabled':m.cfg.rover?'Operational':'Not deployed']].filter(([name])=>name!=='Rover'||m.cfg.rover)
    .map(([name,value,status])=>`<div class="status-row"><div><strong>${name}</strong><small>${status}</small></div>${bar(value)}</div>`).join('');
  const facilities=Object.entries(facilityNames).filter(([key])=>m.cfg.facilities?.[key]!==false).map(([key,name])=>`<span class="status-chip">${esc(name)}</span>`).join('');
  return `<section class="mission-status"><h2>Mission status</h2><details open><summary>Health and people · ${m.cfg.crew}</summary>${crew}</details><details open><summary>Buildings and equipment</summary>${equipment}</details><details open><summary>Active facilities</summary><div class="status-chips">${facilities}</div></details></section>`;
}
function control() {
  const m = mission;
  prepareDuties(m);
  return `${btn("mission-back", "← Back")}${label("MF-001 / Mission control")}<h1>${site.id === "atacama" ? "Atacama Habitat Expedition" : site.name + " Expedition"}</h1><p>${m.cfg.mode} · ${m.cfg.crew} crew · ${m.cfg.days} sols</p>${line("Mission clock", `SOL ${Math.floor(m.h / SOL) + 1} · ${fmt(m.h, 1)} h elapsed`)}${line("Settlement uptime", `<span data-uptime>${uptimeLabel(m)}</span>`)}<div class="actions pills">${btn("play", playing ? "Pause" : "Resume")}${btn("hour", "+1 hour")}${btn("sol", "+1 sol")}${select('sim-speed','Clock rate',[1,2,3,4,10,50].map(x=>x+'×'),speed+'×')}${btn("report", "View report ↗")}${btn("inspect", "Site data")}${btn("design", "Plan another mission")}${btn("retry", "Relaunch expedition")}${btn("sound", localStorage.getItem("mf-sound") === "on" ? "Sound on" : "Sound off")}</div><small>1× = 0.1 simulated hour per 3 seconds; rates are relative training speeds.</small>${missionOverview(m)}${environmentControls()}${engineeringControls(replayFrame ? { ...m, ...replayFrame, outcome: "Replay" } : m)}${replayControls(m)}${facilityControls()}${crewControls(m)}<div class="metrics">${metrics(m)}</div><div class="pills">${["Systems", "ASTRA", "Log"].map((t) => btn("tab:" + t, (t === tab ? "● " : "") + t)).join("")}</div>${Object.keys(
    m.active,
  )
    .map(
      (id) =>
        `<div class="alert"><strong>${failures[id][0]}</strong>${btn("investigate:" + id, "Investigate with GroundTruth AI")}<p>${id === "medical" ? esc(m.health) + " · K. Rivera" : "System affected"}</p><div class="pills">${failures[
          id
        ]
          .slice(1)
          .map((v, i) => btn("response:" + id + ":" + (i + 1), v))
          .join("")}</div></div>`,
    )
    .join(
      "",
    )}${tab === "ASTRA" ? astra(m) : tab === "Log" ? timeline(m) : `${workTotals(m)}<h2>Surface systems</h2>${line("Solar generation", fmt(generation(m), 2) + " kW mean")}${line("Habitat demand", fmt(thermalDemand(m), 2) + " kW")}${line('Scenario gravity',fmt(surfaceGravity(m.cfg.mode),2)+' m/s² · projected on Earth terrain')}${line('Crew radiation dose',fmt(m.crewDose??0,3)+' mSv simulated')}${line('Surface travel',m.active.storm?'Paused by dust':(m.environment?.wind??0)>=25?'Paused by wind':'Available')}${line("Rover", m.cfg.rover ? (m.active.rover ? "Disabled" : m.traverse ? "Traversing" : "Parked") + " · " + fmt(m.km) + " km" : "Not deployed")}${line("Rover battery", m.cfg.rover ? fmt(((m.roverEnergy ?? 2.4) / 2.4) * 100, 0) + "%" : "Not deployed")}${line("Habitat integrity", fmt(m.integrity ?? 100, 1) + "%")}${line("Communications", m.active.comms ? "Interrupted" : "Online")}${line("Repair inventory", m.parts + " spares")}${m.cfg.rover ? btn("traverse", m.traverse ? "Park rover" : "Begin rover traverse") : ""}`}${groundTruth()}<h2>Scenario controls</h2><div class="fields">${select(
    "incident",
    "Inject failure",
    Object.entries(failures)
      .filter(([k]) => k !== "rover" || cfg.rover)
      .map(([, v]) => v[0]),
    failures[incident][0],
  )}${incident === "medical" ? select("medical", "Training scenario", medicalCases, medical) : ""}</div>${btn("inject", "Trigger incident")}${select("camera", "Camera preset", ["Overview", "Habitat", ...(cfg.rover ? ["Rover"] : []), "Helmet", "Follow crew", "Tactical"], cameraPreset)}${select("quality", "Render quality", ["Performance", "Balanced", "High"], quality)}<small>Simulated systems · ${m.outcome}</small>`;
}
function timeline(m) {
  return `<h2>Incident timeline</h2>${m.logs
    .slice()
    .reverse()
    .map((l) => line(esc(l.msg), fmt(l.h) + " h"))
    .join("")}`;
}
function report() {
  const m = mission;
  return `<article class="sheet">${label("MF-001 / After-action report")}<h1>${site.name} expedition</h1><p>${esc(m.cfg.objective)} · ${m.cfg.mode} · ${m.cfg.crew} crew</p>${line("Mission outcome", m.outcome)}${line("Elapsed / planned duration", fmt(m.h / SOL, 2) + " / " + m.cfg.days + " sols")}${line("Rover operations", fmt(m.km, 2) + " km")}${line("Energy generated / used", fmt(m.generated) + " / " + fmt(m.used) + " kWh")}${line("Objective status", m.outcome === "Planned duration reached" && (!/rover|geolog/i.test(m.cfg.objective) || m.km > 0) ? "Achieved" : "Open")}${workTotals(m)}<h2>Resource balance</h2><table><thead><tr><th>Reserve</th><th>Initial</th><th>Final</th><th>Net change</th></tr></thead><tbody>${Object.entries(
    m.resources,
  )
    .map(
      ([k, v]) =>
        `<tr><td>${resourceName[k]} (${units[k]})</td><td>${fmt(m.initial[k])}</td><td>${fmt(v)}</td><td>${fmt(v - m.initial[k])}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${line("Battery trend", spark(m.history.map((v) => v.battery)))}${timeline(m)}${astra(m)}<p>Deterministic training model. Mean daily irradiance, constant crew demand and simplified health relationships. Planetary exposure and equipment failure coefficients are provisional scenario estimates.</p><div class="actions">${btn("export", "Export report", "primary")}${btn("control", "Return to mission")}${btn("retry", "Retry mission")}${btn("design", "Revise configuration")}${btn("discover", "Compare another site")}</div></article>`;
}
function render() {
  const mode = page === "control";
  document.body.classList.toggle("dark", mode);
  document.title = "MissionForge | " + ({past:'Past missions',explorer:'Site explorer',discover:'Site atlas',travel:'Travel planning',inspect:site.name,design:'Mission planning',control:'Mission simulation',report:'After-action report',research:'GroundTruth research'}[page]||'Explorer');
  const activeTab=page==='inspect'?'discover':['design','control','report'].includes(page)?'mission':page;
  const content = { past:pastMissions, explorer:siteExplorer, discover, inspect, design, control, travel:travelHtml, research:researchPanel, report }[page] || discover;
  if(!app.querySelector('.workspace')){
    const tabs=[['past','Past missions'],['discover','Sites'],['travel','Travel'],['mission','Mission'],['research','GroundTruth']];
    app.innerHTML=`<section class="workspace" style="--drawer-width:${drawerWidth}px"><nav class="tab-rail" aria-label="Workspace tabs">${tabs.map(([id,name])=>`<button type="button" data-workspace="${id}" title="${name}" aria-label="${name}">${name}</button>`).join('')}<a class="earth-viewer-link" href="/orbit.html">Earth Viewer ↗</a></nav><div class="panel-drawer"><div class="drawer-head"><span id="drawer-title"></span><button type="button" data-drawer="toggle" aria-label="Minimize panel">−</button></div><div class="panel"></div><div class="drawer-resize" role="separator" aria-label="Resize side panel" aria-orientation="vertical" tabindex="0"></div></div><button class="drawer-reopen" type="button" data-drawer="toggle" aria-label="Open panel">☰</button>${viewport()}</section>`;
    app.querySelector('.viewport').prepend(atlas);
    app.querySelector('.viewport').insertAdjacentHTML('beforeend','<div class="weather-layer" aria-hidden="true"></div>');
    atlas.hidden=false;
  }
  const workspace=app.querySelector('.workspace');
  workspace.classList.toggle('drawer-closed',!drawerOpen);
  workspace.style.setProperty('--drawer-width',drawerWidth+'px');
  app.querySelector('#drawer-title').textContent='MISSIONFORGE / '+page.toUpperCase();
  app.querySelectorAll('[data-workspace]').forEach(button=>button.classList.toggle('selected',button.dataset.workspace===activeTab));
  update();
}
function update() {
  const panel = app.querySelector(".panel");
  if (!panel) {
    render();
    return;
  }
  const content = { past:pastMissions, explorer:siteExplorer, discover, inspect, design, control, travel:travelHtml, research:researchPanel, report }[page] || discover;
  morphdom(panel, '<div class="panel">' + content() + "</div>", {
    onBeforeElUpdated(oldEl, newEl) {
      if (oldEl.tagName === "DETAILS") newEl.open = oldEl.open;
      if (
        oldEl === document.activeElement &&
        ["INPUT", "SELECT"].includes(oldEl.tagName)
      )
        return false;
      return !oldEl.isEqualNode(newEl);
    },
  });
  const lens = app.querySelector(".crew-lens");
  if (lens) lens.innerHTML = lensContent();
  updateWeatherLayer();
  const hud = app.querySelector("#mission-hud");
  const orbitControls = app.querySelector(".mission-orbit-controls");
  if (orbitControls) orbitControls.hidden = page !== "control";
  if (hud) {
    hud.hidden = page !== "control" || !mission;
    if (!hud.hidden) hud.innerHTML = missionHud(mission);
  }
  const sceneNote = app.querySelector(".scene-note");
  if (equip) {
    const el = sceneNote ?? document.createElement("div");
    el.className = "scene-note";
    el.textContent = equip;
    app.querySelector(".viewport").append(el);
  }
}
let missionReturnPage = "design";
function go(name) {
  if (name === "mission") name = "design";
  if (name === "control" && !["control", "report"].includes(page)) missionReturnPage = page;
  replayFrame = null;
  const hash = "#" + name;
  if (location.hash !== hash) history.pushState(null, "", hash);
  route();
}
function displayScene() {
  if (!scene) return;
  if (["past", "discover", "research"].includes(page)) scene.overview();
  else if (page === 'travel') { scene.overview(); if(trip.stops.length)scene.showRoute(routePoints()); }
  else if (page === "inspect") scene.inspect(site);
  else if(page==='design')scene.preview(site);
  else if (page === "control") {
    scene.place(site, cfg);
    scene.setFacilities(cfg.facilities || {});
    scene.sync(mission, playing ? speed : 0);
  }
}

function route() {
  const target = location.hash.slice(1);
  page = target==='explorer'?'discover':[
    "past",
    "explorer",
    "travel",
    "research",
    "discover",
    "inspect",
    "design",
    "control",
    "report",
  ].includes(target)
    ? target
    : target === "mission"
      ? "design"
      : "discover";
  if (!mission && ["control", "report"].includes(page)) page = "design";
  if (page !== "control") {
    scene?.detach();
    cameraPreset = "Overview";
  }
  if (mission && ["control", "report"].includes(page)) {
    site = mission.cfg.site;
    cfg = { ...cfg, ...structuredClone(mission.cfg), food: mission.cfg.food ?? cfg.food, medkits: mission.cfg.medkits ?? cfg.medkits, regolith:mission.cfg.regolith??cfg.regolith, components:mission.cfg.components??cfg.components };
  }
  if(page==='travel'){ensureScoutedSite(site);loadSeason(site,cache[site.id]).then(()=>{if(page==='travel')update()});}
  equip = "";
  replayFrame = null;
  render();
  app.querySelector('.panel').scrollTop=0;
  displayScene();
  if (page === "inspect") loadObs();
  window.scrollTo(0, 0);
}
function choose(s) {
  site = s;
  compare =
    sites.find((x) => x.id !== s.id && x.id === "iceland")?.id ?? sites[0].id;
  measurement = "";
  researchResults = [];
  save();
  go("inspect");
}
function dist(a, b) {
  const rad = Math.PI / 180,
    d = (b.lat - a.lat) * rad,
    l = (b.lon - a.lon) * rad;
  return (
    12742 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(d / 2) ** 2 +
            Math.cos(a.lat * rad) *
              Math.cos(b.lat * rad) *
              Math.sin(l / 2) ** 2,
        ),
      ),
    )
  );
}
async function loadObs() {
  const s = site,
    version = ++observationVersion,
    key = s.id,
    qs = `lat=${s.lat}&lon=${s.lon}`;
  let o = obs.get(key);
  if (!o) {
    o = {};
    obs.set(key, o);
  }
  const tasks = {
    ...(s.id.startsWith("point-") && !cache[s.id]
      ? {
          climate: async () =>
            (cache[s.id] = await json("/api/analog/climate?" + qs)),
        }
      : {}),
    power: () => json("/api/nasa/power?" + qs),
    fires: () => json("/api/nasa/fires?" + qs + "&sensor=" + sensor),
    events: async () =>
      (await json("/api/nasa/events")).events.filter(
        (e) => dist(s, { lat: e.latitude, lon: e.longitude }) <= 500,
      ),
    terrain: () => scene?.terrain(s),
  };
  await Promise.all(
    Object.entries(tasks).map(async ([k, fn]) => {
      if (o[k] !== undefined && k !== "terrain") return;
      let result;
      try {
        result = (await fn()) ?? null;
      } catch {
        result = null;
      }
      if (version !== observationVersion) return;
      o[k] = result;
      if (page === "inspect" && site.id === key) {
        if (k === "fires") scene?.fire(result?.detections ?? []);
        if (
          !app.contains(document.activeElement) ||
          document.activeElement.tagName !== "INPUT"
        )
          update();
      }
    }),
  );
  if (page === "inspect" && site.id === key && version === observationVersion)
    scene?.fire(o.fires?.detections ?? []);
}
function launch() {
  gtAnswer = "";
  groundQuestion = "";
  incident = "solar";
  crewIndex = 0;
  cameraPreset = "Overview";
  cfg = {
    ...cfg,
    site: { ...site },
    profile: profiles[profile],
    sun: annual(site, "ALLSKY_SFC_SW_DWN") ?? 5,
  };
  const expedition = start(cfg);
  mission = expedition;
  mission.startedAt = Date.now();
  playing = true;
  tab = "Systems";
  save();
  // The Blender launch film plays from the copy cached when the site opened.
  launchSequence().catch(() => {});
  go("control");
}
function tick(h) {
  if(!mission)return;
  advance(mission, h);
  if (mission.outcome !== "In progress") playing = false;
  if(page==='control' && !replayFrame)scene?.sync(mission, playing ? speed : 0);
  save();
  if(['control','past'].includes(page))update();
}
app.addEventListener("submit", (e) => {
  if (e.target.id === "config") {
    e.preventDefault();
    launch();
  }
});
app.addEventListener("input", (e) => {
  if(e.target.id==='facility-search'){facilitySearch=e.target.value;const box=e.target.closest('details');const results=box.querySelector('.facility-search-results');if(results)results.remove();const matches=Object.entries(extraFacilities).filter(([key,name])=>!(cfg.addedFacilities||[]).includes(key)&&facilitySearch&&name.toLowerCase().includes(facilitySearch.toLowerCase()));if(matches.length)e.target.closest('label').insertAdjacentHTML('afterend',`<div class="facility-search-results">${matches.map(([key,name])=>btn('add-facility:'+key,'+ '+name)).join('')}</div>`);return;}
  if(e.target.dataset.trip==='originQuery'||e.target.dataset.waypointQuery!==undefined||e.target.dataset.stop?.endsWith(':query')){changeTrip(e.target);return;}
  if (e.target.dataset.environment && mission && !replayFrame) {
    mission.environment[e.target.dataset.environment] = Number(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    scene?.sync(mission, playing ? speed : 0);
    updateWeatherLayer();
    return;
  }
  if (e.target.id === "gt-question") groundQuestion = e.target.value;
  if (e.target.id === "query") {
    query = e.target.value;
    const count = query.match(
      /\b(one|two|three|four|five|six|[1-6])[- ](?:person|crew|astronaut)/i,
    );
    if (count)
      cfg.crew =
        Number(count[1]) ||
        ["one", "two", "three", "four", "five", "six"].indexOf(
          count[1].toLowerCase(),
        ) + 1;
    profile = interpret(query, profile);
    document.querySelector("#profile").value = profiles[profile];
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const list = document.querySelector("#rankings");
      if (list) list.innerHTML = rows();
    }, 100);
  }
});
app.addEventListener("change", (e) => {
  const { id, value, checked } = e.target;
  if(e.target.dataset.crew){const [index,key]=e.target.dataset.crew.split(':');const person=cfg.crewMembers[Number(index)];if(!person)return;if(e.target.type==='number'&&value!==''&&!e.target.checkValidity())return;person[key]=e.target.type==='number'?(value===''?'':Number(value)):value.trim();save();update();return;}
  if(id==='analog-body'){analogBody=value;runBackendAnalogs();update();return;}
  if(id==='sim-speed'){speed=Number(value.replace('×',''));save();update();return;}
  if(e.target.dataset.explorer){explorerValues[e.target.dataset.explorer]=value===''?'':Number(value);localStorage.setItem('mf-explorer-inputs',JSON.stringify(explorerValues));scheduleAiRefresh();scheduleAnalogRun();update();return;}
  if(e.target.dataset.trip || e.target.dataset.stop || e.target.dataset.leg!==undefined || e.target.dataset.waypointQuery!==undefined){changeTrip(e.target);if(e.target.dataset.trip==='originQuery'||e.target.dataset.waypointQuery!==undefined||e.target.dataset.stop?.endsWith(':query'))return;update();return;}
  if(e.target.dataset.facility){cfg.facilities??={};cfg.facilities[e.target.dataset.facility]=checked;if(e.target.dataset.facility==='rover'){cfg.rover=checked;if(mission)mission.cfg.rover=checked;}if(mission)mission.cfg.facilities=structuredClone(cfg.facilities);scene?.setFacilities(cfg.facilities);save();update();return;}
  if (e.target.id === 'engineering-replay' && mission) {
    replayFrame = value === '' ? null : mission.checkpoints?.[Number(value)] ?? null;
    if (replayFrame) { playing = false; save(); }
    scene?.sync(replayFrame ? { ...mission, ...replayFrame } : mission, replayFrame ? 0 : playing ? speed : 0);
    update();
    return;
  }
  if (e.target.dataset.environment && mission && !replayFrame) {
    mission.environment[e.target.dataset.environment] = Number(value);
    recordCheckpoint(mission, 'Scenario adjusted · ' + e.target.dataset.environment);
    scene?.sync(mission, playing ? speed : 0);
    save();
    update();
    return;
  }
  if(id==='temperature-filter'){filterTemp=value;update();return;}
  if(id==='mineral-filter'){filterMineral=value;update();return;}
  if (page === "design") {
    if (id.startsWith("role")) cfg.roles[Number(id.slice(4))] = value;
    else if (["rover", "backup"].includes(id)) cfg[id] = checked;
    else if (["mode", "objective"].includes(id)) cfg[id] = value;
    else if (e.target.checkValidity()) cfg[id] = Number(value);
    else return;
    save();
    if (id === "crew") ensureCrew();
    if (id === "crew" || id === "rover") {
      update();
      displayScene();
    }
    return;
  }
  if (id === "research-type") {
    researchType = value;
    researchResults = [];
    update();
    return;
  }
  if (id === "sort") {
    sortBy = value;
    update();
    return;
  }
  if (id === "query") return;
  if (id === "profile") profile = profiles.indexOf(value);
  if (id === "priority")
    priority = ["Standard", "Double", "Triple"].indexOf(value) + 1;
  if (id === "compare") compare = sites.find((s) => s.name === value).id;
  if (id === "incident")
    incident = Object.keys(failures).find((k) => failures[k][0] === value);
  if (id === "medical") medical = value;
  if (id === "sensor") {
    sensor = value;
    delete current().fires;
    loadObs();
  }
  if (id === "operator") {
    crewIndex = Math.max(0,crewNames().indexOf(value));
    if (["Helmet", "Follow crew"].includes(cameraPreset))
      scene?.view(cameraPreset, crewIndex);
    update();
    return;
  }
  if (id === "workorder") {
    const key = Object.keys(stations).find((k) => stations[k].task === value);
    if (assignDuty(mission, crewIndex, key)) {
      log(mission, crewName(crewIndex) + " assigned to " + stations[key].name);
      scene?.sync(mission, playing ? speed : 0);
      save();
    }
    update();
    return;
  }
  if (id === "quality") {
    applyQuality(value);
    return;
  }
  if (id === "camera") {
    cameraPreset = value;
    scene?.view(value, crewIndex);
    update();
    return;
  }
  if (id === "research") {
    research = value;
    return;
  }
  update();
});
app.addEventListener("click", async (e) => {
  const workspace = e.target.closest('[data-workspace]');
  if (workspace) {
    e.preventDefault();
    go(workspace.dataset.workspace);
    return;
  }
  const drawer=e.target.closest('[data-drawer]');if(drawer){setDrawerOpen(!drawerOpen);return;}
  const prompt=e.target.closest('[data-research-prompt]');if(prompt){researchQuestion=prompt.dataset.researchPrompt+' at '+site.name;update();app.querySelector('#research-question')?.focus();return;}
  const travel=e.target.closest('[data-travel]');if(travel){await travelAction(travel.dataset.travel,site,points=>scene?.showRoute(points));update();if(page==='travel'&&/^(select|remove)/.test(travel.dataset.travel))scene?.showRoute(routePoints());return;}
  const button = e.target.closest("[data-act]");
  if (!button) return;
  e.preventDefault();
  const [act, id, ix] = button.dataset.act.split(":");
  if (act === "mission-back") return go(missionReturnPage);
  if (act === "orbit-left" || act === "orbit-right") {
    cameraPreset = "Overview";
    scene?.orbit(act === "orbit-left" ? -1 : 1);
    update();
    return;
  }
  if (act === "locate-crew" && mission) {
    crewIndex = Number(id);
    cameraPreset = "Follow crew";
    scene?.view(cameraPreset, crewIndex);
    update();
    return;
  }
  if (act === 'inspect-equipment') {
    inspectedEquipment = id;
    update();
    return;
  }
  if (act === 'maintain' && mission && !replayFrame) {
    toast(maintain(mission, id, advance, log));
    if (mission.outcome !== 'In progress') playing = false;
    scene?.sync(mission, playing ? speed : 0);
    save();
    update();
    return;
  }
  if(act==='resume-mission'){const entry=missionHistory.find(x=>x.id===id);if(!entry?.snapshot)return;mission=entry.snapshot;playing=entry.playing&&mission.outcome==='In progress';speed=entry.speed||1;site=mission.cfg.site;cfg=structuredClone(mission.cfg);save();go('control');return;}
  if(act==='end-mission'){
    const entry=missionHistory.find(x=>x.id===id);
    if(!entry?.snapshot||entry.outcome!=='In progress')return;
    entry.snapshot.outcome='Ended by operator';
    log(entry.snapshot,'Mission ended by operator.');
    entry.outcome=entry.snapshot.outcome;entry.logs=entry.snapshot.logs.slice(-80);entry.playing=false;
    if(mission?.id===id){mission=entry.snapshot;playing=false;scene?.sync(mission,0);}
    save();update();return;
  }
  if(act==='add-facility'){cfg.addedFacilities??=[];if(extraFacilities[id]&&!cfg.addedFacilities.includes(id))cfg.addedFacilities.push(id);facilitySearch='';const field=app.querySelector('#facility-search');if(field)field.value='';if(mission&&page==='control')mission.cfg.addedFacilities=[...cfg.addedFacilities];save();update();if(page==='control')displayScene();return;}
  if(act==='remove-facility'){cfg.addedFacilities=(cfg.addedFacilities||[]).filter(x=>x!==id);if(mission&&page==='control')mission.cfg.addedFacilities=[...cfg.addedFacilities];save();update();if(page==='control')displayScene();return;}
  if(act==='archive-site'){const archived=missionHistory.find(x=>x.site?.id===id);const selected=sites.find(x=>x.id===id)||archived?.site;if(selected)choose(selected);return;}
  if(act==='save-explorer'){localStorage.setItem('mf-explorer-inputs',JSON.stringify(explorerValues));refreshAiRankings();toast('Site inputs saved for AI integration');update();return;}
  if(act==='refresh-ai'){refreshAiRankings();return;}
  if(act==='refresh-analogs'){runBackendAnalogs();return;}
  if(act==='clear-explorer'){explorerValues={};localStorage.removeItem('mf-explorer-inputs');update();return;}
  if(act==='ask-research'){
    researchQuestion=document.querySelector('#research-question')?.value.trim()||'';
    if(!researchQuestion)return toast('Enter a research question');
    researchAnswer='<p>Searching cited sources…</p>';update();
    try{const result=await json('/api/analog/ask?q='+encodeURIComponent(researchQuestion.slice(0,200)));const paragraphs=(result.answer||'').split(/\n\s*\n/).filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join('');researchAnswer=`<section class="research-brief"><h3>${esc(result.answerType||'Source answer')}</h3>${paragraphs||'<p>The search returned no answer text. Review the linked sources below.</p>'}</section>`+(result.sources||[]).map(r=>`<article><small>${esc(r.source)}</small><h3><a target="_blank" rel="noopener" href="${esc(r.link)}">${esc(r.title)} ↗</a></h3><p>${esc(r.snippet)}</p></article>`).join('');}catch(error){researchAnswer=`<p class="empty-card">${error.message==='missing_key'?'Add SERPAPI_KEY to .env.local and restart the server.':'Source search is temporarily unavailable. Please retry.'}</p>`;}update();return;
  }
  if (act === "followRover") {
    if (!cfg.rover) return toast("No rover is deployed");
    cameraPreset = "Rover";
    scene?.view("Rover", crewIndex);
    update();
    return;
  }
  if (["helmet", "follow", "overviewCamera"].includes(act)) {
    cameraPreset = {
      helmet: "Helmet",
      follow: "Follow crew",
      overviewCamera: "Overview",
    }[act];
    scene?.view(cameraPreset, crewIndex);
    update();
    return;
  }
  if (
    ["past", "explorer", "mission", "travel", "research", "discover", "inspect", "design", "control", "report"].includes(act)
  )
    return go(act);
  if (act === "skip") {
    scene?.skip();
    return;
  }
  if (act === "site") return choose(sites.find((s) => s.id === id));
  if (act === "zoomIn" || act === "zoomOut")
    return scene?.zoom(act === "zoomIn" ? 1 : -1);
  if (act === "move") {
    if (!scene) return toast("Earth viewer unavailable");
    toast("Select a nearby deployment point");
    return scene.pick((lon, lat) => {
      if (dist(site, { lon, lat }) > 10)
        return toast("Select a point within 10 km of this site");
      site = { ...site, lon, lat };
      measurement =
        "Deployment point updated. Climate normals describe the regional catalog point.";
      obs.delete(site.id);
      save();
      go("inspect");
    });
  }
  if (act === "manual") {
    if (!scene) return toast("Earth viewer unavailable");
    toast("Select a point on the globe");
    return scene.pick((lon, lat) =>
      choose({
        id: "point-" + lat.toFixed(4) + "-" + lon.toFixed(4),
        name: "Selected field point",
        country: "User defined",
        lat,
        lon,
        type: "Unassessed terrain",
        surface: "Surface classification unavailable",
        hazard: "Local hazards unassessed",
        source: "https://power.larc.nasa.gov/",
      }),
    );
  }
  if (act === "measure") {
    toast("Select a second point on the globe");
    return scene?.pick((lon, lat) => {
      measurement =
        fmt(dist(site, { lon, lat }), 2) +
        " km from site · great-circle estimate";
      update();
    });
  }
  if (act === "imagery") {
    mapMode = scene?.imagery() ? "Detail imagery" : "Blue Marble";
    return update();
  }
  if (act === "research") {
    research = document.querySelector("#research").value;
    const active = site.id;
    button.disabled = true;
    try {
      const r = await json(
        "/api/research/" +
          {
            Studies: "site",
            Operations: "incident",
            News: "news",
            Logistics: "logistics",
          }[researchType] +
          "?q=" +
          encodeURIComponent(
            (site.name + " " + (research || "Mars analog research")).slice(
              0,
              200,
            ),
          ),
      );
      if (site.id === active) {
        researchResults = r.results;
        update();
        if (!r.results.length) toast("No matching publications found");
      }
    } catch {
      toast(
        "Online search unavailable. Use the linked field research reference.",
      );
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (act === "investigate") {
    const box = document.querySelector("#gt-results").closest("details");
    box.open = true;
    document.querySelector("#gt-question").value = groundQuestion =
      "What evidence explains " +
      failures[id][0] +
      " in this training scenario?";
    if (id === "medical") crewIndex = 0;
    box.scrollIntoView({ block: "center" });
    box.querySelector("button").click();
    return;
  }
  if (act === "groundtruth") {
    const output = document.querySelector("#gt-results"),
      question = document.querySelector("#gt-question").value.trim();
    if(!question)return toast('Enter a question');
    const v = vitals(mission, crewIndex),
      incidents = Object.keys(mission.active).join(" ");
    const context = [site.name,mission.cfg.mode,incidents,mission.health||'',question].filter(Boolean).join(' ').slice(0,200);
    output.textContent = "Searching…";
    button.disabled = true;
    try {
      const r = await json('/api/analog/ask?q='+encodeURIComponent(context));
      output.innerHTML = `<p class="note">${esc(v.name)} · ${v.pulse} BPM · SpO₂ ${v.spo2}% · ${esc(mission.cfg.mode)}</p><h3>${esc(r.answerType||'Answer')}</h3>${(r.answer||'No answer text returned.').split(/\n\s*\n/).filter(Boolean).map(text=>`<p>${esc(text)}</p>`).join('')}${(r.sources||[]).map(x=>`<article><a target="_blank" rel="noopener" href="${esc(x.link)}">${esc(x.title)} ↗</a><p>${esc(x.snippet)}</p><small>${esc(x.source)}</small></article>`).join('')}`;
    } catch {
      output.textContent =
        "GroundTruth search unavailable. Internal mission responses remain available.";
    } finally {
      gtAnswer = output.innerHTML;
      button.disabled = false;
    }
    return;
  }
  if (!mission) return;
  if (act === "retry") return launch();
  if (replayFrame && ['play', 'hour', 'sol', 'inject', 'response', 'traverse'].includes(act)) {
    toast('Return to the live mission to change operations');
    return;
  }
  if (act === "play") playing = !playing && mission.outcome === "In progress";
  if (act === "hour" || act === "sol") return tick(act === "hour" ? 1 : SOL);
  if (act === "tab") tab = id;
  if (act === "traverse") {
    if (
      mission.active.rover ||
      mission.active.storm ||
      mission.outcome !== "In progress"
    )
      return toast("Traverse unavailable");
    mission.traverse = !mission.traverse;
    log(mission, mission.traverse ? "Rover traverse started" : "Rover parked");
  }
  if (act === "sound") {
    toggleSound();
    update();
    return;
  }
  if (act === "inject") {
    gtAnswer = "";
    if (incident === "storm" && weather(mission).moon)
      return toast("Atmospheric dust storms are unavailable on the Moon. Use local dust disturbance.");

    if (!inject(mission, incident, medical))
      return toast("Incident unavailable or already active");
    toast(failures[incident][0] + " triggered");
    cue(incident === "medical" ? 740 : 320, 0.35);
    if (incident === "medical") tab = "ASTRA";
  }
  if (act === "response") {
    const error = respond(mission, id, Number(ix));
    if (error) toast(error);
  }
  if (act === "export") {
    const data = {
      ...mission,
      elapsedSols: mission.h / SOL,
      resourceChange: Object.fromEntries(
        Object.keys(mission.resources).map((k) => [
          k,
          mission.resources[k] - mission.initial[k],
        ]),
      ),
      crewSummary: crewNames()
        .map((_, i) => vitals(mission, i)),
      assumptions:
        "Simplified deterministic training simulation; see SIMULATION_ASSUMPTIONS.md",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "MF-001-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  scene?.sync(mission, playing ? speed : 0);
  save();
  update();
});
const BASE_DRAWER_WIDTH=390;
function setDrawerOpen(open){
  drawerOpen=open;
  if(open)drawerWidth=BASE_DRAWER_WIDTH;
  const workspace=app.querySelector('.workspace');
  workspace?.classList.toggle('drawer-closed',!open);
  workspace?.style.setProperty('--drawer-width',drawerWidth+'px');
  localStorage.setItem('mf-drawer-width',String(drawerWidth));
  requestAnimationFrame(()=>{scene?.resize();if(page==='control'&&cameraPreset==='Overview')scene.view('Overview');});
}
let dragStart=null;
app.addEventListener('pointerdown',e=>{if(!e.target.closest('.drawer-resize'))return;dragStart={pointerId:e.pointerId,x:e.clientX,width:drawerWidth,workspace:app.querySelector('.workspace'),close:false};app.setPointerCapture(e.pointerId);e.preventDefault();});
app.addEventListener('pointermove',e=>{if(!dragStart||e.pointerId!==dragStart.pointerId)return;const next=dragStart.width+e.clientX-dragStart.x;dragStart.close=next<190;drawerWidth=Math.max(210,Math.min(innerWidth-130,next));dragStart.workspace.style.setProperty('--drawer-width',drawerWidth+'px');scene?.resize();});
function finishDrawerDrag(e){if(!dragStart||e.pointerId!==dragStart.pointerId)return;if(dragStart.close)setDrawerOpen(false);else{localStorage.setItem('mf-drawer-width',String(drawerWidth));if(page==='control'&&cameraPreset==='Overview')scene?.view('Overview');}dragStart=null;}
app.addEventListener('pointerup',finishDrawerDrag);
app.addEventListener('pointercancel',finishDrawerDrag);
app.addEventListener('keydown',e=>{if(!e.target.matches('.drawer-resize'))return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=drawerWidth+(e.key==='ArrowRight'?24:-24);if(next<190)setDrawerOpen(false);else{drawerWidth=Math.max(210,Math.min(innerWidth-130,next));app.querySelector('.workspace')?.style.setProperty('--drawer-width',drawerWidth+'px');localStorage.setItem('mf-drawer-width',String(drawerWidth));}}});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ["Helmet", "Follow crew"].includes(cameraPreset)) {
    cameraPreset = "Overview";
    scene?.view(cameraPreset);
    update();
  }
});
window.addEventListener("hashchange", route);
route();
// Cache the launch film and habitat models on first load.
cacheFilm();
refreshAiRankings();
runBackendAnalogs();
loadRates().then(()=>{if(page==='travel')update();});
try {
  const { createScene } = await import("./scene.js");
  scene = createScene((id) => {
    const s = sites.find((x) => x.id === id);
    if (s) return choose(s);
    if (page === "control" && /^crew[0-9]+$/.test(id)) {
      crewIndex = Number(id.slice(4));
      if (["Helmet", "Follow crew"].includes(cameraPreset))
        scene?.view(cameraPreset, crewIndex);
    }
    inspectedEquipment = equipmentForModel(id) ?? inspectedEquipment;
    equip = id.startsWith("crew")
      ? crewName(Number(id.slice(4))) + " · " + cfg.roles[Number(id.slice(4))]
      : id.startsWith("Solar")
        ? "Solar array · " + cfg.array + " kW installed"
        : id === "Rover"
          ? "Robotic exploration rover"
          : id;
    update();
  });
  document.querySelector("#map-status")?.remove();
  const qualityBar = document.createElement("div");
  qualityBar.className = "atlas-quality";
  qualityBar.setAttribute("role", "group");
  qualityBar.setAttribute("aria-label", "Render quality");
  const qualityLabel = document.createElement("span");
  qualityLabel.textContent = "Quality";
  qualityBar.append(qualityLabel);
  for (const mode of ["Performance", "Balanced", "High"]) {
    const option = document.createElement("button");
    option.type = "button";
    option.dataset.mode = mode;
    option.textContent = mode;
    option.setAttribute("aria-pressed", String(mode === quality));
    option.onclick = () => { applyQuality(mode); update(); };
    qualityBar.append(option);
  }
  atlas.append(qualityBar);
  applyQuality(quality);
  displayScene();
} catch (err) {
  console.error("Earth initialization", err);
  document.querySelector("#map-status").textContent =
    "3D Earth unavailable · WebGL 2 required";
}
setInterval(() => {
  const el = document.querySelector('[data-uptime]');
  if (el && mission && mission.outcome === 'In progress') el.textContent = uptimeLabel(mission);
}, 1000);
let previousFrame=Date.now();
setInterval(() => {
  const now=Date.now(),hours=Math.max(0,now-previousFrame)/3000*.1;previousFrame=now;
  if(playing&&mission?.outcome==='In progress')tick(hours*speed);
  let changed=false;
  for(const entry of missionHistory){if(entry.id===mission?.id||!entry.playing||entry.snapshot?.outcome!=='In progress')continue;advance(entry.snapshot,hours*(entry.speed||1));entry.h=entry.snapshot.h;entry.outcome=entry.snapshot.outcome;entry.resources=entry.snapshot.resources;entry.logs=entry.snapshot.logs.slice(-80);entry.parts=entry.snapshot.parts;entry.medkits=entry.snapshot.medkits;entry.playing=entry.outcome==='In progress';changed=true}
  if(changed)try{localStorage.setItem('mf-mission-history',JSON.stringify(missionHistory));localStorage.setItem('mf-sim-session',JSON.stringify({playing,speed,savedAt:now}))}catch{}
  if(page==='past')update();
}, 3000);
