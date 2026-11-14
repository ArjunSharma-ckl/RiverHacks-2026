import sharp from 'sharp';
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
  try {
    for (let depth = 0; depth <= Math.min(8, level); depth++) {
      const scale = 2 ** depth;
      const url = new URL(service + '/tile/' + [level-depth, Math.floor(row/scale), Math.floor(column/scale)].join('/'));
      url.searchParams.set('blankTile','false');
      if (env.ARCGIS_API_KEY) url.searchParams.set('token', env.ARCGIS_API_KEY);
      const response = await fetch(url, {signal:AbortSignal.timeout(10000)});
      if (response.status === 404 || response.headers.get('blank-tile') === 'true') continue;
      const type = response.headers.get('content-type');
      if (!response.ok || !type?.startsWith('image/')) throw new Error('Tile unavailable');
      let image = Buffer.from(await response.arrayBuffer());
      if (depth) {
        const size = 256 / scale;
        image = await sharp(image).extract({left:(column%scale)*size,top:(row%scale)*size,width:size,height:size})
          .resize(256,256).jpeg().toBuffer();
      }
      res.writeHead(200, {'Content-Type':depth ? 'image/jpeg' : type, 'Cache-Control':'private, max-age=3600',
        'X-Imagery-Level':String(level-depth)}).end(image);
      return;
    }
    res.writeHead(404).end();
  } catch {
    res.writeHead(502).end();
  }
}
