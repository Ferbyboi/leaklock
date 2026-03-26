'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { ExportButton } from '@/components/ui/ExportButton';

type Job = {
  id: string;
  crm_job_id: string;
  status: string;
  created_at: string;
  reconciliation_results?: { status: string; estimated_leak_cents: number }[];
};

const STATUS_TABS = [
  { key: '',              label: 'All' },
  { key: 'pending_invoice', label: 'Pending' },
  { key: 'discrepancy',   label: 'Leaks' },
  { key: 'frozen',        label: 'Frozen' },
  { key: 'approved',      label: 'Approved' },
];

const STATUS_DOT: Record<string, string> = {
  pending_invoice: 'bg-yellow-400',
  approved:        'bg-green-500',
  discrepancy:     'bg-red-500',
  frozen:          'bg-orange-400',
  parsing:         'bg-blue-400',
};

const STATUS_PILL: Record<string, string> = {
  pending_invoice: 'bg-yellow-50 text-yellow-700',
  approved:        'bg-green-50 text-green-700',
  discrepancy:     'bg-red-50 text-red-700',
  frozen:          'bg-orange-50 text-orange-700',
  parsing:         'bg-blue-50 text-blue-700',
};

function JobsContent() {
  const params   = useSearchParams();
  const router   = useRouter();
  const initStatus = params.get('status') ?? '';

  const [jobs, setJobs]         = useState<Job[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState(initStatus);
  const [page, setPage]         = useState(0);
  const [approving, setApproving] = useState<string | null>(null);
  const LIMIT = 25;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL!;

  async function getToken() {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    return session?.access_token ?? '';
  }

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const url = new URL(`${apiUrl}/jobs`);
      url.searchParams.set('limit', String(LIMIT));
      url.searchParams.set('offset', String(page * LIMIT));
      if (status) url.searchParams.set('status', status);
      if (search.trim()) url.searchParams.set('search', search.trim());

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl, status, search, page]);

  useEffect(() => {
    const t = setTimeout(fetchJobs, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchJobs, search]);

  function handleTabChange(key: string) {
    setStatus(key);
    setPage(0);
    router.replace(key ? `/jobs?status=${key}` : '/jobs', { scroll: false });
  }

  async function handleApprove(jobId: string) {
    setApproving(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/approve`, { method: 'POST' });
      if (res.ok) fetchJobs();
    } finally {
      setApproving(null);
    }
  }

  const title = status === 'discrepancy' ? 'Revenue Leaks'
    : status ? `Jobs — ${STATUS_TABS.find(t => t.key === status)?.label ?? status}`
    : 'All Jobs';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <div className="flex items-center gap-3">
          <ExportButton type="jobs" />
          <span className="text-sm text-gray-400">{total} jobs</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search job ID…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                status === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-50 last:border-0">
              <div className="h-4 w-24 bg-gray-100 animate-pulse rounded" />
              <div className="h-4 w-20 bg-gray-100 animate-pulse rounded" />
              <div className="h-4 w-16 bg-gray-100 animate-pulse rounded ml-auto" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-16 text-center">
          <p className="text-sm text-gray-400">
            {search ? `No jobs matching "${search}"` : 'No jobs found.'}
          </p>
          {search && (
            <button onClick={() => setSearch('')} className="text-xs text-blue-600 hover:underline mt-2">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-left text-xs bg-gray-50/50">
                <th className="px-4 py-3 font-medium">Job ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Leak Detected</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {jobs.map((job) => {
                const rec = job.reconciliation_results?.[0];
                const leak = rec?.estimated_leak_cents ?? 0;
                return (
                  <tr key={job.id} className="hover:bg-gray-50/70 transition-colors group">
                    <td className="px-4 py-3">
                      <Link href={`/jobs/${job.id}`} className="font-mono text-blue-600 hover:underline text-xs">
                        {job.crm_job_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_PILL[job.status] ?? 'bg-gray-50 text-gray-600'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[job.status] ?? 'bg-gray-400'}`} />
                        {job.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {leak > 0 ? (
                        <span className="text-red-600 font-semibold text-xs">${(leak / 100).toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {job.status === 'pending_invoice' && (
                          <button
                            onClick={() => handleApprove(job.id)}
                            disabled={approving === job.id}
                            className="px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {approving === job.id ? '…' : 'Approve'}
                          </button>
                        )}
                        <Link
                          href={`/jobs/${job.id}`}
                          className="px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <span className="text-xs text-gray-400">
                {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * LIMIT >= total}
                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-5">
        <div className="h-8 w-32 bg-gray-100 animate-pulse rounded" />
        <div className="h-40 bg-gray-100 animate-pulse rounded-xl" />
      </div>
    }>
      <JobsContent />
    </Suspense>
  );
}
