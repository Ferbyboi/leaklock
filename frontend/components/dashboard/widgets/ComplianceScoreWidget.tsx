"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyCheck {
  id: string;
  label: string;
  frequency: string;
}

interface HealthCheckRow {
  checks_completed: Record<string, boolean> | null;
  score: number | null;
}

interface Props {
  locationId?: string;
  tenantId?:   string;
  className?:  string;
}

// ── Color helper ──────────────────────────────────────────────────────────────

function gaugeColor(score: number): string {
  if (score >= 80) return "#16a34a"; // green-600
  if (score >= 50) return "#d97706"; // amber-600
  return "#dc2626";                  // red-600
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComplianceScoreWidget({ locationId, tenantId, className }: Props) {
  const [score,          setScore]          = useState<number | null>(null);
  const [checksTotal,    setChecksTotal]    = useState<number>(0);
  const [checksComplete, setChecksComplete] = useState<number>(0);
  const [loading,        setLoading]        = useState(true);

  const fetchData = useCallback(async () => {
    const sb = createClient();
    const today = new Date().toISOString().slice(0, 10);

    // 1. Fetch today's health check row ──────────────────────────────────────
    let hcQuery = sb
      .from("daily_health_checks")
      .select("checks_completed, score")
      .eq("date", today)
      .order("created_at", { ascending: false })
      .limit(1);

    if (tenantId)   hcQuery = hcQuery.eq("tenant_id", tenantId);
    if (locationId) hcQuery = hcQuery.eq("location_id", locationId);

    const { data: hcRows } = await hcQuery;
    const hcRow = (hcRows?.[0] ?? null) as HealthCheckRow | null;

    // 2. Fetch required_daily_checks from niche schema ──────────────────────
    let required: DailyCheck[] = [];
    if (tenantId) {
      const params = new URLSearchParams({ tenant_id: tenantId });
      try {
        const res = await fetch(`/api/niche-schema?${params}`);
        if (res.ok) {
          const json = await res.json();
          required = (json.required_daily_checks as DailyCheck[]) ?? [];
        }
      } catch {
        // Silently degrade — score will fall back to the stored score column
      }
    }

    // 3. Compute score ────────────────────────────────────────────────────────
    const completedMap = hcRow?.checks_completed ?? {};
    let total     = required.length;
    let completed = 0;

    if (total > 0) {
      completed = required.filter((c) => completedMap[c.id] === true).length;
      setScore(Math.round((completed / total) * 100));
    } else if (hcRow?.score != null) {
      // Fall back to stored score when no schema is available
      setScore(hcRow.score);
      // Approximate total/completed from the checks_completed map
      const keys = Object.keys(completedMap);
      total     = keys.length;
      completed = keys.filter((k) => completedMap[k]).length;
    } else {
      setScore(null);
    }

    setChecksTotal(total);
    setChecksComplete(completed);
    setLoading(false);
  }, [tenantId, locationId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Realtime subscription — re-fetch on any change to today's record
  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel("compliance-score-widget")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_health_checks" },
        fetchData,
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchData]);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`rounded-xl border bg-card p-4 flex items-center justify-center h-40 ${className ?? ""}`}>
        <div className="h-4 w-20 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  const color = score != null ? gaugeColor(score) : "#9ca3af";
  const gaugeData = [{ value: score ?? 0, fill: color }];

  // ── No data ────────────────────────────────────────────────────────────────
  if (score === null) {
    return (
      <div className={`rounded-xl border bg-card p-4 flex flex-col gap-3 ${className ?? ""}`}>
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Compliance Score</h3>
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-sm text-gray-500">0 checks logged today</p>
          <Link
            href="/field"
            className="text-xs text-blue-600 hover:underline font-medium"
          >
            Start Checklist
          </Link>
        </div>
      </div>
    );
  }

  // ── Score gauge ────────────────────────────────────────────────────────────
  return (
    <div className={`rounded-xl border bg-card p-4 flex flex-col gap-2 ${className ?? ""}`}>
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Compliance Score</h3>

      {/* Gauge */}
      <div className="relative flex items-center justify-center" style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height={160}>
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            data={gaugeData}
            startAngle={225}
            endAngle={-45}
          >
            <RadialBar
              background={{ fill: "#e5e7eb" }}
              dataKey="value"
              cornerRadius={6}
              max={100}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-bold" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-gray-400">/ 100</span>
        </div>
      </div>

      {/* Breakdown */}
      {checksTotal > 0 && (
        <p className="text-xs text-center text-gray-500 dark:text-gray-400">
          {checksComplete} of {checksTotal} checks complete
        </p>
      )}

      {/* CTA if nothing done */}
      {score === 0 && (
        <Link
          href="/field"
          className="text-xs text-blue-600 hover:underline text-center font-medium"
        >
          Start Checklist
        </Link>
      )}
    </div>
  );
}
