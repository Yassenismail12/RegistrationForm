interface Env {
  WORKER_ALLOWED_ORIGIN?: string;
  DB: D1Database;
  TURNSTILE_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

type ApplicantPayload = {
  full_name: string;
  national_id: string;
  whatsapp: string;
  email: string | null;
  governorate: string | null;
  university: string | null;
  faculty: string | null;
  study_year: string | null;
  how_know_about_us: string | null;
  egyptian: boolean;
  source: string;
};

const DEFAULT_ORIGIN = 'https://registration-form.pages.dev';
const RATE_LIMIT_WINDOW_SECONDS = 60 * 10;
const RATE_LIMIT_REQUESTS = 3;
const SUBMISSION_CACHE_TTL = 60 * 15;
const PAGE_DATA_CACHE_TTL = 60 * 60 * 6;
const IMAGE_CACHE_TTL = 60 * 60 * 24;

const PAGE_DATA = {
  governorates: [
    'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحيرة',
    'الفيوم', 'الغربية', 'الإسماعيلية', 'المنوفية', 'المنيا',
    'القليوبية', 'الوادي الجديد', 'السويس', 'أسوان', 'أسيوط',
    'بني سويف', 'بورسعيد', 'دمياط', 'الشرقية', 'جنوب سيناء',
    'كفر الشيخ', 'مطروح', 'الأقصر', 'قنا', 'شمال سيناء', 'سوهاج', 'البحر الأحمر',
  ],
  studyYears: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'خريج'],
  howKnowAboutUs: ['الأصدقاء', 'فيسبوك', 'إنستجرام', 'تيكتوك', 'تويتر', 'لينكد ان', 'الشيرنج', 'اخرى'],
};

function toEnglishNumbers(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}
async function applicantExists(
  nationalId: string,
  env: Env
): Promise<boolean> {

  const row = await env.DB
    .prepare(`
      SELECT id
      FROM applicants
      WHERE national_id = ?
      LIMIT 1
    `)
    .bind(nationalId)
    .first();

  return !!row;
}

function isLegitimateRequest(request: Request, allowedOrigin: string): boolean {
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  const contentType = request.headers.get('Content-Type') || '';
  const userAgent = request.headers.get('User-Agent') || '';

  const originOk = origin === allowedOrigin || referer?.startsWith(allowedOrigin);
  const contentTypeOk = contentType.includes('application/json');
  const uaOk = userAgent.includes('Mozilla');

  return !!(originOk && contentTypeOk && uaOk);
}
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

function optionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function normalizeApplicantPayload(body: Record<string, any>): ApplicantPayload {
  return {
    full_name: String(body.full_name ?? '').trim(),
    national_id: toEnglishNumbers(String(body.national_id ?? '').trim()),
    whatsapp: toEnglishNumbers(String(body.whatsapp ?? '').trim()),
    email: optionalText(body.email),
    governorate: optionalText(body.governorate),
    university: optionalText(body.university),
    faculty: optionalText(body.faculty),
    study_year: optionalText(body.study_year),
    how_know_about_us: optionalText(body.how_know_about_us),
    egyptian: body.egyptian !== false,
    source: 'Cloudflare-Worker',
  };
}

function validateApplicantPayload(applicant: ApplicantPayload): string | null {
  if (!applicant.full_name) return 'full_name is required';
  if (!applicant.national_id) return 'national_id is required';
  if (!applicant.whatsapp) return 'whatsapp is required';
  if (applicant.egyptian && !/^[23][0-9]{13}$/.test(applicant.national_id)) {
    return 'national_id must be 14 digits and start with 2 or 3 for Egyptian applicants';
  }
  if (applicant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email)) {
    return 'email is invalid';
  }
  return null;
}

