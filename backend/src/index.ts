interface Env {
  KV: KVNamespace;
  WORKER_ALLOWED_ORIGIN?: string;
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
}

const DEFAULT_ORIGIN = 'https://<your-pages-subdomain>.pages.dev';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_REQUESTS = 30;
const SUBMISSION_CACHE_TTL = 60 * 15; // 15 minutes
const IMAGE_CACHE_TTL = 60 * 60 * 24; // 24 hours

function buildCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function buildCacheHeaders(cacheControl: string, contentType = 'application/json;charset=UTF-8') {
  return {
    'Cache-Control': cacheControl,
    'Content-Type': contentType,
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

function imageResponse(arrayBuffer: ArrayBuffer, contentType: string, cacheControl: string, origin: string) {
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      ...buildCacheHeaders(cacheControl, contentType),
      ...buildCorsHeaders(origin),
    },
  });
}

function logEvent(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...details }));
}

function firestoreFieldsFromObject(payload: Record<string, any>) {
  const fields: Record<string, { stringValue: string }> = {};
  for (const [key, value] of Object.entries(payload)) {
    fields[key] = { stringValue: String(value ?? '') };
  }
  return fields;
}

function parseFirestoreDocument(doc: any) {
  if (!doc?.fields) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc.fields)) {
    if (typeof value === 'object' && 'stringValue' in (value as any)) {
      result[key] = (value as any).stringValue;
    }
  }
  return result;
}

async function saveToFirestore(body: Record<string, any>, env: Env) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/applicants?key=${env.FIREBASE_API_KEY}`;
  const payload = {
    fields: firestoreFieldsFromObject({
      ...body,
      submittedAt: new Date().toISOString(),
      source: 'Cloudflare-Worker',
    }),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore save failed: ${res.status} ${text}`);
  }

  return await res.json();
}

async function getSubmissionFromFirestore(id: string, env: Env) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/applicants/${id}?key=${env.FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return parseFirestoreDocument(data);
}

async function rateLimit(clientId: string, env: Env) {
  const key = `rate_limit:${clientId}`;
  const current = await env.KV.get<number>(key, 'json');
  const count = (current ?? 0) + 1;
  await env.KV.put(key, JSON.stringify(count), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return count <= RATE_LIMIT_REQUESTS;
}

async function cacheGet(key: string, env: Env) {
  return await env.KV.get(key, 'json');
}

async function cacheSet(key: string, value: unknown, ttl: number, env: Env) {
  await env.KV.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getCachedImage(url: string, env: Env) {
  const cached = await cacheGet(`img:${url}`, env);
  return cached as { data: string; contentType: string } | null;
}

async function fetchAndCacheImage(url: string, env: Env) {
  const imageRes = await fetch(url);
  if (!imageRes.ok) {
    throw new Error(`Image fetch failed ${imageRes.status}`);
  }
  const contentType = imageRes.headers.get('Content-Type') || 'application/octet-stream';
  const buffer = new Uint8Array(await imageRes.arrayBuffer());
  const data = encodeBase64(buffer);
  await cacheSet(`img:${url}`, { data, contentType }, IMAGE_CACHE_TTL, env);
  return { data, contentType };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || env.WORKER_ALLOWED_ORIGIN || DEFAULT_ORIGIN;
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
    let allowed = true;

    try {
      allowed = await rateLimit(clientId, env);
    } catch (error) {
      logEvent('rate_limit_error', { clientId, error: String(error) });
    }

    if (!allowed) {
      logEvent('rate_limit_exceeded', { clientId, path });
      return jsonResponse({ error: 'Too many requests' }, 429, 'no-store', origin);
    }

    if (path === '/api/health' && request.method === 'GET') {
      logEvent('health_check', { clientId, path });
      return jsonResponse({ status: 'ok', ts: Date.now() }, 200, 'public, max-age=10, stale-while-revalidate=30', origin);
    }

    if (path === '/api/register' && request.method === 'POST') {
      try {
        const body = (await request.json()) as Record<string, any>;
        logEvent('registration_request', { clientId, path, body });
        const firestoreResult: any = await saveToFirestore(body, env);
        const docId = firestoreResult?.name?.split('/').pop();

        if (docId) {
          await cacheSet(`submission:${docId}`, { ...body, submittedAt: new Date().toISOString() }, SUBMISSION_CACHE_TTL, env);
        }

        return jsonResponse({
          success: true,
          message: 'Data saved to Firebase successfully!',
          id: docId,
        }, 200, 'no-store', origin);
      } catch (error) {
        logEvent('registration_error', { clientId, path, error: String(error) });
        return jsonResponse({ error: 'Failed to save data to Firebase', details: String(error) }, 400, 'no-store', origin);
      }
    }

    if (path.startsWith('/api/submission/') && request.method === 'GET') {
      const id = path.split('/').pop() || '';
      if (!id) {
        return jsonResponse({ error: 'Submission id required' }, 400, 'no-store', origin);
      }

      const cached = await cacheGet(`submission:${id}`, env);
      if (cached) {
        logEvent('submission_cached', { clientId, id });
        return jsonResponse({ id, cached }, 200, 'public, max-age=60', origin);
      }

      const submission = await getSubmissionFromFirestore(id, env);
      if (!submission) {
        return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);
      }

      await cacheSet(`submission:${id}`, submission, SUBMISSION_CACHE_TTL, env);
      return jsonResponse({ id, submission }, 200, 'public, max-age=60', origin);
    }

    if (path === '/api/optimize-image' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl || !/^https:/.test(targetUrl)) {
        return jsonResponse({ error: 'A secure https image URL is required.' }, 400, 'no-store', origin);
      }

      try {
        const cached = await getCachedImage(targetUrl, env);
        const imageRecord = cached || await fetchAndCacheImage(targetUrl, env);
        const bytes = decodeBase64(imageRecord.data);
        logEvent('image_served', { clientId, targetUrl, fromCache: Boolean(cached) });
        return imageResponse(bytes.buffer, imageRecord.contentType, 'public, max-age=86400, stale-while-revalidate=3600', origin);
      } catch (error) {
        logEvent('image_error', { clientId, targetUrl, error: String(error) });
        return jsonResponse({ error: 'Unable to optimize image', details: String(error) }, 500, 'no-store', origin);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);
  },
  
};
