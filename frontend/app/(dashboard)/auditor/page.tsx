export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuditorReviewButtons from '@/components/ui/AuditorReviewButtons';
import { ExportButton } from '@/components/ui/ExportButton';

interface ReconciliationResult {
  id: string;
  job_id: string;
  estimated_leak_cents: number;
  missing_items: { item: string; qty: number; estimated_leak_cents: number }[];
  run_at: string;
  auditor_action: string | null;
  jobs: { crm_job_id: string; status: string; created_at: string } | null;
}

export default async function AuditorDashboard() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const tenantId: string = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id ?? user.id;

  // Fetch directly from Supabase — RLS enforces tenant isolation
  const { data: rawResults } = await supabase
    .from('reconciliation_results')
    .select('id, job_id, estimated_leak_cents, missing_items, run_at, auditor_action, jobs(crm_job_id, status, created_at)')
    .eq('tenant_id', tenantId)
    .is('auditor_action', null)
    .in('status', ['discrepancy', 'error'])
    .order('estimated_leak_cents', { ascending: false })
    .limit(100);

  const results: ReconciliationResult[] = (rawResults as unknown as ReconciliationResult[]) ?? [];
  const unreviewed_count = results.length;
  const total_unreviewed_leak_cents = results.reduce((sum, r) => sum + (r.estimated_leak_cents ?? 0), 0);

  // Sort by leak value descending (API already does this, but just in case)
  const sorted = [...results].sort((a, b) => b.estimated_leak_cents - a.estimated_leak_cents);
  const topLeak = sorted[0];
  const avgLeak = results.length
    ? Math.round(total_unreviewed_leak_cents / results.length)
    : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Auditor Review</h1>
          <p className="text-sm text-gray-400 mt-0.5">Revenue discrepancies requiring your decision</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton type="leaks" />
          {unreviewed_count > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-xs font-semibold text-red-700">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              {unreviewed_count} unreviewed
            </span>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Unreviewed</p>
          <p className={`text-3xl font-bold ${unreviewed_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {unreviewed_count}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Total at Risk</p>
          <p className={`text-3xl font-bold ${total_unreviewed_leak_cents > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            ${(total_unreviewed_leak_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Avg per Job</p>
          <p className="text-3xl font-bold text-gray-900">
            {avgLeak > 0 ? `$${(avgLeak / 100).toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Highest Single</p>
          <p className="text-3xl font-bold text-gray-900">
            {topLeak?.estimated_leak_cents ? `$${(topLeak.estimated_leak_cents / 100).toFixed(2)}` : '—'}
          </p>
        </div>
      </div>

      {/* Results */}
      {results.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 py-20 text-center">
          <div className="text-4xl mb-3">✓</div>
          <p className="text-sm font-semibold text-green-700">All clear — no unreviewed discrepancies</p>
          <p className="text-xs text-gray-400 mt-1">New revenue leaks will appear here as they're detected.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-5">
              {/* Row header */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <Link
                    href={`/jobs/${r.job_id}`}
                    className="font-mono text-sm font-semibold text-blue-600 hover:underline"
                  >
                    {r.jobs?.crm_job_id ?? r.job_id.slice(0, 8)}
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Detected {new Date(r.run_at).toLocaleDateString()} at {new Date(r.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className="text-xl font-bold text-red-600 shrink-0">
                  ${(r.estimated_leak_cents / 100).toFixed(2)}
                </span>
              </div>

              {/* Missing items */}
              {r.missing_items?.length > 0 && (
                <div className="mb-4 space-y-1">
                  {r.missing_items.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-red-50 rounded-lg px-3 py-1.5">
                      <span className="text-gray-700">{m.item}</span>
                      <span className="text-red-600 font-medium shrink-0 ml-4">
                        {(m.qty ?? 1) > 1 ? `${m.qty}× ` : ''}
                        {typeof m.estimated_leak_cents === 'number'
                          ? `$${(m.estimated_leak_cents / 100).toFixed(2)}`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <AuditorReviewButtons jobId={r.job_id} resultId={r.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
