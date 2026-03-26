export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

interface TechJob {
  id: string;
  crm_job_id: string;
  customer_name: string;
  address: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { dot: string; label: string; text: string }> = {
  pending_invoice: { dot: 'bg-yellow-400', label: 'Pending',  text: 'text-yellow-700' },
  approved:        { dot: 'bg-green-500',  label: 'Approved', text: 'text-green-700'  },
  discrepancy:     { dot: 'bg-red-500',    label: 'Leak',     text: 'text-red-700'    },
  frozen:          { dot: 'bg-orange-400', label: 'Frozen',   text: 'text-orange-700' },
  parsing:         { dot: 'bg-blue-400',   label: 'Parsing',  text: 'text-blue-700'   },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { dot: 'bg-gray-300', label: status, text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-white border ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default async function TechPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const today = new Date().toISOString().split('T')[0] ?? '';
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, crm_job_id, customer_name, address, status, scheduled_at, created_at')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(100);

  const jobs: TechJob[] = (jobRows as TechJob[] | null) ?? [];
  const todayJobs = jobs.filter(j => j.scheduled_at?.startsWith(today));
  const upcomingJobs = jobs
    .filter(j => j.scheduled_at && j.scheduled_at > today + 'T23:59:59')
    .slice(0, 5);

  const completedToday = todayJobs.filter(j => j.status === 'approved').length;
  const pendingToday = todayJobs.filter(j => j.status !== 'approved').length;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Jobs</h1>
        <p className="text-sm text-gray-400 mt-0.5">{todayLabel}</p>
      </div>

      {/* Day summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{todayJobs.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">Today</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{completedToday}</p>
          <p className="text-xs text-gray-400 mt-0.5">Done</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{pendingToday}</p>
          <p className="text-xs text-gray-400 mt-0.5">Pending</p>
        </div>
      </div>

      {/* Today's jobs */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Today's Schedule</h2>
        {todayJobs.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-8 text-center">
            <p className="text-sm text-gray-400">No jobs scheduled for today.</p>
            <Link href="/field" className="mt-3 inline-block text-xs text-blue-600 hover:underline">
              Open Field Capture →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {todayJobs.map(job => {
              const time = job.scheduled_at
                ? new Date(job.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : null;
              return (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {time && <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{time}</span>}
                        <span className="font-mono text-xs text-gray-400">{job.crm_job_id}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{job.customer_name}</p>
                      {job.address && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{job.address}</p>
                      )}
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/field?job=${job.id}`}
                      onClick={e => e.stopPropagation()}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Capture Notes
                    </Link>
                    <span className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      View Job →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Upcoming */}
      {upcomingJobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Upcoming</h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
            {upcomingJobs.map(job => {
              const date = job.scheduled_at
                ? new Date(job.scheduled_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : 'Unscheduled';
              return (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{job.customer_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{date} · {job.crm_job_id}</p>
                  </div>
                  <StatusBadge status={job.status} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/field"
            className="flex flex-col items-center gap-2 p-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-center"
          >
            <span className="text-2xl">⊕</span>
            <span className="text-sm font-medium">Field Capture</span>
          </Link>
          <Link
            href="/jobs"
            className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl hover:border-blue-200 dark:hover:border-blue-800 transition-colors text-center"
          >
            <span className="text-2xl">⊞</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">All Jobs</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
