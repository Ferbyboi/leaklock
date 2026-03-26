import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// ── Plan gate definitions ─────────────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'growth' | 'enterprise' | 'cancelled' | null | undefined;

interface PlanGate {
  /** Route prefix that is restricted */
  path: string;
  /** Minimum plan required to access this route */
  requiredPlan: 'pro' | 'enterprise';
  /** Human-readable feature name used in upgrade redirect query param */
  feature: string;
}

const PLAN_GATES: PlanGate[] = [
  // Pro-only routes
  { path: '/field/photo-ai',  requiredPlan: 'pro',        feature: 'photo_ai'    },
  { path: '/reports',         requiredPlan: 'pro',        feature: 'reports'     },
  // Enterprise-only routes
  { path: '/api/webhooks',    requiredPlan: 'enterprise', feature: 'webhooks'    },
  { path: '/settings/api',    requiredPlan: 'enterprise', feature: 'api_access'  },
  { path: '/api/api-keys',    requiredPlan: 'enterprise', feature: 'api_access'  },
];

/** Plan hierarchy — higher index = higher tier */
const PLAN_RANK: Record<string, number> = {
  starter:    1,
  pro:        2,
  growth:     2,   // legacy name treated as equivalent to pro
  enterprise: 3,
};

/**
 * Returns whether `plan` meets or exceeds `required`.
 * Unknown or missing plans (null/undefined/'cancelled') have rank 0.
 */
function checkPlanGate(pathname: string, plan: Plan): { allowed: boolean; feature?: string } {
  for (const gate of PLAN_GATES) {
    if (pathname !== gate.path && !pathname.startsWith(gate.path + '/')) continue;

    const userRank = PLAN_RANK[plan ?? ''] ?? 0;
    const requiredRank = PLAN_RANK[gate.requiredPlan];

    if (userRank < requiredRank) {
      return { allowed: false, feature: gate.feature };
    }
  }
  return { allowed: true };
}

// ── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // ── 1. Auth gate ───────────────────────────────────────────────────────────
  const publicPaths = ['/login', '/signup', '/forgot-password', '/reset-password', '/diagnostic'];
  if (!user && !publicPaths.some(p => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/signup pages
  if (user && publicPaths.some(p => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/jobs';
    return NextResponse.redirect(url);
  }

  // ── 2. Plan gate (only for authenticated users) ───────────────────────────
  if (user) {
    // Fetch the tenant's current plan from Supabase
    // We join via the user's tenant_id stored in app_metadata or user_metadata
    const tenantId =
      (user.app_metadata?.tenant_id as string | undefined) ??
      (user.user_metadata?.tenant_id as string | undefined);

    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('plan')
        .eq('id', tenantId)
        .single();

      const plan = (tenant?.plan ?? null) as Plan;
      const gate = checkPlanGate(pathname, plan);

      if (!gate.allowed) {
        const url = request.nextUrl.clone();
        url.pathname = '/billing';
        url.searchParams.set('upgrade', 'true');
        if (gate.feature) {
          url.searchParams.set('feature', gate.feature);
        }
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
