"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type SanLog = {
  id: string;
  tool_type: string;
  sanitization_method: string;
  passed: boolean;
  logged_at: string;
};

export function SanitationStreakWidget({ locationId }: { locationId?: string }) {
  const [logs, setLogs]       = useState<SanLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();

    async function fetch() {
      let q = sb
        .from("sanitation_logs")
        .select("id, tool_type, sanitization_method, passed, logged_at")
        .order("logged_at", { ascending: false })
        .limit(20);
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q;
      setLogs(data ?? []);
      setLoading(false);
    }

    fetch();

    const ch = sb
      .channel("sanitation-streak")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sanitation_logs" }, fetch)
      .subscribe();

    return () => { sb.removeChannel(ch); };
  }, [locationId]);

  // Calculate streak (consecutive passed logs from newest)
  const streak = (() => {
    let count = 0;
    for (const log of logs) {
      if (!log.passed) break;
      count++;
    }
    return count;
  })();

  const passRate = logs.length > 0
    ? Math.round((logs.filter((l) => l.passed).length / logs.length) * 100)
    : 0;

  return (
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col">
      <span className="text-sm font-semibold text-gray-900 mb-3">Sanitation Streak</span>

      {loading ? (
        <div className="h-20 bg-gray-200/50 dark:bg-gray-700/30 rounded animate-pulse" />
      ) : logs.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No sanitation logs yet</p>
      ) : (
        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">{streak}</p>
              <p className="text-[10px] text-gray-500">day streak</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-800">{passRate}%</p>
              <p className="text-[10px] text-gray-500">pass rate</p>
            </div>
          </div>

          {/* Mini timeline — last 10 */}
          <div className="flex gap-1">
            {logs.slice(0, 10).reverse().map((log) => (
              <div
                key={log.id}
                title={`${log.tool_type} — ${new Date(log.logged_at).toLocaleDateString()}`}
                className={`flex-1 h-4 rounded-sm ${log.passed ? "bg-green-400" : "bg-red-400"}`}
              />
            ))}
          </div>
          <p className="text-[10px] text-gray-500">Last 10 logs (green = pass)</p>
        </div>
      )}
    </div>
  );
}
