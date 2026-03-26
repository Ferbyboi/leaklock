"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type TempRow = {
  id: string;
  item: string;
  temp_f: number;
  zone_status: "safe" | "danger";
  logged_at: string;
};

export function TempLogWidget({ locationId }: { locationId?: string }) {
  const [rows, setRows]     = useState<TempRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();

    async function fetch() {
      let q = sb
        .from("temperature_logs")
        .select("id, item, temp_f, zone_status, logged_at")
        .order("logged_at", { ascending: false })
        .limit(6);
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q;
      setRows(data ?? []);
      setLoading(false);
    }

    fetch();

    const ch = sb
      .channel("temp-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "temperature_logs" }, fetch)
      .subscribe();

    return () => { sb.removeChannel(ch); };
  }, [locationId]);

  const dangerCount = rows.filter((r) => r.zone_status === "danger").length;

  return (
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Temperature Log</span>
        {dangerCount > 0 && (
          <span className="text-xs font-medium bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
            {dangerCount} danger zone{dangerCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-gray-200/50 dark:bg-gray-700/30 rounded animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No temperature readings yet</p>
      ) : (
        <ul className="space-y-1.5 flex-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-700 truncate flex-1 mr-2">{r.item}</span>
              <span className={`font-bold ${r.zone_status === "danger" ? "text-red-600" : "text-green-600"}`}>
                {r.temp_f}°F
              </span>
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                r.zone_status === "danger" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
              }`}>
                {r.zone_status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
