'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function JobRealtimeRefresh({ jobId }: { jobId: string }) {
  const router = useRouter();

  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel(`job-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        () => router.refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reconciliation_results', filter: `job_id=eq.${jobId}` },
        () => router.refresh()
      )
      .subscribe();

    return () => { sb.removeChannel(channel); };
  }, [jobId, router]);

  return null;
}
