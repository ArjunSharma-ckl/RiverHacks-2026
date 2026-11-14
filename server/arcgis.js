export async function imageryTile(req, res, env, pathname) {
  const tile = /^\/arcgis\/imagery\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})$/.exec(pathname);
  if (!tile || req.method !== 'GET') {
    res.writeHead(404).end();
    return;
  }
  const [level, row, column] = tile.slice(1).map(Number);
  if (level > 19 || Math.max(row, column) >= 2 ** level) {
    res.writeHead(400).end();
    return;
  }
  const service = env.ARCGIS_API_KEY
    ? 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const url = new URL(service + '/tile/' + [level, row, column].join('/'));
  if (env.ARCGIS_API_KEY) url.searchParams.set('token', env.ARCGIS_API_KEY);
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const type = upstream.headers.get('content-type');
    if (!upstream.ok || !type?.startsWith('image/')) throw new Error('Tile unavailable');
    const image = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' }).end(image);
  } catch {
    res.writeHead(502).end();
  }
}
