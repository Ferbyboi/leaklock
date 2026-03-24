'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

interface Job {
  id: string;
  crm_job_id: string;
  status: string;
  created_at: string;
  field_notes?: { raw_text?: string }[];
  reconciliation_results?: { status: string; estimated_leak_cents: number }[];
}

const STATUS_STYLES: Record<string, string> = {
  pending_invoice: 'bg-yellow-50 text-yellow-700',
  approved:        'bg-green-50 text-green-700',
  discrepancy:     'bg-red-50 text-red-700',
  frozen:          'bg-orange-50 text-orange-700',
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function JobsTable({ jobs }: { jobs: Job[] }) {
  const [approving, setApproving] = useState<string | null>(null);

  async function handleApprove(jobId: string) {
    setApproving(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/approve`, { method: 'POST' });
      if (res.ok) window.location.reload();
    } finally {
      setApproving(null);
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        No jobs found.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-gray-500 text-left">
            <th className="px-4 py-3 font-medium">Job ID</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Leak Detected</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {jobs.map((job) => {
            const rec = job.reconciliation_results?.[0];
            const leakCents = rec?.estimated_leak_cents ?? 0;
            return (
              <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono">
                  <Link href={`/jobs/${job.id}`} className="text-blue-600 hover:underline">
                    {job.crm_job_id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[job.status] ?? 'bg-gray-50 text-gray-600')}>
                    {job.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {leakCents > 0 ? (
                    <span className="text-red-600 font-medium">{formatCents(leakCents)}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {new Date(job.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {job.status === 'pending_invoice' && (
                    <button
                      onClick={() => handleApprove(job.id)}
                      disabled={approving === job.id}
                      className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {approving === job.id ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
