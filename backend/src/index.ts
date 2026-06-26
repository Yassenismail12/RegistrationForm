interface Env {
  WORKER_ALLOWED_ORIGIN?: string;
  DB: D1Database;
  KV: KVNamespace;
  TURNSTILE_SECRET: string;
  ADMIN_PASSWORD?: string;
}

type ApplicantPayload = {
  full_name: string;
  age: number | null;
  national_id: string;
  whatsapp: string;
  email: string | null;
  governorate: string | null;
  university: string | null;
  faculty: string | null;
  study_year: string | null;
  how_know_about_us: string | null;
  has_volunteer_experience: boolean | null;
  volunteer_experience: string | null;
  egyptian: boolean;
  source: string;
};

const DEFAULT_ORIGIN = 'https://registration-form.pages.dev';
const ALLOWED_ORIGINS = [
  'https://registration-form.pages.dev',
  'https://registration.ylyunion.com/',   // put your actual production domain here
  'https://ylyunion.com/',   // put your actual production domain here
  'http://localhost:3000',
];

function resolveOrigin(request: Request, env: Env): string {
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && (ALLOWED_ORIGINS.includes(requestOrigin) || requestOrigin === env.WORKER_ALLOWED_ORIGIN)) {
    return requestOrigin;
  }
  return env.WORKER_ALLOWED_ORIGIN || DEFAULT_ORIGIN;
}
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
  studyYears: ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'خريج', 'ثانوية عامة'],
  howKnowAboutUs: ['الأصدقاء', 'فيسبوك', 'إنستجرام', 'تيكتوك', 'تويتر', 'لينكد ان', 'الشيرنج', 'اخرى'],
};

// ─── KV helpers (replaces all Supabase KV calls) ────────────────────────────

async function kvGet<T = unknown>(key: string, env: Env): Promise<T | null> {
  const value = await env.KV.get(key, 'json');
  return value as T | null;
}

async function kvSet(key: string, value: unknown, ttlSeconds: number | null, env: Env): Promise<void> {
  const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await env.KV.put(key, JSON.stringify(value), opts);
}

async function kvDelete(key: string, env: Env): Promise<void> {
  await env.KV.delete(key);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function toEnglishNumbers(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
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
    age: body.age !== undefined && body.age !== '' ? Number(body.age) : null,
    email: optionalText(body.email),
    governorate: optionalText(body.governorate),
    university: optionalText(body.university),
    faculty: optionalText(body.faculty),
    study_year: optionalText(body.study_year),
    how_know_about_us: optionalText(body.how_know_about_us),
    has_volunteer_experience:
      typeof body.has_volunteer_experience === 'boolean' ? body.has_volunteer_experience : null,
    volunteer_experience: optionalText(body.volunteer_experience),
    egyptian: body.egyptian !== false,
    source: 'Cloudflare-Worker',
  };
}

function validateApplicantPayload(applicant: ApplicantPayload): string | null {
  if (!applicant.full_name) return 'full_name is required';
  if (!applicant.national_id) return 'national_id is required';
  // Add after the email check:
if (!applicant.governorate) return 'governorate is required';
  if (!applicant.whatsapp) return 'whatsapp is required';
  if (applicant.egyptian && !/^[23][0-9]{13}$/.test(applicant.national_id)) {
    return 'national_id must be 14 digits and start with 2 or 3 for Egyptian applicants';
  }
  if (applicant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email)) {
    return 'email is invalid';
  }
  if (applicant.age === null || isNaN(applicant.age)) {
  return 'age is required and must be a number';
}
if (!Number.isInteger(applicant.age) || applicant.age < 10 || applicant.age > 100) {
  return 'age must be a valid whole number';
}
  return null;
}

// ─── D1 helpers ──────────────────────────────────────────────────────────────

