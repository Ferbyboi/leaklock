import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const res = await fetch(`${apiUrl}/billing/portal`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
