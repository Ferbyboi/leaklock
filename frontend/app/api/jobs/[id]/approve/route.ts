import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const res = await fetch(`${apiUrl}/jobs/${id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
