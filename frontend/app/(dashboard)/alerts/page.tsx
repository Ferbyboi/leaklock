export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { AlertsList } from './AlertsList';

export default async function AlertsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id ?? '';

  // Count unacknowledged for the header
  const { count } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("acknowledged_at", null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Alerts</h1>
          <p className="text-sm text-gray-400 mt-0.5">Revenue leak notifications and compliance warnings.</p>
        </div>
        {(count ?? 0) > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">{count} unread</span>
          </div>
        )}
      </div>
      <AlertsList />
    </div>
  );
}
