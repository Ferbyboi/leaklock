"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface DayData {
  label: string;   // "Mon", "Tue", …
  leak: number;    // dollars (float)
  recovered: number;
}

interface Props {
  data: DayData[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload[0]?.value > 0 && (
        <p className="text-red-600">Leak: <span className="font-bold">${payload[0].value.toFixed(2)}</span></p>
      )}
      {payload[1]?.value > 0 && (
        <p className="text-green-600">Recovered: <span className="font-bold">${payload[1].value.toFixed(2)}</span></p>
      )}
    </div>
  );
}

export function RevenueTrendChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={14} barGap={2}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f3f4f6" }} />
        <Bar dataKey="leak" fill="#fca5a5" radius={[3, 3, 0, 0]} name="Leak" />
        <Bar dataKey="recovered" fill="#86efac" radius={[3, 3, 0, 0]} name="Recovered" />
      </BarChart>
    </ResponsiveContainer>
  );
}
