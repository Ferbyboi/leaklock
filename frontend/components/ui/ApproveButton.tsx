'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function ApproveButton({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleApprove() {
    setLoading(true);
    const res = await fetch(`/api/jobs/${jobId}/approve`, { method: 'POST' });
    if (res.ok) {
      toast.success('Invoice approved');
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.detail ?? 'Could not approve invoice');
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handleApprove}
      disabled={loading}
      className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
    >
      {loading ? 'Approving…' : 'Approve Invoice'}
    </button>
  );
}
