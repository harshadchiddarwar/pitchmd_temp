import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  // FIX: was checking 'session_' prefix, but createSession() produces 'sess_' prefix,
  // causing a permanent 401 redirect loop from the dashboard. Use the shared
  // session helper so the prefix, KV lookup, and cookie fallback all stay in sync.
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getSnowflakeClient();
    const physicians = await client.queryAllPhysicians();
    return NextResponse.json({ physicians });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[physicians] Snowflake error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}