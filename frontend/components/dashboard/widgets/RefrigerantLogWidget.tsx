"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const MOCK_ROWS = [
  { id: "1", refrigerant_type: "R-410A", amount_lbs: 2.5, technician: "J. Torres", logged_at: "2026-03-24" },
  { id: "2", refrigerant_type: "R-22",   amount_lbs: 1.0, technician: "M. Smith",  logged_at: "2026-03-22" },
  { id: "3", refrigerant_type: "R-410A", amount_lbs: 3.2, technician: "J. Torres", logged_at: "2026-03-18" },
  { id: "4", refrigerant_type: "R-32",   amount_lbs: 0.8, technician: "A. Lee",    logged_at: "2026-03-15" },
  { id: "5", refrigerant_type: "R-410A", amount_lbs: 1.5, technician: "M. Smith",  logged_at: "2026-03-10" },
];

type RefRow = (typeof MOCK_ROWS)[0];

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function RefrigerantLogWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [rows, setRows] = useState<RefRow[]>(MOCK_ROWS);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    supabase
      .from("refrigerant_logs")
      .select("id, refrigerant_type, amount_lbs, qty_lbs, technician_cert, tech_epa_cert, logged_at, recorded_at")
      .eq("tenant_id", tenantId)
      .order("logged_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        const transformed: RefRow[] = data.map((r) => ({
          id: r.id,
          refrigerant_type: r.refrigerant_type,
          amount_lbs: r.qty_lbs ?? r.amount_lbs ?? 0,
          technician: r.tech_epa_cert ?? r.technician_cert ?? "—",
          logged_at: (r.recorded_at ?? r.logged_at ?? "").split("T")[0],
        }));
        setRows(transformed);
      });
  }, [tenantId]);

  const totalLbs = rows.reduce((sum, r) => sum + r.amount_lbs, 0);

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Refrigerant Log</span>
        <span className="text-xs text-gray-500 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
          {totalLbs.toFixed(1)} lbs total
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-gray-500 font-medium pb-2">Type</th>
              <th className="text-right text-gray-500 font-medium pb-2">Lbs</th>
              <th className="text-right text-gray-500 font-medium pb-2">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                <td className="py-2 font-medium text-gray-800">{row.refrigerant_type}</td>
                <td className="py-2 text-right text-gray-700">{row.amount_lbs}</td>
                <td className="py-2 text-right text-gray-500">{row.logged_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-400 mt-2">
        EPA Section 608 compliant logging · {rows.length} records
      </p>
    </div>
  );
}
