import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = user.app_metadata?.user_role ?? user.user_metadata?.user_role;
  if (role !== 'owner') return NextResponse.json({ error: 'Only owners can invite members' }, { status: 403 });

  const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;
  const { email, role: inviteRole } = await req.json();

  if (!email || !['owner', 'auditor', 'tech'].includes(inviteRole)) {
    return NextResponse.json({ error: 'Invalid email or role' }, { status: 400 });
  }

  // Use Supabase admin client to invite user
  // Note: inviteUserByEmail requires service role key — use SUPABASE_SERVICE_ROLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email,
      data: { user_role: inviteRole, tenant_id: tenantId },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ error: body.message ?? 'Failed to send invite' }, { status: res.status });
  }

  return NextResponse.json({ success: true });
}
