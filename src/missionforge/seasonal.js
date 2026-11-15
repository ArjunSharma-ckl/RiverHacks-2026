const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const KEYS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// NASA planetary temperature references set the coldness target. These are
// relative Earth field-season rankings, not a planetary environment prediction.
// Mars mean: -65 C; Moon nighttime: -153 C.
export const PLANET_REFERENCE = {Mars:{temperature:-65,span:90},Moon:{temperature:-153,span:165}};
export function climateScore({temperature, precipitation, wind, solar}, target) {
  if (![temperature, precipitation, wind].every(Number.isFinite)) return null;
  const reference = PLANET_REFERENCE[target] || PLANET_REFERENCE.Mars;
  const coldFit = Math.max(0, 1 - Math.abs(temperature - reference.temperature) / reference.span);
  const dryFit = Math.max(0, 1 - precipitation / 5);
  const windFit = target === 'Moon' ? Math.max(0, 1 - wind / 12) : Math.max(0, 1 - Math.abs(wind - 7) / 18);
  const sunFit = Number.isFinite(solar) ? Math.max(0, Math.min(1, solar / 5)) : null;
  return Math.round(100 * (sunFit===null?(0.5*coldFit+0.32*dryFit+0.18*windFit):(0.45*coldFit + 0.3*dryFit + 0.17*windFit + 0.08*sunFit)));
}

export function rankMonths(power, target) {
  const p = power?.properties?.parameter || {};
  return KEYS.map((key, index) => ({
    month: MONTHS[index],
    temperature: p.T2M?.[key], precipitation: p.PRECTOTCORR?.[key],
    wind: p.WS2M?.[key], solar: p.ALLSKY_SFC_SW_DWN?.[key],
    score: climateScore({temperature:p.T2M?.[key],precipitation:p.PRECTOTCORR?.[key],wind:p.WS2M?.[key],solar:p.ALLSKY_SFC_SW_DWN?.[key]}, target)
  })).filter(x=>x.score !== null).sort((a,b)=>b.score-a.score);
}

export function rankForecast(daily, target) {
  const dates=daily?.time||[];
  return dates.map((date,i)=>({date,temperature:daily.temperature_2m_mean?.[i],precipitation:daily.precipitation_sum?.[i],wind:(daily.wind_speed_10m_max?.[i]||0)/3.6}))
    .filter(x=>Number.isFinite(x.temperature)&&Number.isFinite(x.precipitation)&&Number.isFinite(x.wind))
    .map(x=>({...x,score:climateScore({...x,solar:null},target)}))
    .sort((a,b)=>b.score-a.score);
}
