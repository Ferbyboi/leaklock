"use client";

import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import { getComplianceColor } from "@/lib/design-tokens";

interface ComplianceGaugeProps {
  score: number;       // 0-100
  size?: number;       // px, default 160
  showLabel?: boolean;
}

export function ComplianceGauge({
  score,
  size = 160,
  showLabel = true,
}: ComplianceGaugeProps) {
  const color = getComplianceColor(score);
  const data = [{ value: score, fill: color }];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={225}
          endAngle={-45}
        >
          <RadialBar
            background={{ fill: "#e5e7eb" }}
            dataKey="value"
            cornerRadius={6}
            max={100}
          />
        </RadialBarChart>
      </ResponsiveContainer>

      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>
            {Math.round(score)}
          </span>
          <span className="text-xs text-gray-500">/ 100</span>
        </div>
      )}
    </div>
  );
}
