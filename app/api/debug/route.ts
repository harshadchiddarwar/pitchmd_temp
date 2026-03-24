import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  try {
    const client = getSnowflakeClient();
    const results = await client.executeQuery(`
      SELECT 
        APP_USER_ID, USER_ID, USER_NAME, 
        PHYSICIAN_ID, EVALUATED_AT, OVERALL_SCORE, FIELD_READINESS
      FROM CORTEX_TESTING.ML.REPEVAL_RESULTS
      ORDER BY EVALUATED_AT DESC
      LIMIT 5
    `);
    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}