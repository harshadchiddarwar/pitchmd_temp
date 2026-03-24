'use client';

const EMOTION_SETTINGS: Record<string, { stability: number; style: number; similarity_boost: number }> = {
  neutral: { stability: 0.75, style: 0.10, similarity_boost: 0.75 },
  curious: { stability: 0.65, style: 0.30, similarity_boost: 0.75 },
  skeptical: { stability: 0.50, style: 0.50, similarity_boost: 0.75 },
  frustrated: { stability: 0.30, style: 0.70, similarity_boost: 0.75 },
  dismissive: { stability: 0.40, style: 0.60, similarity_boost: 0.75 },
  impressed: { stability: 0.60, style: 0.40, similarity_boost: 0.75 },
  urgent: { stability: 0.55, style: 0.45, similarity_boost: 0.75 },
};

export function parseEmotion(text: string): { emotion: string; cleanText: string } {
  const match = text.match(/^\[EMOTION:(\w+)\]\s*/);
  if (match) {
    return { emotion: match[1].toLowerCase(), cleanText: text.slice(match[0].length) };
  }
  return { emotion: 'neutral', cleanText: text };
}

export function stripStageDirections(text: string): string {
  return text.replace(/\*[^*]+\*/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ─── Audio queue ──────────────────────────────────────────────────────────────
// Prevents overlapping audio when the user sends rapid messages.
// Each new speakText() call cancels any currently-playing audio before starting.

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function cancelCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

// FIX: speakText now throws on HTTP errors instead of silently returning.
// This allows the calling code in chat-interface.tsx to catch the error and
// display a visible "Voice unavailable" badge in the UI.
//
// Common error codes:
//   402 — ElevenLabs quota exceeded or plan upgrade required
//   503 — ELEVENLABS_API_KEY env var not set in the deployment
export async function speakText(
  text: string,
  voiceId: string,
  emotion: string,
): Promise<void> {
  // Cancel any in-progress audio before starting the new one
  cancelCurrentAudio();

  const settings = EMOTION_SETTINGS[emotion] ?? EMOTION_SETTINGS.neutral;
  const cleanText = stripStageDirections(text);
  if (!cleanText.trim()) return;

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: cleanText,
      voiceId,
      stability: settings.stability,
      style: settings.style,
      similarity_boost: settings.similarity_boost,
    }),
  });

  if (!response.ok) {
    // Throw so the caller can catch and surface this to the user.
    // 402 = billing/quota issue — check elevenlabs.io account
    // 503 = ELEVENLABS_API_KEY not configured
    const msg =
      response.status === 402
        ? 'ElevenLabs quota exceeded or plan upgrade required (402)'
        : response.status === 503
          ? 'ElevenLabs API key not configured (503)'
          : `TTS request failed (${response.status})`;
    console.error('[tts] proxy error:', response.status, msg);
    throw new Error(msg);
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  // Store refs so we can cancel if needed
  currentObjectUrl = audioUrl;
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  audio.onended = () => {
    if (currentAudio === audio) cancelCurrentAudio();
  };

  audio.onerror = () => {
    console.error('[tts] audio playback error');
    if (currentAudio === audio) cancelCurrentAudio();
  };

  await audio.play();
}

export function stopCurrentAudio() {
  cancelCurrentAudio();
}