import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Use the shared session helper — checks sess_ prefix and KV/cookie fallback
  const session = await getSessionFromRequest(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { text?: string; voiceId?: string; stability?: number; style?: number; similarity_boost?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { text, voiceId, stability, style, similarity_boost } = body;

  if (!text || !voiceId) {
    return new Response(JSON.stringify({ error: 'text and voiceId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[tts] ELEVENLABS_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'TTS not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: stability ?? 0.75,
        style: style ?? 0.1,
        similarity_boost: similarity_boost ?? 0.75,
      },
    }),
  });

  if (!response.ok) {
    // Don't forward raw ElevenLabs error body — may contain account info
    console.error('[tts] ElevenLabs error:', response.status);
    return new Response(JSON.stringify({ error: `TTS request failed: ${response.status}` }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}