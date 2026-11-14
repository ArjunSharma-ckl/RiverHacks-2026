// Production server for Render: serves the built client and the /api routes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createApi } from './nasa-api.js';

const ROOT = resolve('dist');
const PORT = Number(process.env.PORT) || 10000;
const api = createApi(process.env);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

async function sendFile(res, path, immutable) {
  const body = await readFile(path);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('ok');
    }

    if (url.pathname.startsWith('/api/')) {
      req.url = url.pathname.slice('/api'.length) + url.search;
      return await api(req, res);
    }

    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const target = join(ROOT, requested);
    if (!target.startsWith(ROOT + sep) && target !== ROOT) {
      res.statusCode = 403;
      return res.end('forbidden');
    }

    try {
      await sendFile(res, target, requested.includes('/assets/') || requested.startsWith('/cesium/'));
    } catch {
      // Unknown paths fall back to the single page.
      await sendFile(res, join(ROOT, 'index.html'), false);
    }
  } catch {
    res.statusCode = 500;
    res.end('server error');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on :${PORT}`);
});
