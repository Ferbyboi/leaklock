"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type LeakCalc = {
  id: string;
  leak_rate_pct: number;
  threshold_pct: number;
  compliance_status: "pass" | "warning" | "fail";
  calculated_at: string;
};

const STATUS_COLOR = {
  pass:    { bar: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50"  },
  warning: { bar: "bg-yellow-400", text: "text-yellow-700", bg: "bg-yellow-50" },
  fail:    { bar: "bg-red-500",    text: "text-red-700",    bg: "bg-red-50"    },
};

export function LeakRateWidget({ locationId }: { locationId?: string }) {
  const [latest, setLatest]   = useState<LeakCalc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();

    async function fetch() {
      const { data } = await sb
        .from("leak_rate_calcs")
        .select("id, leak_rate_pct, threshold_pct, compliance_status, calculated_at")
        .order("calculated_at", { ascending: false })
        .limit(1)
        .single();
      setLatest(data ?? null);
      setLoading(false);
    }

    fetch();
  }, [locationId]);

  const s = latest ? STATUS_COLOR[latest.compliance_status] : STATUS_COLOR.pass;
  const fillPct = latest ? Math.min(100, (latest.leak_rate_pct / Math.max(latest.threshold_pct, 1)) * 100) : 0;

  return (
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col">
      <span className="text-sm font-semibold text-gray-900 mb-3">EPA Leak Rate</span>

      {loading ? (
        <div className="h-20 bg-gray-100 rounded animate-pulse" />
      ) : !latest ? (
        <p className="text-xs text-gray-500 text-center py-6">No leak rate data yet</p>
      ) : (
        <div className="space-y-3 flex-1">
          <div className="flex items-end justify-between">
            <div>
              <span className={`text-3xl font-bold ${s.text}`}>{latest.leak_rate_pct.toFixed(1)}%</span>
              <span className="text-xs text-gray-500 ml-1">leak rate</span>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
              {latest.compliance_status.toUpperCase()}
            </span>
          </div>

          {/* Progress bar */}
          <div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${s.bar}`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Threshold: {latest.threshold_pct}% · {fillPct.toFixed(0)}% of limit
            </p>
          </div>

          <p className="text-[10px] text-gray-500">
            Last calculated {new Date(latest.calculated_at).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}
