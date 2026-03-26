'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import posthog from 'posthog-js';

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
    if (res.ok) {
      const labels: Record<string, string> = {
        false_positive: 'Marked as false positive',
        confirm_leak: 'Revenue leak confirmed',
        override_approve: 'Admin override applied',
      };
      toast.success(labels[action] ?? 'Action recorded');
      try {
        const eventNames: Record<string, string> = {
          false_positive: 'auditor_false_positive',
          confirm_leak: 'auditor_confirm_leak',
          override_approve: 'auditor_override_approve',
        };
        posthog.capture(eventNames[action] ?? action, { job_id: jobId, result_id: resultId });
      } catch {
        // analytics must never break the UI
      }
      router.refresh();
    } else {
      toast.error('Action failed — please try again');
    }
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
