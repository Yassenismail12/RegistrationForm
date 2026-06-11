// Cloudflare Worker entrypoint for the backend API
interface Env {
  RATE_LIMIT_KV: KVNamespace;
  WORKER_ALLOWED_ORIGIN?: string;
}

const DEFAULT_ORIGIN = 'https://<your-pages-subdomain>.pages.dev';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_REQUESTS = 30;

function buildCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function buildCacheHeaders(cacheControl: string) {
  return {
    'Cache-Control': cacheControl,
    'Content-Type': 'application/json;charset=UTF-8',
  };
}

function jsonResponse(body: unknown, status = 200, cacheControl = 'no-store', origin = DEFAULT_ORIGIN) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCacheHeaders(cacheControl),
      ...buildCorsHeaders(origin),
    },
  });
}

function logEvent(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...details }));
}

async function rateLimit(clientId: string, env: Env) {
  const key = `rate_limit:${clientId}`;
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.RATE_LIMIT_KV.get(key);
  const current = existing ? Number(existing) : 0;

  if (current >= RATE_LIMIT_REQUESTS) {
    return false;
  }

  await env.RATE_LIMIT_KV.put(key, String(current + 1), {
    expiration: now + RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.WORKER_ALLOWED_ORIGIN ?? DEFAULT_ORIGIN;
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin),
      });
    }

    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anonymous';
    const clientId = `ip:${clientIp}`;
    const allowed = await rateLimit(clientId, env);

    if (!allowed) {
      logEvent('rate_limit_exceeded', { clientId, path });
      return jsonResponse({ error: 'Too many requests' }, 429, 'no-store', origin);
    }

    if (path === '/api/health' && request.method === 'GET') {
      logEvent('health_check', { clientId, path });
      return jsonResponse({ status: 'ok', ts: Date.now() }, 200, 'public, max-age=10, stale-while-revalidate=30', origin);
    }

    if (path === '/register' && request.method === 'POST') {
      try {
        const body = await request.json();
        logEvent('registration_request', { clientId, path, body });
        return jsonResponse({ success: true, received: body }, 200, 'no-store', origin);
      } catch (error) {
        logEvent('registration_error', { clientId, path, error: String(error) });
        return jsonResponse({ error: 'Invalid JSON payload' }, 400, 'no-store', origin);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);
  },
};
