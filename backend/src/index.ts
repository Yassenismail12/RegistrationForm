
interface Env {
  WORKER_ALLOWED_ORIGIN?: string;
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  TURNSTILE_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

const DEFAULT_ORIGIN = 'https://registration-form.pages.dev';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_REQUESTS = 30;
const SUBMISSION_CACHE_TTL = 60 * 15; // 15 minutes
const PAGE_DATA_CACHE_TTL = 60 * 60 * 6; // 6 hours
const IMAGE_CACHE_TTL = 60 * 60 * 24; // 24 hours
function toEnglishNumbers(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}
const PAGE_DATA = {
  governorates: [
    'القاهرة','الجيزة','الإسكندرية','الدقهلية','البحيرة',
    'الفيوم','الغربية','الإسماعيلية','المنوفية','المنيا',
    'القليوبية','الوادي الجديد','السويس','أسوان','أسيوط',
    'بني سويف','بورسعيد','دمياط','الشرقية','جنوب سيناء',
    'كفر الشيخ','مطروح','الأقصر','قنا','شمال سيناء','سوهاج','البحر الأحمر',
  ],
  studyYears: ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','خريج'],
  howKnowAboutUs: ['الأصدقاء', 'فيسبوك', 'إنستجرام', 'تيكتوك', 'تويتر', 'لينكد ان', 'الاشرينج', 'اخرى'],
};

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
  const { turnstileToken, ...formFields } = body;

  // Normalize numeric fields
  formFields.nationalId = toEnglishNumbers(String(formFields.nationalId ?? ''));
  formFields.whatsapp   = toEnglishNumbers(String(formFields.whatsapp   ?? ''));

  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/applicants?key=${env.FIREBASE_API_KEY}`;
  const payload = {
    fields: firestoreFieldsFromObject({
      ...formFields,          // ✅ formFields not body — no turnstileToken, normalized numbers
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

// ─── Supabase KV helpers ───────────────────────────────────────────────────────

async function supabaseGet(key: string, env: Env): Promise<any> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value,expires_at&limit=1`,
    { headers: supabaseHeaders(env) }
  );
  const rows: any[] = await res.json();
  if (!rows.length) return null;
  const row = rows[0];
  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await supabaseDelete(key, env); // clean up
    return null;
  }
  try { return JSON.parse(row.value); } catch { return row.value; }
}

async function supabaseSet(key: string, value: unknown, ttlSeconds: number | null, env: Env): Promise<void> {
  const expires_at = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
    : null;
  await fetch(`${env.SUPABASE_URL}/rest/v1/kv_store`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(env),
      'Prefer': 'resolution=merge-duplicates', // upsert
    },
    body: JSON.stringify({ key, value: JSON.stringify(value), expires_at }),
  });
}

async function supabaseDelete(key: string, env: Env): Promise<void> {
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: supabaseHeaders(env) }
  );
}

function supabaseHeaders(env: Env) {
  return {
    'Content-Type'  : 'application/json',
    'apikey'        : env.SUPABASE_SERVICE_KEY,
    'Authorization' : `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

async function rateLimit(clientId: string, env: Env): Promise<boolean> {
  const key     = `rate_limit:${clientId}`;
  const current = (await supabaseGet(key, env) as number) ?? 0;
  const count   = current + 1;
  await supabaseSet(key, count, RATE_LIMIT_WINDOW_SECONDS, env);
  return count <= RATE_LIMIT_REQUESTS;
}

async function cacheGet(key: string, env: Env): Promise<any> {
  return await supabaseGet(key, env);
}

async function cacheSet(key: string, value: unknown, ttl: number, env: Env): Promise<void> {
  await supabaseSet(key, value, ttl, env);
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
async function verifyTurnstile(token: string, ip: string, env: Env): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  });
  const data: any = await res.json();
  return data.success === true;
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

    if (path === '/api/page-data' && request.method === 'GET') {
      const cachedPageData = await cacheGet('page-data', env);
      if (cachedPageData) {
        logEvent('page_data_cached', { clientId, path });
        return jsonResponse(cachedPageData, 200, 'public, max-age=3600, stale-while-revalidate=3600', origin);
      }

      await cacheSet('page-data', PAGE_DATA, PAGE_DATA_CACHE_TTL, env);
      logEvent('page_data_served', { clientId, path, fromCache: false });
      return jsonResponse(PAGE_DATA, 200, 'public, max-age=3600, stale-while-revalidate=3600', origin);
    }

    if (path === '/api/register' && request.method === 'POST') {
  try {
    const body = (await request.json()) as Record<string, any>;
    logEvent('registration_request', { clientId, path, body });

    // ✅ ADD THIS BLOCK — Turnstile verification
    const { turnstileToken, ...formFields } = body;
    const valid = await verifyTurnstile(turnstileToken || '', clientIp, env);
    if (!valid) {
      return jsonResponse({ error: 'فشل التحقق، حاول مرة أخرى' }, 403, 'no-store', origin);
    }
    // ✅ END OF NEW BLOCK

    const firestoreResult: any = await saveToFirestore(formFields, env); // ← changed body to formFields
    const docId = firestoreResult?.name?.split('/').pop();

    if (docId) {
      await cacheSet(`submission:${docId}`, { ...formFields, submittedAt: new Date().toISOString() }, SUBMISSION_CACHE_TTL, env); // ← changed body to formFields
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
