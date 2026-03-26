"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

interface TeamMember {
  id: string;
  email: string;
  role: string;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

const ROLES = ["owner", "auditor", "tech"] as const;
type Role = typeof ROLES[number];

const ROLE_COLORS: Record<Role, string> = {
  owner:   "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  auditor: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  tech:    "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

const ROLE_DESC: Record<Role, string> = {
  owner:   "Full access — billing, team, all reports",
  auditor: "Can review leaks and approve jobs",
  tech:    "Field capture and own job view only",
};

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("tech");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const sb = createClient();

  const loadMembers = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;
    if (!tenantId) { setLoading(false); return; }

    const { data } = await sb
      .from("users")
      .select("id, email, role, phone, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    setMembers((data as TeamMember[]) ?? []);
    setLoading(false);
  }, [sb]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);

    // Send invite via Supabase Auth (inviteUserByEmail requires service role — use API route)
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to send invite");
      setInviteSuccess(true);
      setInviteEmail("");
      setTimeout(() => setInviteSuccess(false), 3000);
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: Role) {
    setSavingId(memberId);
    const { error } = await sb
      .from("users")
      .update({ role: newRole })
      .eq("id", memberId);
    if (!error) {
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m));
    }
    setSavingId(null);
  }

  const initials = (email: string) => email[0]?.toUpperCase() ?? "?";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Team</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your team members and their roles.</p>
      </div>

      {/* Invite section */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Invite Team Member</h2>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="tech@company.com"
                required
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as Role)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">{ROLE_DESC[inviteRole]}</p>
          {inviteError && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">{inviteError}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {inviting ? "Sending\u2026" : "Send invite"}
            </button>
            {inviteSuccess && <span className="text-sm text-green-600 font-medium">Invite sent ✓</span>}
          </div>
        </form>
      </section>

      {/* Members list */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Members <span className="text-gray-400 font-normal">({members.length})</span>
        </h2>
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />)}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800">
            {members.map(member => (
              <div key={member.id} className="flex items-center gap-4 px-4 py-3">
                {/* Avatar */}
                <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300 shrink-0">
                  {initials(member.email)}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.email}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Joined {new Date(member.created_at).toLocaleDateString()}
                  </p>
                </div>
                {/* Role selector */}
                <div className="flex items-center gap-2">
                  {savingId === member.id ? (
                    <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  <select
                    value={member.role}
                    onChange={e => handleRoleChange(member.id, e.target.value as Role)}
                    disabled={savingId === member.id}
                    className={`text-xs font-medium px-2 py-1 rounded-full border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer ${ROLE_COLORS[member.role as Role] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No team members yet. Invite your first technician above.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Role reference */}
      <section className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Role Permissions</h3>
        <div className="space-y-2">
          {ROLES.map(r => (
            <div key={r} className="flex items-start gap-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${ROLE_COLORS[r]}`}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400">{ROLE_DESC[r]}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