async function saveApplicantToD1(applicant: ApplicantPayload, env: Env) {
  return await env.DB.prepare(`
    INSERT INTO applicants (
      full_name, national_id, whatsapp, email, governorate,
      university, faculty, study_year, how_know_about_us,
      egyptian, age, has_volunteer_experience, volunteer_experience, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      applicant.age ?? null,
      applicant.has_volunteer_experience === null
        ? null
        : applicant.has_volunteer_experience
        ? 1
        : 0,
      applicant.volunteer_experience,
      applicant.source,
    )
    .run();
}

async function getSubmissionFromD1(id: string, env: Env) {
  return await env.DB.prepare('SELECT * FROM applicants WHERE id = ?').bind(id).first();
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

const ADMIN_SESSION_TTL = 60 * 60 * 8;

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createAdminSession(env: Env): Promise<string> {
  const token = generateSessionToken();
  await kvSet(`admin_session:${token}`, { createdAt: Date.now() }, ADMIN_SESSION_TTL, env);
  return token;
}

async function validateAdminSession(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const session = await kvGet<{ createdAt: number }>(`admin_session:${token}`, env);
  return session !== null;
}

function unauthorizedResponse(origin: string) {
  return jsonResponse({ error: 'Unauthorized' }, 401, 'no-store', origin);
}

async function getAdminStats(env: Env) {
  const totalResult = await env.DB.prepare('SELECT COUNT(*) AS total FROM applicants').first<{ total: number }>();
  const total = totalResult?.total ?? 0;

  const governorateRows = await env.DB.prepare(`
    SELECT governorate, COUNT(*) AS count
    FROM applicants
    WHERE governorate IS NOT NULL AND governorate != ''
    GROUP BY governorate
    ORDER BY count DESC
  `).all<{ governorate: string; count: number }>();

  const governorates = (governorateRows.results ?? []).map((row) => ({
    governorate: row.governorate,
    count: row.count,
    percentage: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0,
  }));

  const allGovernorates = PAGE_DATA.governorates.map((name) => {
    const existing = governorates.find((g) => g.governorate === name);
    return existing ?? { governorate: name, count: 0, percentage: 0 };
  });

  const knownNames = new Set(PAGE_DATA.governorates);
  const orphanGovernorates = governorates.filter((g) => !knownNames.has(g.governorate));
  allGovernorates.push(...orphanGovernorates);

  return { total, governorates: allGovernorates };
}

async function getDailyStatsByGovernorate(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT DATE(submitted_at) AS date, governorate, COUNT(*) AS count
    FROM applicants
    WHERE governorate IS NOT NULL AND governorate != ''
    GROUP BY DATE(submitted_at), governorate
    ORDER BY date ASC
  `).all<{ date: string; governorate: string; count: number }>();

  return rows.results ?? [];
}

