"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckItem {
  id: string;
  label: string;
  frequency: string; // "daily" | "twice_daily" | "per_job" | etc.
}

interface Props {
  locationId?: string;
  tenantId?:   string;
  className?:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the ISO date string for today (YYYY-MM-DD).
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Determine display status for a check item.
 *
 * Rules:
 *   - done              → green
 *   - twice_daily       → red (overdue) when the last completion was > 6 h ago
 *                         OR was not done today
 *   - everything else   → yellow (due) when not done
 */
type CheckStatus = "done" | "overdue" | "due";

function itemStatus(
  item: CheckItem,
  completedMap: Record<string, boolean>,
  lastCheckedMap: Record<string, string>, // id → ISO timestamp of last completion
): CheckStatus {
  const done = !!completedMap[item.id];
  if (done) return "done";

  if (item.frequency === "twice_daily") {
    const last = lastCheckedMap[item.id];
    if (!last) return "overdue";
    const hoursAgo = (Date.now() - new Date(last).getTime()) / 3_600_000;
    if (hoursAgo > 6) return "overdue";
  }

  return "due";
}

const STATUS_COLORS: Record<CheckStatus, string> = {
  done:    "bg-green-500",
  overdue: "bg-red-500",
  due:     "bg-yellow-400",
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  done:    "text-gray-500 line-through",
  overdue: "text-red-600 dark:text-red-400",
  due:     "text-gray-700 dark:text-gray-300",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DailyChecklistWidget({ locationId, tenantId, className }: Props) {
  const [checks,         setChecks]         = useState<CheckItem[]>([]);
  const [completedMap,   setCompletedMap]   = useState<Record<string, boolean>>({});
  const [lastCheckedMap, setLastCheckedMap] = useState<Record<string, string>>({});
  const [healthCheckId,  setHealthCheckId]  = useState<string | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState<string | null>(null); // id of item being saved

  // Track whether we still need to upsert vs update
  const isNewRow = useRef(false);

  // ── Fetch niche schema ─────────────────────────────────────────────────────
  const fetchChecks = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/niche-schema?tenant_id=${encodeURIComponent(tenantId)}`);
      if (res.ok) {
        const json = await res.json();
        setChecks((json.required_daily_checks as CheckItem[]) ?? []);
      }
    } catch { /* degrade silently */ }
  }, [tenantId]);

  // ── Fetch today's health check row ────────────────────────────────────────
  const fetchRow = useCallback(async () => {
    const sb = createClient();
    let q = sb
      .from("daily_health_checks")
      .select("id, checks_completed, last_checked_map")
      .eq("date", today())
      .order("created_at", { ascending: false })
      .limit(1);

    if (tenantId)   q = q.eq("tenant_id", tenantId);
    if (locationId) q = q.eq("location_id", locationId);

    const { data } = await q;
    const row = data?.[0];
    if (row) {
      setHealthCheckId(row.id);
      setCompletedMap((row.checks_completed as Record<string, boolean>) ?? {});
      setLastCheckedMap((row.last_checked_map as Record<string, string>) ?? {});
      isNewRow.current = false;
    } else {
      setHealthCheckId(null);
      setCompletedMap({});
      setLastCheckedMap({});
      isNewRow.current = true;
    }
    setLoading(false);
  }, [tenantId, locationId]);

  useEffect(() => {
    Promise.all([fetchChecks(), fetchRow()]);
  }, [fetchChecks, fetchRow]);

  // Realtime refresh
  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel("daily-checklist-widget")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_health_checks" },
        fetchRow,
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchRow]);

  // ── Toggle a check ────────────────────────────────────────────────────────
  async function toggleCheck(checkId: string) {
    if (!tenantId) return;
    const sb         = createClient();
    const newVal     = !completedMap[checkId];
    const now        = new Date().toISOString();
    const newCompleted = { ...completedMap, [checkId]: newVal };
    const newLastChecked = newVal
      ? { ...lastCheckedMap, [checkId]: now }
      : { ...lastCheckedMap };

    // Optimistic update
    setCompletedMap(newCompleted);
    setLastCheckedMap(newLastChecked);
    setSaving(checkId);

    // Compute score
    const totalRequired = checks.length;
    const doneCount     = Object.values(newCompleted).filter(Boolean).length;
    const newScore      = totalRequired > 0
      ? Math.round((doneCount / totalRequired) * 100)
      : 0;

    try {
      if (healthCheckId) {
        await sb
          .from("daily_health_checks")
          .update({
            checks_completed: newCompleted,
            last_checked_map: newLastChecked,
            score: newScore,
          })
          .eq("id", healthCheckId);
      } else {
        // First check of the day — upsert a new row
        const { data } = await sb
          .from("daily_health_checks")
          .upsert({
            tenant_id:        tenantId,
            location_id:      locationId ?? null,
            date:             today(),
            checks_completed: newCompleted,
            last_checked_map: newLastChecked,
            score:            newScore,
          })
          .select("id")
          .single();
        if (data) setHealthCheckId(data.id);
        isNewRow.current = false;
      }
    } catch { /* revert on error */ fetchRow(); }
    finally   { setSaving(null); }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const total     = checks.length;
  const completed = checks.filter((c) => completedMap[c.id]).length;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;

  const progressColor =
    pct >= 80 ? "bg-green-500" :
    pct >= 50 ? "bg-yellow-400" :
                "bg-red-500";

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 ${className ?? ""}`}>
        <h3 className="text-sm font-medium text-gray-500">Daily Checklist</h3>
        <div className="h-4 bg-muted animate-pulse rounded-full" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 ${className ?? ""}`}>
        <h3 className="text-sm font-medium text-gray-500">Daily Checklist</h3>
        <p className="text-sm text-gray-500 text-center py-2">No checklist for today yet</p>
        <Link href="/field" className="text-xs text-blue-600 hover:underline text-center font-medium">
          Open Field Capture
        </Link>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 ${className ?? ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Daily Checklist</h3>
        <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${progressColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
        {completed} / {total} checks complete
      </p>

      {/* Check items */}
      <ul className="space-y-1.5 max-h-52 overflow-y-auto">
        {checks.map((item) => {
          const status = itemStatus(item, completedMap, lastCheckedMap);
          const isSaving = saving === item.id;
          return (
            <li key={item.id}>
              <button
                onClick={() => toggleCheck(item.id)}
                disabled={isSaving || !tenantId}
                className="w-full flex items-start gap-2 text-xs text-left group disabled:opacity-60"
              >
                {/* Checkbox indicator */}
                <span
                  className={`
                    mt-0.5 w-4 h-4 rounded shrink-0 flex items-center justify-center
                    border transition-colors
                    ${STATUS_COLORS[status]}
                    ${status === "done" ? "border-transparent" : "border-current bg-opacity-20"}
                  `}
                >
                  {status === "done" && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>

                <span className={`flex-1 ${STATUS_LABEL[status]}`}>
                  {item.label}
                  {status === "overdue" && (
                    <span className="ml-1 text-[10px] font-semibold text-red-500">(overdue)</span>
                  )}
                </span>

                {/* Frequency badge */}
                <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 italic">
                  {item.frequency.replace(/_/g, " ")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
