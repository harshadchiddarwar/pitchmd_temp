'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AudioInputProps {
  onTranscript: (text: string) => void;
  onAutoSubmit?: () => void;
  onCountdown?: (progress: number | null) => void;
  disabled?: boolean;
  userTyping?: boolean;
}

const SILENCE_TIMEOUT = 3000;

export default function AudioInput({ onTranscript, onAutoSubmit, onCountdown, disabled, userTyping }: AudioInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTranscriptRef = useRef(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) setSupported(true);
  }, []);

  useEffect(() => {
    if (supported && !disabled && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setTimeout(() => startRecording(), 100);
    }
  }, [supported]);

  // Stop recording immediately when disabled (e.g. while message is sending)
  useEffect(() => {
    if (disabled && isRecording) {
      clearTimers();
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
  }, [disabled]);

  // Resume recording when no longer disabled
  useEffect(() => {
    if (!disabled && supported && !isRecording) {
      const t = setTimeout(() => startRecording(), 100);
      return () => clearTimeout(t);
    }
  }, [disabled]);

  // Mute mic and cancel countdown when user starts typing
  useEffect(() => {
    if (userTyping && isRecording) {
      clearTimers();
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
  }, [userTyping]);

  const clearTimers = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    silenceTimerRef.current = null;
    progressIntervalRef.current = null;
    onCountdown?.(null);
  };

  const startSilenceTimer = () => {
    clearTimers();
    if (!hasTranscriptRef.current) return;

    const start = Date.now();
    onCountdown?.(100);

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / SILENCE_TIMEOUT) * 100);
      onCountdown?.(remaining);
    }, 50);

    silenceTimerRef.current = setTimeout(() => {
      clearTimers();
      recognitionRef.current?.stop();
      setIsRecording(false);
      if (onAutoSubmit) onAutoSubmit();
    }, SILENCE_TIMEOUT);
  };

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR || isRecording) return;

    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    hasTranscriptRef.current = false;

    recognition.onresult = (event: any) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
      }
      if (final) {
        hasTranscriptRef.current = true;
        onTranscript(final);
        startSilenceTimer();
      }
    };

    recognition.onerror = () => { clearTimers(); setIsRecording(false); };
    recognition.onend = () => {
      clearTimers();
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    clearTimers();
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  if (!supported) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant={isRecording ? 'destructive' : 'outline'}
      onClick={isRecording ? stopRecording : startRecording}
      disabled={disabled}
      className={`rounded-full shrink-0 ${isRecording ? 'animate-pulse' : ''}`}
      title={isRecording ? 'Stop recording' : 'Speak your message'}
    >
      {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </Button>
  );
}
