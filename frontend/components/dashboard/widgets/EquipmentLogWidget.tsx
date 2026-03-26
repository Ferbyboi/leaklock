"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const MOCK_EQUIPMENT = [
  { id: "e1", name: "Chainsaw CS-450",   last_service: "2026-02-15", next_due: "2026-05-15", status: "ok"      },
  { id: "e2", name: "Wood Chipper WC-7", last_service: "2026-01-20", next_due: "2026-04-20", status: "due_soon" },
  { id: "e3", name: "Bucket Truck BT-2", last_service: "2025-11-10", next_due: "2026-02-10", status: "overdue"  },
  { id: "e4", name: "Stump Grinder SG", last_service: "2026-03-01", next_due: "2026-06-01", status: "ok"       },
  { id: "e5", name: "Pole Saw PS-20",    last_service: "2026-03-10", next_due: "2026-06-10", status: "ok"       },
];

type EquipRow = (typeof MOCK_EQUIPMENT)[0];

const STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  ok:       { badge: "bg-green-50 text-green-700",  dot: "bg-green-500"  },
  due_soon: { badge: "bg-yellow-50 text-yellow-700", dot: "bg-yellow-400" },
  overdue:  { badge: "bg-red-50 text-red-700",       dot: "bg-red-500"    },
};

const TODAY = new Date("2026-03-25");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function deriveStatus(next_due: string): string {
  if (!next_due || next_due === "—") return "ok";
  const due = new Date(next_due);
  if (due < TODAY) return "overdue";
  if (due.getTime() - TODAY.getTime() <= THIRTY_DAYS_MS) return "due_soon";
  return "ok";
}

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function EquipmentLogWidget({ jobId, tenantId, className }: Props) {
  const [equipment, setEquipment] = useState<EquipRow[]>(MOCK_EQUIPMENT);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    supabase
      .from("assets")
      .select("id, name, asset_type, install_date, metadata")
      .eq("tenant_id", tenantId)
      .order("name")
      .limit(20)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        const transformed: EquipRow[] = data.map((r) => {
          const last_service = r.metadata?.last_service ?? r.install_date ?? "—";
          const next_due = r.metadata?.next_due ?? "—";
          const status = r.metadata?.status ?? deriveStatus(next_due);
          return {
            id: r.id,
            name: r.name,
            last_service,
            next_due,
            status,
          };
        });
        setEquipment(transformed);
      });
  }, [tenantId]);

  const overdueCount = equipment.filter((e) => e.status === "overdue").length;
  const dueSoonCount = equipment.filter((e) => e.status === "due_soon").length;

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Equipment Maintenance</span>
        <div className="flex gap-1.5">
          {overdueCount > 0 && (
            <span className="text-xs font-medium bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
              {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="text-xs font-medium bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
              {dueSoonCount} due soon
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {equipment.map((eq) => {
          const styles = STATUS_STYLES[eq.status] ?? STATUS_STYLES.ok;
          return (
            <div
              key={eq.id}
              className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
                <span className="font-medium text-gray-800 truncate">{eq.name}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                <span className="text-gray-500 hidden sm:inline">Due: {eq.next_due}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${styles.badge}`}>
                  {eq.status.replace("_", " ")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