async function getAllApplicantsForExport(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT
      id, full_name, national_id, whatsapp, email, age, governorate,
      university, faculty, study_year, how_know_about_us,
      has_volunteer_experience, volunteer_experience, egyptian, submitted_at, source
    FROM applicants
    ORDER BY submitted_at DESC
  `).all();

  return rows.results ?? [];
}

// ─── Rate-limiting ────────────────────────────────────────────────────────────

async function nationalIdVelocityCheck(clientId: string, env: Env): Promise<boolean> {
  const key = `id_attempts:${clientId}`;
  const attempts = ((await kvGet<number>(key, env)) ?? 0) + 1;
  await kvSet(key, attempts, 60 * 60, env);
  return attempts <= 20;
}

// ─── Image caching ────────────────────────────────────────────────────────────

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
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getCachedImage(url: string, env: Env) {
  return kvGet<{ data: string; contentType: string }>(`img:${url}`, env);
}

async function fetchAndCacheImage(url: string, env: Env) {
  const imageRes = await fetch(url);
  if (!imageRes.ok) throw new Error(`Image fetch failed ${imageRes.status}`);
  const contentType = imageRes.headers.get('Content-Type') || 'application/octet-stream';
  const buffer = new Uint8Array(await imageRes.arrayBuffer());
  const data = encodeBase64(buffer);
  await kvSet(`img:${url}`, { data, contentType }, IMAGE_CACHE_TTL, env);
  return { data, contentType };
}

// ─── Turnstile ────────────────────────────────────────────────────────────────

async function verifyTurnstile(token: string, ip: string, env: Env): Promise<{ success: boolean; errorCodes: string[] }> {
  if (!token) return { success: false, errorCodes: ['missing-input-response'] };

  const formData = new URLSearchParams();
  formData.append('secret', env.TURNSTILE_SECRET);
  formData.append('response', token);
  if (ip && ip !== 'anonymous') formData.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  const data: any = await res.json();
  console.log(JSON.stringify({ event: 'turnstile_verify', success: data.success, error_codes: data['error-codes'] || [] }));
  return { success: data.success === true, errorCodes: data['error-codes'] || [] };
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = resolveOrigin(request, env);
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
    }

    const clientIp =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      'anonymous';
    const clientId = `ip:${clientIp}`;

    // ── GET /api/health ──────────────────────────────────────────────────────
    if (path === '/api/health' && request.method === 'GET') {
      logEvent('health_check', { clientId, path });
      return jsonResponse(
        { status: 'ok', ts: Date.now() },
        200,
        'public, max-age=10, stale-while-revalidate=30',
        origin,
      );
    }

    // ── GET /api/page-data ───────────────────────────────────────────────────
    if (path === '/api/page-data' && request.method === 'GET') {
      const cachedPageData = await kvGet('page-data', env);
      if (cachedPageData) {
        logEvent('page_data_cached', { clientId, path });
        return jsonResponse(
          cachedPageData,
          200,
          'public, max-age=3600, stale-while-revalidate=3600',
          origin,
        );
      }
      await kvSet('page-data', PAGE_DATA, PAGE_DATA_CACHE_TTL, env);
      logEvent('page_data_served', { clientId, path, fromCache: false });
      return jsonResponse(
        PAGE_DATA,
        200,
        'public, max-age=3600, stale-while-revalidate=3600',
        origin,
      );
    }

    // ── POST /api/register ───────────────────────────────────────────────────
    if (path === '/api/register' && request.method === 'POST') {
      try {
        const body = (await request.json()) as Record<string, any>;
        const { turnstileToken, ...formFields } = body;

        logEvent('registration_request', { clientId, path });

        const { success: turnstileOk, errorCodes } = await verifyTurnstile(turnstileToken || '', clientIp, env);
        if (!turnstileOk) {
          logEvent('turnstile_failed', { clientId, errorCodes });

          if (errorCodes.includes('timeout-or-duplicate')) {
            return jsonResponse(
              { error: 'انتهت صلاحية التحقق، يرجى تحديث الصفحة وإعادة المحاولة.', code: 'turnstile_expired' },
              403,
              'no-store',
              origin,
            );
          }

          return jsonResponse(
            { error: 'فشل التحقق الأمني. يرجى إعادة المحاولة.', code: 'turnstile_failed' },
            403,
            'no-store',
            origin,
          );
        }

        const applicant = normalizeApplicantPayload(formFields);
        const validationError = validateApplicantPayload(applicant);
        if (validationError) {
          return jsonResponse({ error: validationError }, 400, 'no-store', origin);
        }

        const idVelocityOk = await nationalIdVelocityCheck(clientId, env);
        if (!idVelocityOk) {
          logEvent('id_velocity_exceeded', { clientId });
          return jsonResponse(
            { error: 'Too many attempts. Please try again later.' },
            429,
            'no-store',
            origin,
          );
        }

        const result = await saveApplicantToD1(applicant, env);
        const id = result.meta.last_row_id;

        if (id) {
          await kvSet(`submission:${id}`, applicant, SUBMISSION_CACHE_TTL, env);
        }

        return jsonResponse(
          { success: true, message: 'Data saved successfully.', id },
          200,
          'no-store',
          origin,
        );
      } catch (error: any) {
        logEvent('registration_error', { clientId, path, error: String(error) });
        const message = String(error?.message || error);

        if (message.includes('UNIQUE constraint failed')) {
          return jsonResponse({ error: 'هذا الرقم القومي مسجل بالفعل' }, 409, 'no-store', origin);
        }

        return jsonResponse({ error: 'حدث خطأ أثناء معالجة طلبك.' }, 500, 'no-store', origin);
      }
    }

    // ── GET /api/submission/:id ──────────────────────────────────────────────
    if (path.startsWith('/api/submission/') && request.method === 'GET') {
      const id = path.split('/').pop() || '';
      if (!id) return jsonResponse({ error: 'Submission id required' }, 400, 'no-store', origin);

      const cached = await kvGet(`submission:${id}`, env);
      if (cached) {
        logEvent('submission_cached', { clientId, id });
        return jsonResponse({ id, submission: cached }, 200, 'public, max-age=60', origin);
      }

      const submission = await getSubmissionFromD1(id, env);
      if (!submission) return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);

      await kvSet(`submission:${id}`, submission, SUBMISSION_CACHE_TTL, env);
      return jsonResponse({ id, submission }, 200, 'public, max-age=60', origin);
    }

    // ── POST /api/admin/login ────────────────────────────────────────────────
    if (path === '/api/admin/login' && request.method === 'POST') {
      try {
        const body = (await request.json()) as { password?: string };
        const password = String(body.password ?? '');

        if (!env.ADMIN_PASSWORD) {
          logEvent('admin_login_misconfigured', { clientId });
          return jsonResponse({ error: 'Admin access is not configured' }, 503, 'no-store', origin);
        }

        if (password !== env.ADMIN_PASSWORD) {
          logEvent('admin_login_failed', { clientId });
          return jsonResponse({ error: 'كلمة المرور غير صحيحة' }, 401, 'no-store', origin);
        }

        const token = await createAdminSession(env);
        logEvent('admin_login_success', { clientId });
        return jsonResponse({ token, expiresIn: ADMIN_SESSION_TTL }, 200, 'no-store', origin);
      } catch (error) {
        logEvent('admin_login_error', { clientId, error: String(error) });
        return jsonResponse({ error: 'Login failed' }, 500, 'no-store', origin);
      }
    }

    // ── GET /api/admin/stats ─────────────────────────────────────────────────
    if (path === '/api/admin/stats' && request.method === 'GET') {
      if (!(await validateAdminSession(request, env))) {
        return unauthorizedResponse(origin);
      }

      try {
        const stats = await getAdminStats(env);
        return jsonResponse(stats, 200, 'no-store', origin);
      } catch (error) {
        logEvent('admin_stats_error', { clientId, error: String(error) });
        return jsonResponse({ error: 'Failed to load stats' }, 500, 'no-store', origin);
      }
    }

    // ── GET /api/admin/stats/daily ───────────────────────────────────────────
    if (path === '/api/admin/stats/daily' && request.method === 'GET') {
      if (!(await validateAdminSession(request, env))) {
        return unauthorizedResponse(origin);
      }

      try {
        const daily = await getDailyStatsByGovernorate(env);
        return jsonResponse({ daily }, 200, 'no-store', origin);
      } catch (error) {
        logEvent('admin_daily_stats_error', { clientId, error: String(error) });
        return jsonResponse({ error: 'Failed to load daily stats' }, 500, 'no-store', origin);
      }
    }

    // ── GET /api/admin/export ────────────────────────────────────────────────
    if (path === '/api/admin/export' && request.method === 'GET') {
      if (!(await validateAdminSession(request, env))) {
        return unauthorizedResponse(origin);
      }

      try {
        const applicants = await getAllApplicantsForExport(env);
        return jsonResponse({ applicants, exportedAt: new Date().toISOString() }, 200, 'no-store', origin);
      } catch (error) {
        logEvent('admin_export_error', { clientId, error: String(error) });
        return jsonResponse({ error: 'Failed to export data' }, 500, 'no-store', origin);
      }
    }

    // ── GET /api/optimize-image ──────────────────────────────────────────────
    if (path === '/api/optimize-image' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl || !/^https:/.test(targetUrl)) {
        return jsonResponse(
          { error: 'A secure https image URL is required.' },
          400,
          'no-store',
          origin,
        );
      }

      try {
        const cached = await getCachedImage(targetUrl, env);
        const imageRecord = cached || (await fetchAndCacheImage(targetUrl, env));
        const bytes = decodeBase64(imageRecord.data);
        logEvent('image_served', { clientId, targetUrl, fromCache: Boolean(cached) });
        return imageResponse(
          bytes.buffer,
          imageRecord.contentType,
          'public, max-age=86400, stale-while-revalidate=3600',
          origin,
        );
      } catch (error) {
        logEvent('image_error', { clientId, targetUrl, error: String(error) });
        return jsonResponse(
          { error: 'Unable to optimize image', details: String(error) },
          500,
          'no-store',
          origin,
        );
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);
  },
};
