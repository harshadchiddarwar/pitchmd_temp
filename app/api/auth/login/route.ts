import { NextRequest, NextResponse } from 'next/server';
import { createSession, hashPassword, verifyPassword } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

// Demo mode: ON by default — set DEMO_MODE=false to switch to Snowflake USERS
// table auth (production). Default-on means v0.dev / local dev works without
// any env var setup at all.
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  // Sanitize input — reject anything that looks like injection
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  try {
    if (DEMO_MODE) {
      // Demo credentials — fall back to well-known defaults so demo works
      // even if the env vars aren't configured in v0.dev / local dev.
      const demoUser = process.env.DEMO_USERNAME ?? 'john_rep';
      const demoPass = process.env.DEMO_PASSWORD ?? 'password';
      if (username !== demoUser || password !== demoPass) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
      const sessionId = await createSession(username, username, `${username}@demo.local`);
      // Username is now derived server-side from the session — no client-readable cookie needed
      return NextResponse.json({ success: true, sessionId, username });
    }

    // Production: validate against Snowflake USERS table
    const client = getSnowflakeClient();
    const user = await client.getUserByUsername(username);
    if (!user) {
      // Constant-time response even on missing user (prevent user enumeration)
      await hashPassword('dummy_timing_equalizer');
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.PASSWORD_HASH);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const sessionId = await createSession(user.USER_ID, user.USERNAME, user.EMAIL ?? '');
    return NextResponse.json({ success: true, sessionId, username: user.USERNAME });
  } catch (error) {
    console.error('[login] error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}