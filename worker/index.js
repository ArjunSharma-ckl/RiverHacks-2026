import { createApi } from '../server/nasa-api.js';

// The Node server and the Worker share the same API implementation. This
// adapter gives Cloudflare's Fetch API the tiny req/res surface that the
// existing handlers expect, so every route (NASA, SerpApi, research) behaves
// the same in production and in local development.
let api;

function handlerFor(env) {
  api ??= createApi(env);
  return api;
}

async function apiResponse(request, env) {
  const url = new URL(request.url);
  const headers = new Headers();
  const chunks = [];
  let status = 200;
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    writeHead(code, values = {}) {
      res.statusCode = code;
      status = code;
      for (const [name, value] of Object.entries(values)) headers.set(name, String(value));
      return res;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(chunk);
    }
  };
  const req = {
    method: request.method,
    url: url.pathname.replace(/^\/api/, '') + url.search,
    headers: Object.fromEntries(request.headers.entries())
  };
  try {
    await handlerFor(env)(req, res);
  } catch (error) {
    console.error('api error', error);
    res.statusCode = 503;
    status = 503;
    if (!chunks.length) chunks.push(JSON.stringify({ error: 'upstream unavailable' }));
  }
  const body = chunks.length
    ? typeof chunks[0] === 'string'
      ? chunks.join('')
      : chunks[0]
    : null;
  return new Response(body, { status: res.statusCode || status, headers });
}

// Edge-cache lifetimes for the shared API routes. NASA and SerpApi responses
// change on their own cadence, so the Worker caches them per colo instead of
// asking upstream for every visitor.
const API_TTL = [
  [/^\/(events|event)$/, 300],
  [/^\/thermal$/, 600],
  [/^\/hotspot$/, 1800],
  [/^\/satellite$/, 1800],
  [/^\/place$/, 1800],
  [/^\/nasa\/images$/, 86400],
  [/^\/nasa\/power$/, 3600],
  [/^\/nasa\/spaceweather$/, 900],
  [/^\/nasa\/(fires|apod)$/, 900],
  [/^\/object$/, 1800]
];

function ttlFor(pathname) {
  const path = pathname.replace(/^\/api/, '');
  for (const [pattern, ttl] of API_TTL) if (pattern.test(path)) return ttl;
  return 600;
}

async function apiCached(request, env, ctx) {
  if (request.method !== 'GET') return apiResponse(request, env);
  const cache = caches.default;
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await apiResponse(request, env);
  if (response.status === 200 && ctx?.waitUntil) {
    const headers = new Headers(response.headers);
    const ttl = ttlFor(new URL(request.url).pathname);
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.delete('Set-Cookie');
    ctx.waitUntil(cache.put(key, new Response(response.clone().body, { status: 200, headers })));
  }
  return response;
}

function cached(response, pathname) {
  if (!response.ok || response.status === 206) return response;
  const headers = new Headers(response.headers);
  if (/^\/(assets|models|textures|data|cinematics)\//.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (pathname.startsWith('/cesium/')) {
    headers.set('Cache-Control', 'public, max-age=604800');
  } else if (pathname === '/' || pathname.endsWith('.html')) {
    headers.set('Cache-Control', 'no-cache');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.pathname.startsWith('/api/')) return apiCached(request, env, ctx);
    const response = await env.ASSETS.fetch(request);
    return cached(response, url.pathname);
  }
};