async function saveApplicantToD1(applicant: ApplicantPayload, env: Env) {
  return await env.DB.prepare(`
    INSERT INTO applicants (
      full_name,
      national_id,
      whatsapp,
      email,
      governorate,
      university,
      faculty,
      study_year,
      how_know_about_us,
      egyptian,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      applicant.full_name,
      applicant.national_id,
      applicant.whatsapp,
      applicant.email,
      applicant.governorate,
      applicant.university,
      applicant.faculty,
      applicant.study_year,
      applicant.how_know_about_us,
      applicant.egyptian ? 1 : 0,
      applicant.source
    )
    .run();
}

async function getSubmissionFromD1(id: string, env: Env) {
  return await env.DB.prepare('SELECT * FROM applicants WHERE id = ?').bind(id).first();
}

async function supabaseGet(key: string, env: Env): Promise<any> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value,expires_at&limit=1`,
    { headers: supabaseHeaders(env) }
  );
  const rows: any[] = await res.json();
  if (!rows.length) return null;
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await supabaseDelete(key, env);
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
      'Prefer': 'resolution=merge-duplicates',
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
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

// REPLACE this entire function
async function rateLimit(clientId: string, env: Env): Promise<boolean> {
  const key = `rate_limit:${clientId}`;
  const globalKey = `rate_limit:global`;

  const [current, globalCount] = await Promise.all([
    supabaseGet(key, env) as Promise<number | null>,
    supabaseGet(globalKey, env) as Promise<number | null>,
  ]);

  const count = (current ?? 0) + 1;
  const gCount = (globalCount ?? 0) + 1;

  // Block if global submissions exceed 100/min (detect waves)
  if (gCount > 100) return false;

  await Promise.all([
    supabaseSet(key, count, RATE_LIMIT_WINDOW_SECONDS, env),
    supabaseSet(globalKey, gCount, 60, env), // global resets every 60s
  ]);

  return count <= RATE_LIMIT_REQUESTS;
}
async function nationalIdVelocityCheck(clientId: string, env: Env): Promise<boolean> {
  const key = `id_attempts:${clientId}`;
  const attempts = (await supabaseGet(key, env) as number ?? 0) + 1;
  await supabaseSet(key, attempts, 60 * 30, env); // 30 min window
  return attempts <= 5; // max 5 different IDs per IP per 30 min
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
  // 1. Origin/UA/Content-Type check
  const allowedOrigin = env.WORKER_ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  if (!isLegitimateRequest(request, allowedOrigin)) {
    logEvent('blocked_suspicious_request', { clientId, path });
    return jsonResponse({ error: 'Forbidden' }, 403, 'no-store', origin);
  }

  try {
    const body = (await request.json()) as Record<string, any>;
    const { turnstileToken, ...formFields } = body;

    // 2. Honeypot
    if (formFields.website) {
      logEvent('honeypot_triggered', { clientId });
      return jsonResponse({ success: true, message: 'Data saved successfully.', id: 0 }, 200, 'no-store', origin);
    }

    logEvent('registration_request', { clientId, path });

    // 3. Turnstile
    const valid = await verifyTurnstile(turnstileToken || '', clientIp, env);
    if (!valid) {
      return jsonResponse({ error: 'Verification failed. Please try again.' }, 403, 'no-store', origin);
    }

    const applicant = normalizeApplicantPayload(formFields);
    const validationError = validateApplicantPayload(applicant);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400, 'no-store', origin);
    }

    // 4. National ID velocity check
    const idVelocityOk = await nationalIdVelocityCheck(clientId, env);
    if (!idVelocityOk) {
      logEvent('id_velocity_exceeded', { clientId });
      return jsonResponse({ error: 'Too many attempts. Please try again later.' }, 429, 'no-store', origin);
    }

    // 5. Duplicate check
    const exists = await applicantExists(applicant.national_id, env);
    if (exists) {
      throw new Error('DUPLICATE_NATIONAL_ID');
    }

    const result = await saveApplicantToD1(applicant, env);
    const id = result.meta.last_row_id;

    if (id) {
      await cacheSet(`submission:${id}`, applicant, SUBMISSION_CACHE_TTL, env);
    }

    return jsonResponse({
      success: true,
      message: 'Data saved successfully.',
      id,
    }, 200, 'no-store', origin);

  } catch (error: any) {
    logEvent('registration_error', { clientId, path, error: String(error) });
    const message = String(error?.message || error);

    if (message === 'DUPLICATE_NATIONAL_ID') {
      return jsonResponse({ error: 'هذا الرقم القومي مسجل بالفعل' }, 409, 'no-store', origin);
    }
    if (message.includes('UNIQUE constraint failed')) {
      return jsonResponse({ error: 'هذا الرقم القومي مسجل بالفعل' }, 409, 'no-store', origin);
    }

    return jsonResponse({ error: 'حدث خطأ أثناء معالجة طلبك.' }, 500, 'no-store', origin);
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
        return jsonResponse({ id, submission: cached }, 200, 'public, max-age=60', origin);
      }

      const submission = await getSubmissionFromD1(id, env);
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
