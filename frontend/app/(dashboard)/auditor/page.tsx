import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

interface ReconciliationResult {
  id: string;
  job_id: string;
  estimated_leak_cents: number;
  missing_items: { item: string; qty: number; estimated_leak_cents: number }[];
  run_at: string;
  jobs: { crm_job_id: string; status: string; created_at: string } | null;
}

export default async function AuditorDashboard() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(`${apiUrl}/reconciliation/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const { results = [], unreviewed_count = 0, total_unreviewed_leak_cents = 0 } =
    res.ok ? await res.json() : {};

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Auditor Dashboard</h1>
        <span className="text-sm text-gray-400">{unreviewed_count} unreviewed</span>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1">Unreviewed Leaks</p>
          <p className="text-3xl font-bold text-red-600">{unreviewed_count}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 mb-1">Total Potential Loss</p>
          <p className="text-3xl font-bold text-red-600">
            ${(total_unreviewed_leak_cents / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Results table */}
      {results.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
          No unreviewed discrepancies. All caught!
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-left text-xs">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Missing Items</th>
                <th className="px-4 py-3 font-medium text-right">Leak</th>
                <th className="px-4 py-3 font-medium">Detected</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {results.map((r: ReconciliationResult) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-gray-700">
                    {r.jobs?.crm_job_id ?? r.job_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.missing_items?.slice(0, 2).map((m, i) => (
                      <span key={i} className="block text-xs">
                        {m.item}
                        {i === 1 && r.missing_items.length > 2 && (
                          <span className="text-gray-400"> +{r.missing_items.length - 2} more</span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">
                    ${(r.estimated_leak_cents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(r.run_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/jobs/${r.job_id}`}
                      className="px-3 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
