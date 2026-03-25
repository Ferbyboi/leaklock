'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

/**
 * Post-email-confirmation onboarding step.
 * Reached via /auth/callback when user has no tenant yet.
 */
export default function OnboardingPage() {
  const [companyName, setCompanyName] = useState('');
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('Session expired. Please sign in again.');
      setLoading(false);
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const res = await fetch(`${apiUrl}/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ company_name: companyName }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? 'Setup failed. Please try again.');
      setLoading(false);
      return;
    }

    await supabase.auth.refreshSession();
    router.push('/billing');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-8 text-center">
          <div className="text-3xl mb-3">👋</div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to LeakLock</h1>
          <p className="text-sm text-gray-500 mt-1">One last step — tell us your company name</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">
              Company name
            </label>
            <input
              id="company"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme HVAC Services"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Setting up…' : 'Complete setup'}
          </button>
        </form>
      </div>
    </div>
  );
}
