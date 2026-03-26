"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<
    { id: string; title: string; severity: string; created_at: string }[]
  >([]);

  useEffect(() => {
    const sb = createClient();
    let cancelled = false;

    async function fetchUnread() {
      const { data } = await sb
        .from("alerts")
        .select("id, title, severity, created_at")
        .is("acknowledged_at", null)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!cancelled) {
        const rows = data ?? [];
        setAlerts(rows);
        setCount(rows.length);
      }
    }

    fetchUnread();

    const channel = sb
      .channel("notification-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, fetchUnread)
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, []);

  async function dismiss(alertId: string) {
    const sb = createClient();
    await sb
      .from("alerts")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    setCount((c) => Math.max(0, c - 1));
  }

  const SEVERITY_DOT: Record<string, string> = {
    critical: "bg-red-500",
    warning:  "bg-yellow-400",
    info:     "bg-blue-400",
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        aria-label={`${count} unread alerts`}
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-1 z-20 w-80 rounded-xl border bg-white shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-semibold text-gray-900">Alerts</span>
              {count > 0 && (
                <span className="text-xs text-gray-500">{count} unread</span>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                All clear — no active alerts
              </div>
            ) : (
              <ul className="divide-y max-h-80 overflow-y-auto">
                {alerts.map((alert) => (
                  <li key={alert.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        SEVERITY_DOT[alert.severity] ?? "bg-gray-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{alert.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => dismiss(alert.id)}
                      className="shrink-0 text-xs text-gray-500 hover:text-gray-700 mt-0.5"
                      aria-label="Dismiss alert"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
