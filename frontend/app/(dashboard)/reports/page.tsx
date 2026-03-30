export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ExportButton } from '@/components/ui/ExportButton';
import { AuditPdfButton } from '@/components/ui/AuditPdfButton';

interface ReconciliationResult {
  id: string;
  job_id: string;
  status: string;
  estimated_leak_cents: number;
  auditor_action: string | null;
  run_at: string;
  jobs: { crm_job_id: string; customer_name: string; status: string } | null;
}

interface WeekBucket {
  isoWeek: string;
  jobsProcessed: number;
  leaksFound: number;
  revenueAtRiskCents: number;
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getLast12ISOWeeks(): string[] {
  const weeks: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(getISOWeek(d));
  }
  // Deduplicate while preserving order
  return [...new Set(weeks)];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    discrepancy: 'bg-red-50 text-red-700 border border-red-200',
    frozen:      'bg-orange-50 text-orange-700 border border-orange-200',
    approved:    'bg-green-50 text-green-700 border border-green-200',
    parsing:     'bg-blue-50 text-blue-700 border border-blue-200',
    pending_invoice: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  };
  const label: Record<string, string> = {
    discrepancy:     'Leak',
    frozen:          'Frozen',
    approved:        'Approved',
    parsing:         'Parsing',
    pending_invoice: 'Pending',
  };
  const cls = map[status] ?? 'bg-gray-50 text-gray-700 border border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label[status] ?? status}
    </span>
  );
}

