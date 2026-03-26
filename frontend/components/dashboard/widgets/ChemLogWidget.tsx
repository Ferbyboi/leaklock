"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

type ChemApp = {
  id: string;
  chemical_name: string;
  compliance_status: "pass" | "warning" | "fail" | "pending";
  applied_at: string;
};

const STATUS_DOT: Record<string, string> = {
  pass:    "bg-green-500",
  warning: "bg-yellow-400",
  fail:    "bg-red-500",
  pending: "bg-gray-300",
};

export function ChemLogWidget({ locationId }: { locationId?: string }) {
  const [apps, setApps]       = useState<ChemApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();

    async function fetch() {
      let q = sb
        .from("chemical_applications")
        .select("id, chemical_name, compliance_status, applied_at")
        .order("applied_at", { ascending: false })
        .limit(8);
      if (locationId) q = q.eq("location_id", locationId);
      const { data } = await q;
      setApps(data ?? []);
      setLoading(false);
    }

    fetch();

    const ch = sb
      .channel("chem-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chemical_applications" }, fetch)
      .subscribe();

    return () => { sb.removeChannel(ch); };
  }, [locationId]);

  const failCount = apps.filter((a) => a.compliance_status === "fail").length;

  return (
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Chemical Log</span>
        {failCount > 0 && (
          <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium">
            {failCount} violation{failCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-7 bg-gray-100 rounded animate-pulse" />)}
        </div>
      ) : apps.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No chemical applications logged</p>
      ) : (
        <ul className="space-y-1.5 flex-1 overflow-y-auto">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[a.compliance_status] ?? "bg-gray-300"}`} />
              <span className="text-gray-700 truncate flex-1">{a.chemical_name}</span>
              <span className="text-gray-500 shrink-0">
                {new Date(a.applied_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
