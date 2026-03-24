'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ChatInterface from '@/components/chat-interface';
import { LogOut } from 'lucide-react';

interface Session {
  userId: string;
  username: string;
  email: string;
}

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      // Read the non-httpOnly appUsername cookie set by login/page.tsx.
      // This avoids using /api/physicians as a session probe — that call was
      // returning 401 in v0.dev's iframe environment because the httpOnly
      // sess_ cookie wasn't being forwarded, causing an immediate redirect loop.
      const raw = document.cookie
        .split('; ')
        .find(row => row.startsWith('appUsername='))
        ?.split('=')[1];

      if (!raw) {
        router.push('/login');
        return;
      }

      const username = decodeURIComponent(raw);
      setSession({ userId: username, username, email: '' });
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      document.cookie = 'appUsername=; max-age=0; path=/';
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F1EFE9] flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F1EFE9] flex flex-col p-4 overflow-hidden">
      <div className="flex flex-col flex-1 max-w-5xl w-full mx-auto min-h-0">

        {/* Header */}
        <div className="flex justify-between items-center mb-4 shrink-0">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">PitchMD™</h1>
            <p style={{
              background: 'linear-gradient(90deg, #FF6B00, #00C8FF, #FF6B00)',
              backgroundSize: '300% 300%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'gradientShift 6s ease infinite',
            }} className="mt-0.5">Welcome, {session?.username}</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleLogout} className="flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Logout
          </Button>
        </div>

        {/* Chat — fills remaining height */}
        <Card className="p-6 bg-white flex flex-col flex-1 min-h-0 overflow-hidden">
          <ChatInterface username={session?.username ?? 'Rep'} />
        </Card>
        <p className="text-center text-xs text-slate-700 mt-2 shrink-0">Powered by SRIntelligence™</p>

      </div>
    </div>
  );
}
