"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { createClient } from "@/lib/supabase";

const MOCK_DATA = [
  { time: "08:00", supply: 245, return: 78 },
  { time: "10:00", supply: 252, return: 82 },
  { time: "12:00", supply: 248, return: 80 },
  { time: "14:00", supply: 255, return: 85 },
  { time: "16:00", supply: 241, return: 76 },
  { time: "18:00", supply: 249, return: 81 },
];

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function PressureWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [data, setData] = useState(MOCK_DATA);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    async function fetchData() {
      const { data: rows, error } = await supabase
        .from("pressure_tests")
        .select("id, test_pressure_psi, passed, tested_at")
        .eq("tenant_id", tenantId)
        .order("tested_at", { ascending: true })
        .limit(12);

      if (error || !rows || rows.length === 0) return;

      const transformed = rows.map((r) => ({
        time: new Date(r.tested_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        supply: Math.round(r.test_pressure_psi ?? 0),
        return: Math.round((r.test_pressure_psi ?? 0) * 0.32),
      }));

      setData(transformed);
    }

    fetchData();
  }, [tenantId]);

  const latestSupply = data[data.length - 1]?.supply ?? 0;
  const latestReturn = data[data.length - 1]?.return ?? 0;

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Pressure Readings</span>
        <div className="flex gap-2 text-xs">
          <span className="text-blue-600 font-medium">S: {latestSupply} psi</span>
          <span className="text-orange-500 font-medium">R: {latestReturn} psi</span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
              labelStyle={{ fontWeight: 600 }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="supply"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="Supply (psi)"
            />
            <Line
              type="monotone"
              dataKey="return"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              name="Return (psi)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-gray-400 mt-1">Today&apos;s readings · Normal range: supply 230–260 psi</p>
    </div>
  );
}
