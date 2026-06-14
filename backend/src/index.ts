// Cloudflare Worker entrypoint for the backend API
import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, collection, addDoc, Firestore } from "firebase/firestore/lite";

interface Env {
  RATE_LIMIT_KV: KVNamespace;
  WORKER_ALLOWED_ORIGIN?: string;
 
  FIREBASE_API_KEY: string;
  FIREBASE_AUTH_DOMAIN: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_STORAGE_BUCKET: string;
  FIREBASE_MESSAGING_SENDER_ID: string;
  FIREBASE_APP_ID: string;
}


let app: FirebaseApp | null = null;
let db: Firestore | null = null;

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


    if (!app) {
      const firebaseConfig = {
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        appId: env.FIREBASE_APP_ID
      };
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
    }

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
      if (env.RATE_LIMIT_KV) {
        allowed = await rateLimit(clientId, env);
      }
    } catch (e) {
   
    }

    if (!allowed) {
      logEvent('rate_limit_exceeded', { clientId, path });
      return jsonResponse({ error: 'Too many requests' }, 429, 'no-store', origin);
    }

    if (path === '/api/health' && request.method === 'GET') {
      logEvent('health_check', { clientId, path });
      return jsonResponse({ status: 'ok', ts: Date.now() }, 200, 'public, max-age=10, stale-while-revalidate=30', origin);
    }

    // الـ Route الأصلي والمظبوط للتيم ليدر
    if (path === '/register' && request.method === 'POST') {
      try {
        const body = (await request.json()) as Record<string, any>;
        logEvent('registration_request', { clientId, path, body });

      
        if (!db) throw new Error("Firestore not initialized");

        const docRef = await addDoc(collection(db, "applicants"), {
          ...body,
          submittedAt: new Date().toISOString(),
          source: "Cloudflare-Worker"
        });

        return jsonResponse({ 
          success: true, 
          message: "Data saved to Firebase successfully!", 
          id: docRef.id 
        }, 200, 'no-store', origin);

      } catch (error) {
        logEvent('registration_error', { clientId, path, error: String(error) });
        return jsonResponse({ error: 'Failed to save data to Firebase', details: String(error) }, 400, 'no-store', origin);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, 'no-store', origin);
  },
};
