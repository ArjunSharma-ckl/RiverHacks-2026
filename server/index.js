// Production server for Render: serves the built client and the /api routes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
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

// The client bundle is a few megabytes of Cesium; served raw it dominates
// load time on a small instance. Compress the text assets once and keep the
// compressed copies in memory - they are small, unlike the imagery.
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|xml|txt)$/i;
const compressedCache = new Map();

function encodingFor(path, accept = '') {
  if (!COMPRESSIBLE.test(path)) return undefined;
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return undefined;
}

async function bodyFor(path, encoding) {
  if (!encoding) return readFile(path);
  const key = `${path}|${encoding}`;
  const hit = compressedCache.get(key);
  if (hit && extname(path) !== '.html') return hit;
  const raw = await readFile(path);
  const body = encoding === 'br'
    ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })
    : gzipSync(raw, { level: 6 });
  compressedCache.set(key, body);
  return body;
}

async function sendFile(res, path, immutable, accept) {
  const encoding = encodingFor(path, accept);
  const body = await bodyFor(path, encoding);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  if (encoding) res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Length', body.length);
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
      await sendFile(res, target, requested.includes('/assets/') || requested.startsWith('/cesium/'), req.headers['accept-encoding']);
    } catch {
      // Unknown paths fall back to the single page.
      await sendFile(res, join(ROOT, 'index.html'), false, req.headers['accept-encoding']);
    }
  } catch {
    res.statusCode = 500;
    res.end('server error');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on :${PORT}`);
});
