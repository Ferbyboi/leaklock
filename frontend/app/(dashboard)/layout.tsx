import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import LogoutButton from '@/components/ui/LogoutButton';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">LeakLock</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <Link
            href="/jobs"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Jobs
          </Link>
          <Link
            href="/jobs?status=discrepancy"
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50"
          >
            Revenue Leaks
          </Link>
          <Link
            href="/auditor"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Auditor Review
          </Link>
          <Link
            href="/billing"
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Billing
          </Link>
        </nav>
        <div className="p-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 px-3 mb-2 truncate">{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
