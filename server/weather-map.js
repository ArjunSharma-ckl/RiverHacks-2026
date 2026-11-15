const fields = new Map([
  ['clouds', ['Total_cloud_cover_entire_atmosphere', 'seq-BuPu', '1,100']],
  ['precip', ['Precipitation_rate_surface', 'seq-YlGnBu', '0.00001,0.003']],
  ['cloudtop', ['Temperature_high_cloud_top_Mixed_intervals_Average', 'div-RdBu', '200,270']],
  ['vapor', ['Precipitable_water_entire_atmosphere_single_layer', 'seq-GnBu', '0,65']],
  ['temperature', ['Temperature_surface', 'div-BuRd', '235,315']]
]);

export async function weatherMap(params, res) {
  const field = fields.get(params.get('field'));
  const time = params.get('time');
  const ms = Date.parse(time);
  if (!field || !Number.isFinite(ms) || ms % 10800000 || Math.abs(Date.now() - ms) > 5 * 86400000) {
    res.statusCode = 400;
    return res.end('Invalid forecast request');
  }
  const [layers, palette, colorscalerange] = field;
  const grid = params.get('field') === 'clouds' ? 'Global_0p5deg' : 'Global_onedeg';
  const url = new URL('https://thredds.ucar.edu/thredds/wms/grib/NCEP/GFS/' + grid + '/Best');
  url.search = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', srs: 'EPSG:4326',
    bbox: '-180,-90,180,90', width: '720', height: '360', format: 'image/png',
    layers, styles: 'raster/' + palette, colorscalerange, time: new Date(ms).toISOString(),
    belowmincolor: ['clouds', 'precip'].includes(params.get('field')) ? 'transparent' : 'extend',
    abovemaxcolor: 'extend', transparent: 'true'
  }).toString();
  try {
    const reply = await fetch(url, { signal: AbortSignal.timeout(18000) });
    if (!reply.ok || !reply.headers.get('content-type')?.startsWith('image/png')) throw new Error();
    const bytes = new Uint8Array(await reply.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return res.end(bytes);
  } catch {
    res.statusCode = 503;
    return res.end('Forecast unavailable');
  }
}
