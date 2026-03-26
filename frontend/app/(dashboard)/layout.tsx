export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import ActiveLink from '@/components/ui/ActiveLink';
import LogoutButton from '@/components/ui/LogoutButton';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { DarkModeToggle } from '@/components/ui/DarkModeToggle';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { NicheToggle } from '@/components/dashboard/NicheToggle';
import { RealtimeProvider } from '@/components/dashboard/RealtimeProvider';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { MobileSidebar } from '@/components/ui/MobileSidebar';
import type { NicheType } from '@/lib/design-tokens';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = (user.app_metadata?.user_role ?? user.user_metadata?.user_role ?? 'tech') as string;

  // ── Resolve tenant info for NicheToggle + RealtimeProvider ─────────────────
  // Try JWT custom claims first (fastest), then fall back to a DB lookup.
  let tenantId    = (user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id ?? '') as string;
  let tenantType  = (user.app_metadata?.tenant_type ?? user.user_metadata?.tenant_type ?? 'restaurant') as NicheType;

  if (!tenantId) {
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id, tenants(id, tenant_type)')
      .eq('id', user.id)
      .single();

    if (userData) {
      interface UserWithTenant {
        tenant_id: string;
        tenants: { id: string; tenant_type: string } | null;
      }
      const typed = userData as unknown as UserWithTenant;
      tenantId   = typed.tenants?.id   ?? '';
      tenantType = (typed.tenants?.tenant_type ?? 'restaurant') as NicheType;
    }
  }

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard',    icon: '⬡',  roles: ['owner', 'auditor', 'tech'] },
    { href: '/jobs',     label: 'Jobs',         icon: '⊞',  roles: ['owner', 'auditor', 'tech'] },
    { href: '/auditor',  label: 'Auditor',      icon: '⊘',  roles: ['owner', 'auditor'] },
    { href: '/field',    label: 'Field Capture', icon: '⊕', roles: ['owner', 'auditor', 'tech'] },
    { href: '/tech',     label: 'Tech View',    icon: '⊛',  roles: ['tech'] },
    { href: '/alerts',       label: 'Alerts',       icon: '⊙',  roles: ['owner', 'auditor'] },
    { href: '/reports',      label: 'Reports',      icon: '⊏',  roles: ['owner', 'auditor'] },
    { href: '/team',         label: 'Team',         icon: '⊚',  roles: ['owner'] },
    { href: '/billing',      label: 'Billing',      icon: '⊟',  roles: ['owner'] },
    { href: '/schedule',     label: 'Schedule',     icon: '⊡',  roles: ['owner', 'auditor', 'tech'] },
    { href: '/settings',     label: 'Settings',     icon: '⊜',  roles: ['owner', 'auditor', 'tech'] },
    { href: '/settings/api', label: 'API Access',   icon: '⊐',  roles: ['owner'] },
  ].filter((l) => l.roles.includes(role));

  return (
    <RealtimeProvider tenantId={tenantId}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex">
        {/* Mobile sidebar — visible only on small screens */}
        <MobileSidebar
          navLinks={navLinks}
          userEmail={user.email}
          role={role}
          tenantId={tenantId}
          tenantType={tenantType}
        />

        {/* Desktop Sidebar — hidden on mobile */}
        <aside className="hidden md:flex w-56 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex-col shrink-0">
          {/* Brand */}
          <div className="h-14 px-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-gray-900 dark:text-gray-100 tracking-tight">LeakLock</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-full border border-blue-100 dark:border-blue-900">
                {role}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <GlobalSearch />
              <DarkModeToggle />
              <NotificationBell />
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {navLinks.map((link) => (
              <ActiveLink key={link.href} href={link.href} label={link.label} />
            ))}
          </nav>

          {/* Niche toggle — below nav links, above user footer */}
          {tenantId && (
            <div className="px-0 py-2 border-t border-gray-100 dark:border-gray-800">
              <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600">
                Industry
              </p>
              <NicheToggle tenantId={tenantId} initialNiche={tenantType} />
            </div>
          )}

          {/* User footer */}
          <div className="px-3 py-3 pb-10 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 px-2 mb-2">
              <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-[10px] font-bold text-blue-700 dark:text-blue-300 shrink-0">
                {(user.email ?? '?')[0].toUpperCase()}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">{user.email}</p>
            </div>
            <LogoutButton />
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto px-8 pt-16 pb-8 md:pt-8">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette />
    </RealtimeProvider>
  );
}