function actionBadge(action: string | null) {
  if (!action) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const map: Record<string, string> = {
    confirm_leak:  'bg-red-50 text-red-700 border border-red-200',
    false_positive: 'bg-gray-50 text-gray-600 border border-gray-200',
    waived:        'bg-yellow-50 text-yellow-700 border border-yellow-200',
  };
  const label: Record<string, string> = {
    confirm_leak:   'Confirmed',
    false_positive: 'False Positive',
    waived:         'Waived',
  };
  const cls = map[action] ?? 'bg-gray-50 text-gray-600 border border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label[action] ?? action}
    </span>
  );
}

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const tenantId: string = user.user_metadata?.tenant_id ?? user.id;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: results } = await supabase
    .from('reconciliation_results')
    .select('id, job_id, status, estimated_leak_cents, auditor_action, run_at, jobs(crm_job_id, customer_name, status)')
    .eq('tenant_id', tenantId)
    .gte('run_at', ninetyDaysAgo.toISOString())
    .order('run_at', { ascending: false })
    .limit(500);

  // Supabase may return the joined `jobs` relation as an array (one-to-many)
  // or as null when there is no matching row. Normalise it to a single object
  // or null so the rest of the page can use `r.jobs?.field` safely without
  // hitting "Cannot read properties of null (reading '0')".
  const safeResults: ReconciliationResult[] = ((results as unknown as Array<
    Omit<ReconciliationResult, 'jobs'> & { jobs: ReconciliationResult['jobs'] | ReconciliationResult['jobs'][] | null }
  >) ?? []).map((r) => ({
    ...r,
    jobs: Array.isArray(r.jobs) ? (r.jobs[0] ?? null) : (r.jobs ?? null),
  }));

  // ── Compute KPI metrics ─────────────────────────────────────────────────────

  const leaks = safeResults.filter(
    (r) => r.status === 'discrepancy' || r.status === 'frozen'
  );
  const totalLeaks      = leaks.length;
  const totalLeakCents  = leaks.reduce((sum, r) => sum + (r.estimated_leak_cents ?? 0), 0);
  const confirmed       = safeResults.filter((r) => r.auditor_action === 'confirm_leak').length;
  const falsePositives  = safeResults.filter((r) => r.auditor_action === 'false_positive').length;
  const reviewed        = confirmed + falsePositives;
  const catchRate       = reviewed > 0 ? (confirmed / reviewed) * 100 : 0;
  const avgLeakCents    = totalLeaks > 0 ? totalLeakCents / totalLeaks : 0;

  const catchRateColor =
    catchRate >= 85 ? 'text-green-600' :
    catchRate >= 70 ? 'text-yellow-600' :
    'text-red-600';

  // ── Weekly trend (last 12 ISO weeks) ───────────────────────────────────────

  const last12Weeks = getLast12ISOWeeks();
  const weekMap: Record<string, WeekBucket> = {};
  for (const w of last12Weeks) {
    weekMap[w] = { isoWeek: w, jobsProcessed: 0, leaksFound: 0, revenueAtRiskCents: 0 };
  }

  for (const r of safeResults) {
    const w = getISOWeek(new Date(r.run_at));
    if (weekMap[w]) {
      weekMap[w].jobsProcessed += 1;
      if (r.status === 'discrepancy' || r.status === 'frozen') {
        weekMap[w].leaksFound += 1;
        weekMap[w].revenueAtRiskCents += r.estimated_leak_cents ?? 0;
      }
    }
  }

  const weekBuckets = last12Weeks.map((w) => weekMap[w]).filter((b): b is WeekBucket => b != null);

  return (
    <div className="max-w-6xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Revenue Recovery Report</h1>
          <p className="text-sm text-gray-400 mt-0.5">Last 90 days</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}/reports/insurance-letter`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Insurance Letter
          </a>
          <ExportButton type="leaks" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Total Leaks Detected</p>
          <p className={`text-3xl font-bold ${totalLeaks > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {totalLeaks}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Total Revenue at Risk</p>
          <p className={`text-3xl font-bold ${totalLeakCents > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            ${(totalLeakCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Confirmed Leaks</p>
          <p className="text-3xl font-bold text-gray-900">{confirmed}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">False Positives</p>
          <p className="text-3xl font-bold text-gray-900">{falsePositives}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Catch Rate</p>
          <p className={`text-3xl font-bold ${catchRateColor}`}>
            {reviewed > 0 ? `${catchRate.toFixed(1)}%` : '—'}
          </p>
          {avgLeakCents > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Avg ${(avgLeakCents / 100).toFixed(2)} / leak
            </p>
          )}
        </div>
      </div>

      {safeResults.length === 0 ? (
        /* Empty state */
        <div className="bg-white rounded-xl border border-gray-100 py-20 text-center">
          <p className="text-sm font-semibold text-gray-700">No data yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            Leaks will appear here once the reconciliation engine processes your first jobs.
          </p>
        </div>
      ) : (
        <>
          {/* Weekly trend table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Weekly Trend — Last 12 Weeks</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Week</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Jobs Processed</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Leaks Found</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Revenue at Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {weekBuckets.map((bucket) => (
                    <tr key={bucket.isoWeek} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-gray-700">{bucket.isoWeek}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{bucket.jobsProcessed}</td>
                      <td className="px-5 py-3 text-right">
                        {bucket.leaksFound > 0
                          ? <span className="text-red-600 font-medium">{bucket.leaksFound}</span>
                          : <span className="text-gray-400">0</span>
                        }
                      </td>
                      <td className="px-5 py-3 text-right">
                        {bucket.revenueAtRiskCents > 0
                          ? <span className="text-red-600 font-medium">
                              ${(bucket.revenueAtRiskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Full results table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">All Results</h2>
              <p className="text-xs text-gray-400 mt-0.5">{safeResults.length} records in the last 90 days</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Job ID</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Detected</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Amount</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Auditor Action</th>
                    <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {safeResults.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <Link
                          href={`/jobs/${r.job_id}`}
                          className="font-mono text-xs font-semibold text-blue-600 hover:underline"
                        >
                          {r.jobs?.crm_job_id ?? r.job_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-gray-700">
                        {r.jobs?.customer_name ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(r.run_at).toLocaleDateString()} {new Date(r.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {r.estimated_leak_cents > 0
                          ? <span className="font-medium text-red-600">
                              ${(r.estimated_leak_cents / 100).toFixed(2)}
                            </span>
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                      <td className="px-5 py-3">{statusBadge(r.status)}</td>
                      <td className="px-5 py-3">{actionBadge(r.auditor_action)}</td>
                      <td className="px-5 py-3">
                        <AuditPdfButton jobId={r.job_id} crmJobId={r.jobs?.crm_job_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
