"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const MOCK_ZONES = [
  { id: "z1", name: "Front Lawn",    status: "active",   last_run: "2026-03-25 06:00", next_run: "2026-03-26 06:00", runtime_min: 20 },
  { id: "z2", name: "Back Lawn",     status: "idle",     last_run: "2026-03-24 06:00", next_run: "2026-03-27 06:00", runtime_min: 25 },
  { id: "z3", name: "Flower Beds",   status: "idle",     last_run: "2026-03-24 06:15", next_run: "2026-03-26 06:15", runtime_min: 10 },
  { id: "z4", name: "Drip Line A",   status: "fault",    last_run: "2026-03-20 06:00", next_run: "—",                runtime_min: 15 },
  { id: "z5", name: "Drip Line B",   status: "idle",     last_run: "2026-03-25 06:30", next_run: "2026-03-26 06:30", runtime_min: 15 },
  { id: "z6", name: "Side Yard",     status: "disabled", last_run: "2026-03-01 06:00", next_run: "—",                runtime_min: 12 },
];

type Zone = (typeof MOCK_ZONES)[0];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active:   { bg: "bg-blue-500",   text: "text-white",      label: "Active"   },
  idle:     { bg: "bg-green-100",  text: "text-green-700",  label: "Idle"     },
  fault:    { bg: "bg-red-500",    text: "text-white",      label: "Fault"    },
  disabled: { bg: "bg-gray-200",   text: "text-gray-500",   label: "Disabled" },
};

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function IrrigationWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [zones, setZones] = useState<Zone[]>(MOCK_ZONES);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    async function fetchData() {
      const { data, error } = await supabase
        .from("irrigation_readings")
        .select("id, zone_id, flow_gpm, runtime_min, soil_moisture_pct, read_at")
        .eq("tenant_id", tenantId)
        .order("read_at", { ascending: false })
        .limit(30);

      if (error || !data || data.length === 0) return;

      const zoneMap = new Map<string, typeof data[0]>();
      for (const row of data) {
        if (!zoneMap.has(row.zone_id)) zoneMap.set(row.zone_id, row);
      }

      const fetchedZones: Zone[] = Array.from(zoneMap.values()).map(row => ({
        id: row.id,
        name: row.zone_id ?? "Zone",
        status: (row.flow_gpm ?? 0) > 0 ? "active" : (row.soil_moisture_pct ?? 0) > 90 ? "fault" : "idle",
        last_run: row.read_at ?? "—",
        next_run: "—",
        runtime_min: row.runtime_min ?? 0,
      }));

      setZones(fetchedZones);
    }

    fetchData();
  }, [tenantId]);

  const activeCount  = zones.filter((z) => z.status === "active").length;
  const faultCount   = zones.filter((z) => z.status === "fault").length;

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Irrigation Zones</span>
        <div className="flex gap-1.5 text-xs">
          {activeCount > 0 && (
            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
              {activeCount} running
            </span>
          )}
          {faultCount > 0 && (
            <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
              {faultCount} fault
            </span>
          )}
        </div>
      </div>

      {/* Zone grid */}
      <div className="grid grid-cols-2 gap-2 flex-1">
        {zones.map((zone) => {
          const style = STATUS_STYLES[zone.status] ?? STATUS_STYLES["idle"]!;
          return (
            <div
              key={zone.id}
              className="rounded-lg border border-gray-100 p-3 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-800 truncate flex-1">{zone.name}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ml-1 ${style.bg} ${style.text}`}>
                  {style.label}
                </span>
              </div>
              <div className="text-[10px] text-gray-500">
                <span>{zone.runtime_min} min run</span>
              </div>
              {zone.next_run !== "—" && (
                <div className="text-[10px] text-gray-400">Next: {zone.next_run.split(" ")[1]}</div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-400 mt-2">{zones.length} total zones · scheduled irrigation</p>
    </div>
  );
}
