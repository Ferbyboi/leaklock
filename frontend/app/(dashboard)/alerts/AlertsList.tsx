"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";

interface Alert {
  id: string;
  job_id: string;
  alert_type: string;
  severity: string;
  message: string;
  estimated_leak_cents: number;
  acknowledged_at: string | null;
  created_at: string;
  jobs?: { crm_job_id: string; customer_name: string } | null;
}

const SEVERITY_CONFIG = {
  critical: { bg: "bg-red-50 dark:bg-red-950", border: "border-red-200 dark:border-red-800", dot: "bg-red-500", text: "text-red-700 dark:text-red-300", badge: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300" },
  warning:  { bg: "bg-yellow-50 dark:bg-yellow-950", border: "border-yellow-200 dark:border-yellow-800", dot: "bg-yellow-400", text: "text-yellow-700 dark:text-yellow-300", badge: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300" },
  info:     { bg: "bg-blue-50 dark:bg-blue-950", border: "border-blue-200 dark:border-blue-800", dot: "bg-blue-400", text: "text-blue-700 dark:text-blue-300", badge: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300" },
};

type Filter = "all" | "unacknowledged" | "critical" | "warning";

export function AlertsList() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("unacknowledged");
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const sb = useMemo(() => createClient(), []);

  const loadAlerts = useCallback(async () => {
    let q = sb
      .from("alerts")
      .select("*, jobs(crm_job_id, customer_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter === "unacknowledged") q = q.is("acknowledged_at", null);
    if (filter === "critical")       q = q.eq("severity", "critical");
    if (filter === "warning")        q = q.eq("severity", "warning");

    const { data } = await q;
    setAlerts((data as Alert[]) ?? []);
    setLoading(false);
  }, [sb, filter]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  async function acknowledge(alertId: string) {
    setAcknowledging(alertId);
    try {
      await fetch(`/api/alerts/${alertId}/acknowledge`, { method: "PATCH" });
      setAlerts(prev => prev.map(a =>
        a.id === alertId ? { ...a, acknowledged_at: new Date().toISOString() } : a
      ));
    } finally {
      setAcknowledging(null);
    }
  }

  async function acknowledgeAll() {
    const unacked = alerts.filter(a => !a.acknowledged_at);
    if (unacked.length === 0) return;
    try {
      const res = await fetch("/api/alerts/bulk-acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unacked.map(a => a.id) }),
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setAlerts(prev => prev.map(a =>
          !a.acknowledged_at ? { ...a, acknowledged_at: now } : a
        ));
      }
    } catch {
      // fallback: acknowledge one by one
      for (const a of unacked) await acknowledge(a.id);
    }
  }

  const unackedCount = alerts.filter(a => !a.acknowledged_at).length;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "unacknowledged", label: `Unread (${unackedCount})` },
    { key: "all",            label: "All" },
    { key: "critical",       label: "Critical" },
    { key: "warning",        label: "Warning" },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar + bulk action */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === f.key
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {unackedCount > 0 && (
          <button
            onClick={acknowledgeAll}
            className="text-xs text-blue-600 hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />)}
        </div>
      ) : alerts.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No alerts</p>
          <p className="text-xs text-gray-400 mt-1">
            {filter === "unacknowledged" ? "You're all caught up." : "No alerts match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => {
            const sev = SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.info;
            const isAcked = !!alert.acknowledged_at;
            return (
              <div
                key={alert.id}
                className={`rounded-xl border p-4 transition-opacity ${sev.bg} ${sev.border} ${isAcked ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${sev.dot} ${!isAcked ? "animate-pulse" : ""}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.badge}`}>
                          {alert.severity.toUpperCase()}
                        </span>
                        {alert.jobs && (
                          <Link
                            href={`/jobs/${alert.job_id}`}
                            className="text-xs font-mono text-blue-600 hover:underline"
                          >
                            {alert.jobs.crm_job_id}
                          </Link>
                        )}
                        {alert.estimated_leak_cents > 0 && (
                          <span className="text-xs font-semibold text-red-600">
                            ${(alert.estimated_leak_cents / 100).toFixed(2)} at risk
                          </span>
                        )}
                      </div>
                      <p className={`text-sm font-medium ${sev.text}`}>{alert.message}</p>
                      {alert.jobs?.customer_name && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{alert.jobs.customer_name}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(alert.created_at).toLocaleString()}
                        {isAcked && " · Read"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.job_id && (
                      <Link
                        href={`/jobs/${alert.job_id}`}
                        className="px-2.5 py-1 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 transition-colors text-gray-600 dark:text-gray-400"
                      >
                        Review
                      </Link>
                    )}
                    {!isAcked && (
                      <button
                        onClick={() => acknowledge(alert.id)}
                        disabled={acknowledging === alert.id}
                        className="px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                      >
                        {acknowledging === alert.id ? "…" : "✓"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
