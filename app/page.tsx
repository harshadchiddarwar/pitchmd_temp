// Cache buster - rebuild trigger v2
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard (will be redirected to login if not authenticated)
    router.push('/dashboard');
  }, [router]);

  return null;
}
