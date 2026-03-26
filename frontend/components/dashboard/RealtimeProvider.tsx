"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RealtimeAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string | null;
  tenant_id: string;
  location_id: string | null;
  created_at: string;
}

export interface RealtimeFieldEvent {
  id: string;
  tenant_id: string;
  job_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface RealtimeContextValue {
  recentAlerts: RealtimeAlert[];
  recentFieldEvents: RealtimeFieldEvent[];
  alertCount: number;
}

// ── Context ───────────────────────────────────────────────────────────────────

const RealtimeContext = createContext<RealtimeContextValue>({
  recentAlerts: [],
  recentFieldEvents: [],
  alertCount: 0,
});

export function useRealtime() {
  return useContext(RealtimeContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface RealtimeProviderProps {
  children: ReactNode;
  /** Supabase tenant_id — used as the filter for subscriptions */
  tenantId: string;
}

const SEVERITY_TOAST: Record<RealtimeAlert["severity"], (msg: string) => void> = {
  critical: (msg) => toast.error(msg,   { duration: 8000, id: msg }),
  warning:  (msg) => toast.warning(msg, { duration: 5000, id: msg }),
  info:     (msg) => toast.info(msg,    { duration: 4000, id: msg }),
};

export function RealtimeProvider({ children, tenantId }: RealtimeProviderProps) {
  const [recentAlerts, setRecentAlerts]           = useState<RealtimeAlert[]>([]);
  const [recentFieldEvents, setRecentFieldEvents] = useState<RealtimeFieldEvent[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!tenantId) return;

    const sb = createClient();

    // ── Channel 1: alerts ─────────────────────────────────────────────────────
    const alertsChannel = sb
      .channel(`realtime-alerts-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "alerts",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          if (!mountedRef.current) return;
          const alert = payload.new as RealtimeAlert;
          setRecentAlerts((prev) => [alert, ...prev].slice(0, 50));
          const toastFn = SEVERITY_TOAST[alert.severity] ?? SEVERITY_TOAST.info;
          toastFn(alert.title);
        },
      )
      .subscribe();

    // ── Channel 2: field_events ───────────────────────────────────────────────
    const fieldChannel = sb
      .channel(`realtime-field-events-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "field_events",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          if (!mountedRef.current) return;
          const event = payload.new as RealtimeFieldEvent;
          setRecentFieldEvents((prev) => [event, ...prev].slice(0, 50));
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      sb.removeChannel(alertsChannel);
      sb.removeChannel(fieldChannel);
    };
  }, [tenantId]);

  return (
    <RealtimeContext.Provider
      value={{
        recentAlerts,
        recentFieldEvents,
        alertCount: recentAlerts.length,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}
