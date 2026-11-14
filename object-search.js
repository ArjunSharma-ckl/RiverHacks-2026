import { loadEnv } from 'vite';

const subjects = new Set(['Aqua satellite', 'Hubble Space Telescope', 'Moon', 'Mars', 'Jupiter', 'Sun', 'Earth', 'Sirius', 'Vega', 'Arcturus']);
const cache = new Map();

export function objectSearch() {
  const key = loadEnv('development', process.cwd(), 'SERPAPI_').SERPAPI_KEY;
  async function search(engine, query) {
    const params = new URLSearchParams({ engine, q: query, api_key: key });
    const response = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('Search unavailable');
    const data = await response.json();
    if (data.error) throw new Error('Search unavailable');
    return data;
  }
  function configure(server) {
    server.middlewares.use('/api/object', async (req, res) => {
      const name = new URL(req.url, 'http://localhost').searchParams.get('name');
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'GET' || !subjects.has(name)) {
        res.statusCode = 400;
        return res.end('{}');
      }
      try {
        if (!key) throw new Error('Missing key');
        if (!cache.has(name)) {
          const query = name + ' NASA astronomy';
          cache.set(name, Promise.all([search('google', query), search('google_images', query)]).then(([web, images]) => ({
            article: web.organic_results?.find(item => item.snippet && item.link?.startsWith('https://')),
            photos: (images.images_results || []).filter(item => item.thumbnail?.startsWith('https://') && item.link?.startsWith('https://')).slice(0, 4).map(({ thumbnail, title, link }) => ({ thumbnail, title, link }))
          })));
        }
        res.end(JSON.stringify(await cache.get(name)));
      } catch {
        cache.delete(name);
        res.statusCode = 503;
        res.end('{}');
      }
    });
  }
  return { name: 'object-search', configureServer: configure, configurePreviewServer: configure };
}

