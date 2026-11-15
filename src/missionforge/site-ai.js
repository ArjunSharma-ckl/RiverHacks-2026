export const SITE_FEATURES = [
  ['olivine','Olivine'],
  ['plagioclase','Plagioclase'],
  ['lowCalciumPyroxene','Low calcium pyroxene'],
  ['highCalciumPyroxene','High calcium pyroxene'],
  ['smfe','SMFe'],
  ['roughness','Terrain roughness'],
  ['surfaceTemperature','Surface temperature'],
];

// Contract for a future ranking service. Missing measurements stay null.
export function parseSiteRankings(payload, knownIds) {
  if(payload?.version!==1||!Array.isArray(payload.results))return new Map();
  const result=new Map();
  for(const row of payload.results){
    if(!knownIds.has(row?.siteId)||!Number.isFinite(row.score)||row.score<0||row.score>100)continue;
    const features=Object.fromEntries(SITE_FEATURES.map(([key])=>[key,Number.isFinite(row.features?.[key])?row.features[key]:null]));
    result.set(row.siteId,{score:row.score,features,modelVersion:String(payload.modelVersion||'unversioned')});
  }
  return result;
}

export function siteAiRequest(values){
  return {version:1,target:Object.fromEntries(SITE_FEATURES.map(([key])=>[key,Number.isFinite(values[key])?values[key]:null]))};
}
