'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }

      const data = await response.json();
      if (data.success) {
        // FIX: persist username in a readable (non-httpOnly) cookie so the dashboard
        // can display it. The auth session itself is still stored in httpOnly cookies —
        // this cookie carries only display info, not credentials.
        document.cookie = `appUsername=${encodeURIComponent(data.username)}; path=/; max-age=86400; SameSite=Lax`;
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1EFE9] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-lg bg-white">
        <div className="p-12">
          <div className="mb-10 text-center">
            <h1 className="text-4xl font-semibold text-slate-900 mb-3">PitchMD™</h1>
            <p className="text-lg" style={{
              background: 'linear-gradient(90deg, #FF6B00, #00C8FF, #FF6B00)',
              backgroundSize: '300% 300%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'gradientShift 6s ease infinite',
            }}>Navigate. Educate. Advocate.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-base font-medium text-slate-700 mb-2">
                Username
              </label>
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                className="w-full text-base"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-base font-medium text-slate-700 mb-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full text-base"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-base text-red-700">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full mt-6 text-base py-6"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </Button>
          </form>

          <p className="text-center text-base text-slate-600 mt-8">
            Demo credentials: john_rep / password
          </p>
        </div>
      </Card>
    </div>
  );
}
