'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  jobId: string;
  resultId: string;
}

export default function AuditorReviewButtons({ jobId, resultId }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function handleAction(action: 'confirm_leak' | 'false_positive' | 'override_approve') {
    setLoading(action);
    const res = await fetch(`/api/jobs/${jobId}/reconciliation/${resultId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) router.refresh();
    setLoading(null);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => handleAction('false_positive')}
        disabled={!!loading}
        className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors"
      >
        {loading === 'false_positive' ? 'Marking…' : 'False Positive'}
      </button>
      <button
        onClick={() => handleAction('confirm_leak')}
        disabled={!!loading}
        className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
      >
        {loading === 'confirm_leak' ? 'Confirming…' : 'Confirm Leak'}
      </button>
      <button
        onClick={() => handleAction('override_approve')}
        disabled={!!loading}
        className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
      >
        {loading === 'override_approve' ? 'Overriding…' : 'Admin Override'}
      </button>
    </div>
  );
}
