'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import AudioInput from './audio-input';
import EvaluationPanel from './evaluation-panel';
import { Send, RotateCcw, Square } from 'lucide-react';
import { parseEmotion, speakText, stopCurrentAudio } from '@/lib/elevenlabs';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isEvaluation?: boolean;
}

const EVAL_KEYWORDS = [
  'overall_score', 'clinical_knowledge', 'objection_handling',
  'field_ready', 'coaching_priority', 'Overall Score', 'Field Readiness',
  'RepEval', 'REPEVAL', 'evaluation report', 'Evaluation Report',
];

function isEvaluationResponse(text: string): boolean {
  return EVAL_KEYWORDS.some((kw) => text.includes(kw));
}

function parseDurationFromText(text: string): number | null {
  const match = text.match(/\[SESSION_DURATION:(\d+)\]/);
  return match ? parseInt(match[1], 10) : null;
}

function parseVoiceModelFromText(text: string): string | null {
  const match = text.match(/\[VOICE_MODEL:([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

function stripHiddenTags(text: string): string {
  return text
    .replace(/\[SESSION_DURATION:\d+\]/g, '')
    .replace(/\[VOICE_MODEL:[^\]]+\]/g, '')
    .trim();
}

function getTimerBarColor(timeRemaining: number, sessionDuration: number): string {
  const ratio = timeRemaining / sessionDuration;
  if (ratio > 2 / 3) return '#4e9e6b';
  if (ratio > 1 / 3) return '#c07c3a';
  return '#b04848';
}

function randomSessionDuration(min = 60, max = 150): number {
  const r1 = Math.random();
  const r2 = Math.random();
  return Math.round(min + ((r1 + r2) / 2) * (max - min));
}

const MAX_TURNS = 12;

export default function ChatInterface({ username = 'Rep' }: { username?: string }) {
  const targetDurationRef = useRef<number>(randomSessionDuration());

  const GREETING = `Hello! I'm ready to begin my sales training session. My name is ${username}. [REQUESTED_SESSION_DURATION:${targetDurationRef.current}]`;

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  // FIX 1: roleplaying becomes true only when the physician persona goes live
  // (first response that contains [SESSION_DURATION:] or [VOICE_MODEL:] tags).
  // The timer does NOT start until this is true, so it stays off while the
  // physician-list is being shown.
  const [roleplaying, setRoleplaying] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [evalContent, setEvalContent] = useState<string | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [userTyping, setUserTyping] = useState(false);
  const [sessionDuration, setSessionDuration] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // FIX 3: surface TTS failures so the user knows voice is unavailable
  const [ttsAvailable, setTtsAvailable] = useState(true);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const inputRef = useRef('');
  const hasStarted = useRef(false);
  const autoEndedRef = useRef(false);

  // Ref mirror of sessionEnded — always current inside async callbacks/effects
  const sessionEndedRef = useRef(false);

  // Ref mirror of roleplaying — set synchronously in sendMessage to prevent a
  // race where two rapid responses both think they are the first roleplay turn
  const roleplayingRef = useRef(false);

  const currentVoiceRef = useRef<string | null>(null);

  // Stable ref so timer-expiry and turn-limit effects always call the latest
  // sendMessage closure without putting sendMessage in their dep arrays
  const sendMessageRef = useRef<(text: string, history: Message[]) => Promise<void>>(
    async () => { },
  );

  // ── Sync state → refs ─────────────────────────────────────────────────────
  useEffect(() => { inputRef.current = inputValue; }, [inputValue]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionEndedRef.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusMessage]);

  // ── FIX 2a: Timer countdown via useEffect ────────────────────────────────
  //
  // The interval is owned entirely by this effect — never created inside a
  // setState updater or the message handler.
  //
  // Pause/resume: when `loading` becomes true (waiting for the agent) the
  // cleanup fires and clears the interval. When `loading` becomes false the
  // effect re-runs and restarts from the current timeRemaining value. This
  // gives automatic pause-during-fetch / resume-after-response with no manual
  // clearInterval calls needed anywhere else.
  //
  // `timeRemaining` is intentionally NOT in the dep array. The functional form
  // of setTimeRemaining means the callback always sees the freshest value, and
  // excluding it prevents the interval from restarting on every tick.
  useEffect(() => {
    if (
      !roleplaying ||
      sessionEnded ||
      loading ||
      timeRemaining === null ||
      timeRemaining <= 0
    ) {
      return;
    }
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleplaying, sessionEnded, loading]);

  // ── FIX 2b: Timer expiry — fire evaluation when countdown reaches zero ────
  //
  // Calling sendMessage here (outside any setState updater) is the correct
  // React pattern. The `loading` guard prevents a race where the timer hits 0
  // at the exact moment the user sends a message — in that case we wait for
  // the in-flight response to finish before ending the session.
  useEffect(() => {
    if (
      timeRemaining === 0 &&
      sessionDuration !== null &&
      !loading &&
      !autoEndedRef.current &&
      !sessionEndedRef.current
    ) {
      autoEndedRef.current = true;
      sendMessageRef.current('done', messagesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining, sessionDuration, loading]);

  // ── sendMessage ───────────────────────────────────────────────────────────
  const sendMessage = async (text: string, history: Message[]) => {
    if (sessionEndedRef.current) return;

    const isDone = ['done', 'end', 'finish', 'bye', 'have a good day'].includes(
      text.trim().toLowerCase(),
    );
    if (isDone) {
      // Set ref synchronously so concurrent effects/callbacks see the flag
      // before the batched state update propagates
      sessionEndedRef.current = true;
      setSessionEnded(true);
      setTimeRemaining(null);
      stopCurrentAudio();
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
    };
    const updatedMessages = [...history, userMessage];
    setMessages(updatedMessages);
    messagesRef.current = updatedMessages;
    setInputValue('');
    inputRef.current = '';
    setUserTyping(false);
    setCountdown(null);
    setLoading(true);
    setStatusMessage('Connecting...');
    // Pause any playing audio. Timer interval pauses automatically via the
    // countdown useEffect reacting to loading=true — no manual work needed.
    stopCurrentAudio();

    try {
      const HEAD = Math.min(3, updatedMessages.length);
      const headIds = new Set(updatedMessages.slice(0, HEAD).map((m) => m.id));
      const tail = updatedMessages.slice(-6);
      const contextMessages =
        updatedMessages.length > 9
          ? [
            ...updatedMessages.slice(0, HEAD),
            ...tail.filter((m) => !headIds.has(m.id)),
          ]
          : updatedMessages;

      const response = await fetch('/api/cortex/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok || !response.body) throw new Error('Failed to connect to agent');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line.trim());

            if (event.type === 'status') {
              setStatusMessage(event.message);

            } else if (event.type === 'done') {
              const isEval = isEvaluationResponse(event.text);
              const duration = parseDurationFromText(event.text);
              const voiceModel = parseVoiceModelFromText(event.text);
              const cleanText = stripHiddenTags(event.text);

              // Capture voice model on first occurrence
              if (voiceModel && !currentVoiceRef.current) {
                currentVoiceRef.current = voiceModel;
                console.log('[tts] voice model assigned:', voiceModel);
              }

              // ── FIX 1: Gate timer on roleplay start ───────────────────────
              // [SESSION_DURATION:] and [VOICE_MODEL:] only appear in the first
              // in-character physician message. Physician-list responses contain
              // neither tag, so the timer stays off until the physician is
              // chosen and the agent has entered character.
              //
              // roleplayingRef is set synchronously here to prevent a race
              // condition where two rapid responses could both satisfy the check
              // before the React state update for setRoleplaying propagates.
              if (!roleplayingRef.current && (duration !== null || voiceModel !== null)) {
                roleplayingRef.current = true;
                const resolvedDuration =
                  duration && duration >= 30 && duration <= 300
                    ? duration
                    : targetDurationRef.current;
                setRoleplaying(true);
                setSessionDuration(resolvedDuration);
                setTimeRemaining(resolvedDuration);
                // The countdown useEffect will start the interval automatically
                // once loading becomes false and roleplaying becomes true.
              }

              const { emotion, cleanText: emotionStripped } = parseEmotion(cleanText);

              if (isEval) {
                setEvalContent(cleanText);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg_${Date.now()}_assistant`,
                    role: 'assistant',
                    content: 'Your evaluation is ready.',
                    isEvaluation: true,
                  },
                ]);
                setEvalOpen(true);
                setTimeRemaining(null);
              } else {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg_${Date.now()}_assistant`,
                    role: 'assistant',
                    content: emotionStripped,
                  },
                ]);

                if (currentVoiceRef.current) {
                  console.log(
                    '[tts] speaking | voice:',
                    currentVoiceRef.current,
                    '| emotion:',
                    emotion,
                  );
                  // FIX 3: speakText now throws on HTTP error (see lib/elevenlabs.ts)
                  // so we can catch it here and show a visible badge in the UI.
                  speakText(emotionStripped, currentVoiceRef.current, emotion).catch(
                    (err) => {
                      console.error('[tts] failed:', err);
                      setTtsAvailable(false);
                    },
                  );
                }
              }

              setStatusMessage('');
              setLoading(false);
              // Timer resumes automatically: loading→false causes the countdown
              // useEffect to re-run and restart the interval from timeRemaining.

            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_error`,
          role: 'assistant',
          content: `Sorry, something went wrong: ${error.message}. Please try again.`,
        },
      ]);
      setStatusMessage('');
      setLoading(false);
    }
  };

  // Keep the ref current every render so effects always call the latest closure
  sendMessageRef.current = sendMessage;

  // ── Session controls ──────────────────────────────────────────────────────
  const handleStartSession = () => {
    if (hasStarted.current) return;
    setSessionStarted(true);
    hasStarted.current = true;
    sendMessage(GREETING, []);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || loading || sessionEnded) return;
    sendMessage(inputValue.trim(), messagesRef.current);
  };

  const handleAutoSubmit = () => {
    if (userTyping || sessionEnded) return;
    const current = inputRef.current.trim();
    if (current && !loading) sendMessage(current, messagesRef.current);
  };

  const handleNewSession = () => {
    stopCurrentAudio();

    // Reset refs synchronously before state batching
    sessionEndedRef.current = false;
    autoEndedRef.current = false;
    hasStarted.current = false;
    roleplayingRef.current = false;
    currentVoiceRef.current = null;
    targetDurationRef.current = randomSessionDuration();
    messagesRef.current = [];

    // Reset all state
    setMessages([]);
    setStatusMessage('');
    setEvalContent(null);
    setCountdown(null);
    setUserTyping(false);
    setInputValue('');
    setSessionEnded(false);
    setRoleplaying(false);
    setSessionDuration(null);
    setTimeRemaining(null);
    setLoading(false);
    setSessionStarted(false);
    setTtsAvailable(true);
  };

  // Filter the internal greeting from the visible chat
  const visibleMessages = messages.filter(
    (m, i) =>
      !(i === 0 && m.role === 'user' && m.content.startsWith("Hello! I'm ready to begin")),
  );
  const turnLimitReached = visibleMessages.length >= MAX_TURNS;

  // Turn-limit auto-end — uses sendMessageRef to avoid stale-closure risk
  useEffect(() => {
    if (
      turnLimitReached &&
      !loading &&
      !autoEndedRef.current &&
      !sessionEndedRef.current &&
      visibleMessages[visibleMessages.length - 1]?.role === 'assistant'
    ) {
      autoEndedRef.current = true;
      sessionEndedRef.current = true;
      sendMessageRef.current('done', messagesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnLimitReached, loading]);

  const timerRatio =
    timeRemaining !== null && sessionDuration !== null
      ? timeRemaining / sessionDuration
      : null;
  const isLastThird = timerRatio !== null && timerRatio <= 1 / 3;

  // ── Pre-session splash ────────────────────────────────────────────────────
  if (!sessionStarted) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
        <div className="space-y-2">
          <p className="text-2xl font-semibold text-slate-900">Ready to practice?</p>
          <p className="text-slate-500 text-sm max-w-sm">
            The AI will present a list of physicians to choose from, then take on their
            persona for a realistic sales call simulation.
          </p>
        </div>
        <Button
          onClick={handleStartSession}
          className="w-64 py-6 text-base rounded-full"
          style={{
            background: 'linear-gradient(90deg, #FF6B00, #00C8FF)',
            border: 'none',
            color: 'white',
          }}
        >
          Start Training Session
        </Button>
        <Button
          variant="outline"
          onClick={() => setEvalOpen(true)}
          className="w-64 py-6 text-base rounded-full"
        >
          View Last Evaluation Report
        </Button>
        <p className="text-xs text-slate-400">
          Type{' '}
          <span className="font-medium text-slate-500">&quot;end&quot;</span> or{' '}
          <span className="font-medium text-slate-500">&quot;done&quot;</span> during the
          session to trigger your evaluation
        </p>
        <EvaluationPanel
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          content={evalContent ?? ''}
          username={username}
        />
      </div>
    );
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 pb-28">
        {messages.length === 0 && loading && (
          <div className="flex items-end gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0" />
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              <span className="text-sm text-slate-500">
                {statusMessage || 'Starting session...'}
              </span>
            </div>
          </div>
        )}

        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
          >
            {message.role === 'assistant' && (
              <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0 mb-2" />
            )}
            <div
              className={`max-w-sm lg:max-w-xl px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                }`}
            >
              {message.content}
              {message.isEvaluation && evalContent && (
                <button
                  onClick={() => setEvalOpen(true)}
                  className="mt-2 flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium text-xs"
                >
                  View Evaluation Report →
                </button>
              )}
            </div>
            {message.role === 'user' && (
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0 mb-2" />
            )}
          </div>
        ))}

        {loading && messages.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0" />
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              <span className="text-sm text-slate-500">
                {statusMessage || 'Thinking...'}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 bg-white pt-2 pb-1">
        <div className="mb-1 px-1">
          <div className="flex items-center justify-between mb-1">
            {/* Left side: status / timer label */}
            {turnLimitReached ? (
              <p className="text-xs text-amber-600 font-medium">
                Session limit reached — generating your evaluation...
              </p>
            ) : timeRemaining !== null && sessionDuration !== null ? (
              isLastThird ? (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: '#b04848', color: 'white' }}
                >
                  Time left: {timeRemaining}s
                </span>
              ) : (
                <p className="text-xs font-medium text-slate-400">
                  Time left: {timeRemaining}s
                </p>
              )
            ) : (
              <p className="text-xs text-slate-400">
                Type{' '}
                <span className="font-medium text-slate-500">&quot;end&quot;</span> or{' '}
                <span className="font-medium text-slate-500">&quot;done&quot;</span> when
                finished
              </p>
            )}

            {/* Right side: TTS error badge — shown only after a failure */}
            {!ttsAvailable && (
              <span
                className="text-xs text-amber-600 font-medium ml-2"
                title="ElevenLabs returned an error. Check your API key and account credits at elevenlabs.io."
              >
                🔇 Voice unavailable
              </span>
            )}
          </div>

          {timeRemaining !== null && sessionDuration !== null && (
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
              <div
                style={{
                  width: `${(timeRemaining / sessionDuration) * 100}%`,
                  height: '100%',
                  background: getTimerBarColor(timeRemaining, sessionDuration),
                  transition: 'width 1s linear, background 1s ease',
                }}
              />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 pt-3">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <AudioInput
              onTranscript={(text) =>
                setInputValue((prev) => prev + (prev ? ' ' : '') + text)
              }
              onAutoSubmit={handleAutoSubmit}
              onCountdown={setCountdown}
              userTyping={userTyping}
              disabled={loading || turnLimitReached || sessionEnded}
            />
            <div className="relative flex-1">
              <Input
                placeholder={
                  sessionEnded
                    ? 'Session ended'
                    : turnLimitReached
                      ? 'Session limit reached...'
                      : 'Type your message...'
                }
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setUserTyping(true);
                  setCountdown(null);
                }}
                onFocus={() => setUserTyping(true)}
                onBlur={() => setUserTyping(false)}
                disabled={loading || turnLimitReached || sessionEnded}
                className="w-full"
              />
              {countdown !== null && (
                <div
                  className="absolute left-0 right-0 h-1 bg-slate-200 rounded-full overflow-hidden"
                  style={{ top: '100%', marginTop: '3px' }}
                >
                  <div
                    style={{
                      width: `${countdown}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #FF6B00, #00C8FF, #FF6B00)',
                      backgroundSize: '300% 300%',
                      animation: 'gradientShift 6s ease infinite',
                      transition: 'width 80ms linear',
                    }}
                  />
                </div>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || !inputValue.trim() || turnLimitReached || sessionEnded}
              size="icon"
              className="rounded-full shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
            {sessionEnded ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleNewSession}
                title="New session"
                className="rounded-full shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => sendMessage('done', messagesRef.current)}
                disabled={loading || sessionEnded}
                className="rounded-full shrink-0"
                title="End session"
              >
                <Square className="w-4 h-4" />
              </Button>
            )}
          </form>
        </div>
      </div>

      <EvaluationPanel
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        content={evalContent ?? ''}
        username={username}
      />
    </div>
  );
}
