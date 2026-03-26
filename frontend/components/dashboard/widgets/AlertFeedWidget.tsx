"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useRealtime, type RealtimeAlert } from "@/components/dashboard/RealtimeProvider";
import { formatDistanceToNow } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<Alert["severity"], string> = {
  critical: "bg-red-50    text-red-700    border-red-200    dark:bg-red-950    dark:text-red-400    dark:border-red-800",
  warning:  "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800",
  info:     "bg-blue-50   text-blue-700   border-blue-200   dark:bg-blue-950   dark:text-blue-400   dark:border-blue-800",
};

const SEVERITY_BADGE: Record<Alert["severity"], string> = {
  critical: "bg-red-100    text-red-700    dark:bg-red-900    dark:text-red-300",
  warning:  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  info:     "bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  locationId?: string;
  tenantId?:   string;
  className?:  string;
}

export function AlertFeedWidget({ locationId, tenantId, className }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  // Pull live alerts injected by the RealtimeProvider (best-effort; silently
  // falls back if the provider is not mounted above this widget).
  const { recentAlerts } = useRealtime();

  // ── Initial fetch ──────────────────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    const sb = createClient();
    let query = sb
      .from("alerts")
      .select("id, severity, title, body, created_at, acknowledged_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tenantId)   query = query.eq("tenant_id", tenantId);
    if (locationId) query = query.eq("location_id", locationId);

    const { data } = await query;
    setAlerts((data as Alert[]) ?? []);
    setLoading(false);
  }, [tenantId, locationId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // ── Prepend live alerts from RealtimeProvider ──────────────────────────────
  useEffect(() => {
    if (recentAlerts.length === 0) return;
    const newest = recentAlerts[0] as RealtimeAlert;
    setAlerts((prev) => {
      if (prev.some((a) => a.id === newest.id)) return prev;
      const merged: Alert = {
        id:              newest.id,
        severity:        newest.severity,
        title:           newest.title,
        body:            newest.body,
        created_at:      newest.created_at,
        acknowledged_at: null,
      };
      return [merged, ...prev].slice(0, 10);
    });
  }, [recentAlerts]);

  // ── Acknowledge ────────────────────────────────────────────────────────────
  async function acknowledge(alertId: string) {
    const sb = createClient();
    await fetch(`/api/alerts/${alertId}/acknowledge`, { method: "PATCH" });
    // Optimistic remove
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    // Also fire Supabase update directly in case the API route is not yet live
    await sb
      .from("alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);
  }

  // ── Relative time helper ───────────────────────────────────────────────────
  function relTime(iso: string) {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true });
    } catch {
      return "";
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 h-full ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Alerts</h3>
        {alerts.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
            {alerts.length}
          </span>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-1">
          <span className="text-2xl">&#10003;</span>
          <p className="text-sm text-gray-500 dark:text-gray-400">No active alerts — all clear</p>
        </div>
      )}

      {/* Alert list */}
      {!loading && alerts.length > 0 && (
        <ul className="space-y-2 overflow-y-auto max-h-80">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_STYLES[alert.severity]}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${SEVERITY_BADGE[alert.severity]}`}
                    >
                      {alert.severity}
                    </span>
                    <p className="font-medium text-xs truncate">{alert.title}</p>
                  </div>
                  {alert.body && (
                    <p className="text-xs opacity-70 mt-0.5 line-clamp-2">{alert.body}</p>
                  )}
                  <p className="text-[10px] opacity-50 mt-0.5">{relTime(alert.created_at)}</p>
                </div>
                <button
                  onClick={() => acknowledge(alert.id)}
                  className="shrink-0 text-xs underline opacity-60 hover:opacity-100 transition-opacity"
                >
                  Acknowledge
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
