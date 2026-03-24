import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import JobsTable from '@/components/ui/JobsTable';

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function JobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const url = new URL(`${apiUrl}/jobs`);
  if (params.status) url.searchParams.set('status', params.status);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const { jobs = [] } = res.ok ? await res.json() : {};

  const title = params.status === 'discrepancy'
    ? 'Revenue Leaks'
    : params.status
      ? `Jobs — ${params.status}`
      : 'All Jobs';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <span className="text-sm text-gray-400">{jobs.length} jobs</span>
      </div>
      <JobsTable jobs={jobs} />
    </div>
  );
}
