import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ plan: string }> }
) {
  const { plan } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not set");
  const res = await fetch(`${apiUrl}/billing/checkout?plan=${encodeURIComponent(plan)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
