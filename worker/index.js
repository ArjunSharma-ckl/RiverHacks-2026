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

function cached(response, pathname) {
  if (!response.ok || response.status === 206) return response;
  const headers = new Headers(response.headers);
  if (/^\/(assets|models|textures)\//.test(pathname)) {
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.pathname.startsWith('/api/')) return apiResponse(request, env);
    const response = await env.ASSETS.fetch(request);
    return cached(response, url.pathname);
  }
};
