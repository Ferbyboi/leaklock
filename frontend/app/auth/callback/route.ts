import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Supabase auth callback — handles email confirmation links.
 * After confirming email, users without a tenant are sent to /onboarding
 * to complete company setup. Existing users go straight to /jobs.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/jobs';

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const appMeta = data.session.user?.app_metadata ?? {};
      const hasTenant = Boolean(appMeta.tenant_id);

      // New user — needs to complete company setup
      if (!hasTenant) {
        return NextResponse.redirect(`${origin}/onboarding`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — send to login with message
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
