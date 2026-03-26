"use client";

import { useState, useEffect } from "react";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import { createClient } from "@/lib/supabase";

const MOCK_SCORE = 82;
const MOCK_LAST_CLEANED = "2026-03-20";
const MOCK_NEXT_DUE = "2026-04-20";

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Compliant";
  if (score >= 60) return "Needs Attention";
  return "Non-Compliant";
}

export function HoodScoreWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [score, setScore] = useState<number>(MOCK_SCORE);
  const [lastCleaned, setLastCleaned] = useState(MOCK_LAST_CLEANED);
  const [nextDue, setNextDue] = useState(MOCK_NEXT_DUE);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    async function fetchData() {
      const { data, error } = await supabase
        .from("hood_inspections")
        .select("id, cleanliness_score, inspected_at")
        .eq("tenant_id", tenantId)
        .order("inspected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return;

      setScore(Math.round((data.cleanliness_score ?? 8) * 10));
      setLastCleaned(data.inspected_at?.split("T")[0] ?? MOCK_LAST_CLEANED);

      if (data.inspected_at) {
        const next = new Date(data.inspected_at);
        next.setDate(next.getDate() + 30);
        const yyyy = next.getFullYear();
        const mm = String(next.getMonth() + 1).padStart(2, "0");
        const dd = String(next.getDate()).padStart(2, "0");
        setNextDue(`${yyyy}-${mm}-${dd}`);
      }
    }

    fetchData();
  }, [tenantId]);

  const color = scoreColor(score);
  const label = scoreLabel(score);

  const chartData = [{ name: "score", value: score, fill: color }];

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-900">Hood Cleaning Score</span>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {label}
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="relative w-32 h-32">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="65%"
              outerRadius="100%"
              data={chartData}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar
                dataKey="value"
                angleAxisId={0}
                background={{ fill: "#f3f4f6" }}
                cornerRadius={8}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold" style={{ color }}>{score}</span>
            <span className="text-[10px] text-gray-500">/ 100</span>
          </div>
        </div>

        <div className="mt-3 w-full space-y-1 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>Last cleaned</span>
            <span className="font-medium text-gray-800">{lastCleaned}</span>
          </div>
          <div className="flex justify-between">
            <span>Next due</span>
            <span className="font-medium text-gray-800">{nextDue}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
