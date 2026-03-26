"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type Inspection = {
  id: string;
  fill_pct: number;
  next_service: string | null;
  inspected_at: string;
};

export function GreaseTrapWidget({ locationId }: { locationId?: string }) {
  const [latest, setLatest]   = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();

    async function fetch() {
      let q = sb
        .from("grease_trap_inspections")
        .select("id, fill_pct, next_service, inspected_at")
        .order("inspected_at", { ascending: false })
        .limit(1);
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q;
      setLatest(data?.[0] ?? null);
      setLoading(false);
    }

    fetch();
  }, [locationId]);

  const fill = latest?.fill_pct ?? 0;
  const color = fill >= 80 ? "text-red-600" : fill >= 60 ? "text-yellow-600" : "text-green-600";
  const barColor = fill >= 80 ? "bg-red-500" : fill >= 60 ? "bg-yellow-400" : "bg-green-500";

  const daysUntilService = latest?.next_service
    ? Math.ceil((new Date(latest.next_service).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col">
      <span className="text-sm font-semibold text-gray-900 mb-3">Grease Trap</span>

      {loading ? (
        <div className="h-20 bg-gray-100 rounded animate-pulse" />
      ) : !latest ? (
        <p className="text-xs text-gray-500 text-center py-6">No inspections recorded</p>
      ) : (
        <div className="space-y-3 flex-1">
          <div className="flex items-end justify-between">
            <span className={`text-3xl font-bold ${color}`}>{fill.toFixed(0)}%</span>
            <span className="text-xs text-gray-500">capacity</span>
          </div>

          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(fill, 100)}%` }}
            />
          </div>

          {daysUntilService !== null && (
            <p className={`text-xs font-medium ${daysUntilService <= 7 ? "text-red-600" : "text-gray-600"}`}>
              {daysUntilService <= 0
                ? "Service overdue!"
                : `Next service in ${daysUntilService}d`}
            </p>
          )}

          <p className="text-[10px] text-gray-500">
            Last checked {new Date(latest.inspected_at).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}
