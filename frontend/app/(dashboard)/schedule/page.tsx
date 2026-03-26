export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  MaintenanceCalendar,
  type ScheduleJob,
} from "@/components/dashboard/MaintenanceCalendar";

async function getScheduleJobs(): Promise<ScheduleJob[]> {
  try {
    const supabase = await createServerSupabaseClient();

    // Fetch jobs for the current tenant — RLS enforces tenant_id filtering
    const { data, error } = await supabase
      .from("jobs")
      .select("id, crm_job_id, status, created_at, scheduled_at")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[schedule/page] Supabase error:", error.message);
      return [];
    }

    return (data ?? []) as ScheduleJob[];
  } catch (err) {
    console.error("[schedule/page] Unexpected error:", err);
    return [];
  }
}

export default async function SchedulePage() {
  const jobs = await getScheduleJobs();

  const totalJobs = jobs.length;
  const scheduledJobs = jobs.filter((j) => j.scheduled_at).length;
  const leakJobs = jobs.filter((j) => j.status === "discrepancy").length;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Maintenance Schedule
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            All scheduled jobs and field service appointments
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Total Jobs</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {totalJobs}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Scheduled</p>
            <p className="text-lg font-semibold text-blue-600">
              {scheduledJobs}
            </p>
          </div>
          {leakJobs > 0 && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Leaks</p>
              <p className="text-lg font-semibold text-red-500">{leakJobs}</p>
            </div>
          )}
        </div>
      </div>

      {/* Calendar */}
      <MaintenanceCalendar jobs={jobs} />
    </div>
  );
}
