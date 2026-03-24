import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeClient } from '@/lib/snowflake';

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get('sessionId')?.value;
  if (!sessionId || !sessionId.startsWith('session_')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Extract username from query param, fall back to john_rep for demo
  const appUserId = request.nextUrl.searchParams.get('userId') ?? 'john_rep';

  try {
    const client = getSnowflakeClient();
    const evaluation = await client.queryLatestEvaluationByAppUser(appUserId);

    if (!evaluation) {
      return NextResponse.json({ error: 'No evaluation found for this user' }, { status: 404 });
    }

    const physicianId = evaluation.PHYSICIAN_ID;
    const segmentName = evaluation.SEGMENT_NAME;
    const physicianName = (evaluation.PHYSICIAN_FIRST_NAME && evaluation.PHYSICIAN_LAST_NAME)
      ? `${evaluation.PHYSICIAN_FIRST_NAME} ${evaluation.PHYSICIAN_LAST_NAME}`
      : physicianId;

    const [historyWithPhysician, historyAllPhysicians, segmentMedian] = await Promise.all([
      physicianId ? client.queryEvaluationHistory(appUserId, physicianId) : Promise.resolve([]),
      client.queryEvaluationHistoryAllPhysicians(appUserId),
      segmentName ? client.querySegmentMedianScores(segmentName) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      evaluation,
      physicianName,
      historyWithPhysician,
      historyAllPhysicians,
      segmentMedian,
    });
  } catch (error: any) {
    console.error('[evaluation] Snowflake error:', error?.response?.data || error?.message);
    return NextResponse.json({ error: error?.message || 'Failed to fetch evaluation' }, { status: 500 });
  }
}