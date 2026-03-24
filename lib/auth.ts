import { kv } from '@vercel/kv';
import { scryptSync, timingSafeEqual, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const SESSION_DURATION = 24 * 60 * 60;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export interface Session {
  userId: string;
  username: string;
  email: string;
  expiresAt: number;
}

// ─── Session creation ─────────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  username: string,
  email: string,
): Promise<string> {
  const sessionId = `sess_${randomBytes(32).toString('hex')}`;
  const expiresAt = Date.now() + SESSION_DURATION * 1000;
  const session: Session = { userId, username, email, expiresAt };

  const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (kvConfigured) {
    await kv.setex(sessionId, SESSION_DURATION, JSON.stringify(session));
  }

  const cookieStore = await cookies();
  cookieStore.set('sessionId', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });
  // HttpOnly fallback payload for no-KV environments
  cookieStore.set(
    'sessionData',
    Buffer.from(JSON.stringify(session)).toString('base64'),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_DURATION,
      path: '/',
    },
  );

  return sessionId;
}

// ─── Internal: resolve session from KV or cookie payload ─────────────────────

async function resolveFromKV(sessionId: string): Promise<Session | null> {
  const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) return null;
  try {
    const raw = await kv.get(sessionId);
    if (!raw) return null;
    const session: Session =
      typeof raw === 'string' ? JSON.parse(raw) : (raw as Session);
    if (session.expiresAt < Date.now()) {
      await kv.del(sessionId);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function resolveFromPayload(raw: string | undefined): Session | null {
  if (!raw) return null;
  try {
    const session: Session = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// ─── Public: Server Components / pages via next/headers ──────────────────────

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;
  if (!sessionId || !sessionId.startsWith('sess_')) return null;

  const fromKV = await resolveFromKV(sessionId);
  if (fromKV) return fromKV;

  return resolveFromPayload(cookieStore.get('sessionData')?.value);
}

// ─── Public: API route handlers via NextRequest ───────────────────────────────

export async function getSessionFromRequest(
  request: NextRequest,
): Promise<Session | null> {
  const sessionId = request.cookies.get('sessionId')?.value;

  if (sessionId && sessionId.startsWith('sess_')) {
    const fromKV = await resolveFromKV(sessionId);
    if (fromKV) return fromKV;

    const fromPayload = resolveFromPayload(request.cookies.get('sessionData')?.value);
    if (fromPayload) return fromPayload;
  }

  // ─── Demo-mode fallback ───────────────────────────────────────────────────
  // In v0.dev's iframe environment the httpOnly sess_ cookie is often blocked
  // from being sent (SameSite / iframe sandboxing). Fall back to the non-httpOnly
  // `appUsername` cookie that login/page.tsx sets via document.cookie — this IS
  // sent with same-origin requests regardless of the iframe context.
  // Only active when DEMO_MODE is not explicitly disabled.
  if (process.env.DEMO_MODE !== 'false') {
    const raw = request.cookies.get('appUsername')?.value;
    if (raw) {
      const username = decodeURIComponent(raw);
      return {
        userId: username,
        username,
        email: `${username}@demo.local`,
        expiresAt: Date.now() + SESSION_DURATION * 1000,
      };
    }
  }

  return null;
}

// ─── Destroy session ──────────────────────────────────────────────────────────

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('sessionId')?.value;

  const kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (sessionId && kvConfigured) {
    try { await kv.del(sessionId); } catch { /* best-effort */ }
  }

  cookieStore.delete('sessionId');
  cookieStore.delete('sessionData');
}

// ─── Password hashing ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return Buffer.concat([salt, hash]).toString('base64');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Buffer.from(hash, 'base64');
    const salt = combined.subarray(0, SALT_LENGTH);
    const storedHash = combined.subarray(SALT_LENGTH);
    const computedHash = scryptSync(password, salt, KEY_LENGTH);
    return timingSafeEqual(computedHash, storedHash);
  } catch {
    return false;
  }
}