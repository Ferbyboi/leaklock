'use client';

import { useState } from 'react';
import { toast } from 'sonner';

export default function BillingActions({ planId }: { planId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const endpoint = planId === 'portal' ? '/api/billing/portal' : `/api/billing/checkout/${planId}`;
    const res = await fetch(endpoint, { method: 'POST' });
    if (res.ok) {
      const { checkout_url, portal_url } = await res.json();
      window.location.href = checkout_url ?? portal_url;
    } else {
      toast.error('Could not connect to billing — please try again');
      setLoading(false);
    }
  }

  if (planId === 'portal') {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Opening…' : 'Manage Subscription'}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="w-full py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
    >
      {loading ? 'Redirecting…' : 'Get Started'}
    </button>
  );
}
