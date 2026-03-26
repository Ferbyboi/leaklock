export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { RevenueTrendChart } from '@/components/dashboard/RevenueTrendChart';
import { PipelineBreakdown } from '@/components/dashboard/PipelineBreakdown';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  crm_job_id: string;
  status: string;
  created_at: string;
  reconciliation_results?: { estimated_leak_cents: number; status: string }[];
}

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string | null;
  created_at: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'red' | 'green' | 'yellow' | 'default';
  trend?: { dir: 'up' | 'down' | 'flat'; label: string };
}) {
  const accentClass = {
    red: 'text-red-600', green: 'text-green-600',
    yellow: 'text-yellow-600', default: 'text-gray-900',
  }[accent ?? 'default'];

  const trendColor = !trend ? '' :
    trend.dir === 'up' ? 'text-red-500' :
    trend.dir === 'down' ? 'text-green-500' : 'text-gray-400';

  const trendIcon = !trend ? '' :
    trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '→';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <p className="text-[11px] text-gray-400 mb-1.5 font-semibold uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-extrabold tracking-tight ${accentClass}`}>{value}</p>
      <div className="flex items-center gap-2 mt-1.5">
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
        {trend && (
          <span className={`text-[11px] font-semibold ${trendColor}`}>
            {trendIcon} {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  pending_invoice: 'bg-yellow-400',
  approved:        'bg-green-500',
  discrepancy:     'bg-red-500',
  frozen:          'bg-orange-400',
  parsing:         'bg-blue-400',
};
const STATUS_LABEL: Record<string, string> = {
  pending_invoice: 'Pending',
  approved:        'Approved',
  discrepancy:     'Leak',
  frozen:          'Frozen',
  parsing:         'Parsing',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-800',
  warning:  'bg-yellow-50 border-yellow-200 text-yellow-800',
  info:     'bg-blue-50 border-blue-200 text-blue-800',
};
const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning:  'bg-yellow-100 text-yellow-700',
  info:     'bg-blue-100 text-blue-700',
};

// ── Getting started (empty state) ─────────────────────────────────────────────

function GettingStarted({ role, crmConnected, hasJobs, hasFieldEvents, hasReconResults }: {
  role: string;
  crmConnected: boolean;
  hasJobs: boolean;
  hasFieldEvents: boolean;
  hasReconResults: boolean;
}) {
  const steps = [
    { icon: '🔗', title: 'Connect your CRM',   desc: 'Set up a webhook from Jobber, ServiceTitan, or your CRM to start ingesting jobs automatically.', href: '/settings', cta: 'Go to Settings', done: crmConnected },
    { icon: '📋', title: 'Ingest your first job', desc: 'Once your webhook is live, jobs will appear here automatically after every service call.', href: '/jobs', cta: 'View Jobs', done: hasJobs },
    { icon: '🎙', title: 'Capture field notes',  desc: 'Use voice or photos on a job site — AI parses and reconciles against your quote.', href: '/field', cta: 'Open Field Capture', done: hasFieldEvents },
    ...(role !== 'tech' ? [{ icon: '🔍', title: 'Review revenue leaks', desc: 'When the engine detects unbilled work, it lands in the Auditor queue for your decision.', href: '/auditor', cta: 'Open Auditor', done: hasReconResults }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-200 mb-1">Welcome to LeakLock</p>
        <h2 className="text-xl font-bold mb-2">Let&apos;s catch your first revenue leak</h2>
        <p className="text-sm text-blue-100 max-w-lg">
          LeakLock watches every job — comparing field work, quotes, and invoices to make sure nothing goes unbilled.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {steps.map((step, i) => (
          <div key={i} className={`rounded-2xl border p-5 flex flex-col gap-3 ${step.done ? 'border-green-200 bg-green-50' : 'bg-white border-gray-100 shadow-sm'}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{step.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                  {step.done && <span className="text-green-600 text-sm font-bold">&#10003;</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
            {step.done
              ? <span className="self-start px-3 py-1.5 text-xs font-medium text-green-700">Done ✓</span>
              : <Link href={step.href} className="self-start px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">{step.cta} →</Link>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = (user.app_metadata?.user_role ?? user.user_metadata?.user_role ?? 'tech') as string;
  const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id ?? '';

  // ── Fetch jobs directly from Supabase ──────────────────────────────────────
  const { data: jobRows, count: jobCount } = await supabase
    .from('jobs')
    .select('id, crm_job_id, status, created_at, reconciliation_results(estimated_leak_cents, status)', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);

  const jobs: Job[] = (jobRows ?? []) as Job[];
  const total = jobCount ?? 0;
  void 0; // apiOk removed — unused

  // ── Fetch supporting data from Supabase ────────────────────────────────────
  const { data: tenant } = await supabase
    .from('tenants')
    .select('webhook_url, crm_type')
    .eq('id', tenantId)
    .single();

  const { count: fieldEventCount } = await supabase
    .from('field_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId ?? '');

  const { count: reconCount } = await supabase
    .from('reconciliation_results')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId ?? '');

  // Recent alerts
  const { data: recentAlerts } = await supabase
    .from('alerts')
    .select('id, severity, title, body, created_at')
    .eq('tenant_id', tenantId ?? '')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  const hasJobs = jobs.length > 0;
  const hasFieldEvents = (fieldEventCount ?? 0) > 0;
  const hasReconResults = (reconCount ?? 0) > 0;

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!hasJobs) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <GettingStarted
          role={role}
          crmConnected={!!(tenant?.webhook_url || tenant?.crm_type)}
          hasJobs={hasJobs}
          hasFieldEvents={hasFieldEvents}
          hasReconResults={hasReconResults}
        />
      </div>
    );
  }

  // ── KPI calculations ────────────────────────────────────────────────────────
  const leakJobs = jobs.filter(j => j.status === 'discrepancy' || j.status === 'frozen');
  const totalLeakCents = leakJobs.reduce(
    (s, j) => s + (j.reconciliation_results?.[0]?.estimated_leak_cents ?? 0), 0
  );
  const recoveredJobs = jobs.filter(
    j => j.status === 'approved' && (j.reconciliation_results?.[0]?.estimated_leak_cents ?? 0) > 0
  );
  const totalRecoveredCents = recoveredJobs.reduce(
    (s, j) => s + (j.reconciliation_results?.[0]?.estimated_leak_cents ?? 0), 0
  );
  const catchRate = total > 0 ? Math.round(((leakJobs.length + recoveredJobs.length) / total) * 100) : 0;

  // ── Revenue trend: group by day (last 7 days) ───────────────────────────────
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const trendMap = new Map<string, { leak: number; recovered: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    trendMap.set(d.toDateString(), { leak: 0, recovered: 0 });
  }
  for (const job of jobs) {
    const key = new Date(job.created_at).toDateString();
    if (!trendMap.has(key)) continue;
    const entry = trendMap.get(key)!;
    const cents = job.reconciliation_results?.[0]?.estimated_leak_cents ?? 0;
    if (job.status === 'discrepancy' || job.status === 'frozen') {
      entry.leak += cents / 100;
    } else if (job.status === 'approved' && cents > 0) {
      entry.recovered += cents / 100;
    }
  }
  const trendData = Array.from(trendMap.entries()).map(([dateStr, vals]) => ({
    label: dayLabels[new Date(dateStr).getDay()] ?? '',
    ...vals,
  }));

  // ── Pipeline breakdown ──────────────────────────────────────────────────────
  const statusCounts = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pipelineSegments = [
    { label: 'Leak',     count: (statusCounts.discrepancy ?? 0) + (statusCounts.frozen ?? 0), color: 'bg-red-400',    textColor: 'text-red-700' },
    { label: 'Pending',  count: statusCounts.pending_invoice ?? 0,                            color: 'bg-yellow-400', textColor: 'text-yellow-700' },
    { label: 'Approved', count: statusCounts.approved ?? 0,                                   color: 'bg-green-400',  textColor: 'text-green-700' },
    { label: 'Parsing',  count: statusCounts.parsing ?? 0,                                    color: 'bg-blue-400',   textColor: 'text-blue-700' },
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Revenue reconciliation overview</p>
        </div>
        <Link href="/jobs" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
          View all jobs →
        </Link>
      </div>

      {/* Leak alert banner */}
      {leakJobs.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <p className="text-sm font-semibold text-red-800">
              {leakJobs.length} revenue leak{leakJobs.length !== 1 ? 's' : ''} detected —{' '}
              <span className="font-bold">${(totalLeakCents / 100).toFixed(2)}</span> at risk
            </p>
          </div>
          <Link href="/auditor" className="px-3 py-1.5 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
            Review now
          </Link>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Jobs"
          value={total.toLocaleString()}
          sub="all time"
        />
        <KpiCard
          label="Open Leaks"
          value={leakJobs.length.toString()}
          sub="need review"
          accent={leakJobs.length > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label="At Risk"
          value={`$${(totalLeakCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          sub="unreviewed leaks"
          accent={totalLeakCents > 0 ? 'red' : 'default'}
        />
        <KpiCard
          label="Catch Rate"
          value={`${catchRate}%`}
          sub="leaks detected"
          accent={catchRate >= 85 ? 'green' : catchRate >= 60 ? 'yellow' : 'red'}
          trend={catchRate >= 85 ? { dir: 'flat', label: 'on target' } : { dir: 'up', label: 'needs work' }}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Revenue trend */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Revenue at Risk — Last 7 Days</h2>
              <p className="text-xs text-gray-400 mt-0.5">Red = leak detected, Green = recovered</p>
            </div>
            {totalRecoveredCents > 0 && (
              <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded-lg border border-green-200">
                ${(totalRecoveredCents / 100).toFixed(2)} recovered
              </span>
            )}
          </div>
          <RevenueTrendChart data={trendData} />
        </div>

        {/* Pipeline breakdown + alerts */}
        <div className="space-y-4">

          {/* Pipeline */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Job Pipeline</h2>
            <PipelineBreakdown total={total} segments={pipelineSegments} />
          </div>

          {/* Active alerts */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Active Alerts</h2>
              <Link href="/alerts" className="text-xs text-blue-600 hover:underline">See all</Link>
            </div>
            {!recentAlerts?.length ? (
              <p className="text-xs text-gray-400 py-2">No active alerts — all clear ✓</p>
            ) : (
              <ul className="space-y-2">
                {(recentAlerts as Alert[]).slice(0, 3).map((alert) => (
                  <li key={alert.id} className={`rounded-xl border px-3 py-2 text-xs ${SEVERITY_STYLE[alert.severity]}`}>
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEVERITY_BADGE[alert.severity]}`}>
                        {alert.severity}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{alert.title}</p>
                        {alert.body && <p className="opacity-70 mt-0.5 line-clamp-1">{alert.body}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>

      {/* Recent jobs table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Recent Jobs</h2>
          <Link href="/jobs" className="text-xs text-blue-600 hover:underline">See all</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left text-xs">
              <th className="px-5 py-3 font-medium">Job ID</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Leak Amount</th>
              <th className="px-5 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {jobs.slice(0, 8).map((job) => {
              const leak = job.reconciliation_results?.[0]?.estimated_leak_cents ?? 0;
              return (
                <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/jobs/${job.id}`} className="font-mono text-blue-600 hover:underline text-xs font-semibold">
                      {job.crm_job_id}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[job.status] ?? 'bg-gray-300'}`} />
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {leak > 0
                      ? <span className="text-red-600 font-bold text-xs">${(leak / 100).toFixed(2)}</span>
                      : <span className="text-gray-300 text-xs">—</span>
                    }
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {new Date(job.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
