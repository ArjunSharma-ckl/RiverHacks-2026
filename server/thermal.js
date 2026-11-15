const root = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/';
export async function thermalPoints(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      Math.abs(Date.now()-Date.parse(date)) > 7*86400000) throw new Error('Unsupported date');
  const recent = Date.now()-Date.parse(date) < 48*3600000;
  const response = await fetch(root+'J1_VIIRS_C2_Global_'+(recent?'48h':'7d')+'.csv',
    {signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error('FIRMS unavailable');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '', columns;
  const points = [];
  function read(line) {
    const cells = line.trim().split(',');
    if (!columns) {
      columns = Object.fromEntries(cells.map((name,i)=>[name,i]));
      if (columns.daynight === undefined) throw new Error('Invalid FIRMS response');
    } else if (cells[columns.acq_date] === date && cells[columns.daynight] === 'D') {
      points.push(['latitude','longitude','acq_time','bright_ti4','frp','confidence'].map(k=>cells[columns[k]]));
    }
  }
  while (true) {
    const {value,done} = await reader.read();
    if (done) break;
    const lines = (pending+value).split('\n');
    pending = lines.pop();
    for (const line of lines) read(line);
  }
  if (pending) read(pending);
  return {date,points};
}
