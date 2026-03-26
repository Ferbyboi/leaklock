"use client";

import { useState, useEffect } from "react";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import { createClient } from "@/lib/supabase";

const MOCK_SCORE = 91;
const MOCK_CHECKS = [
  { label: "PPE Compliance",       passed: true  },
  { label: "Fall Protection",       passed: true  },
  { label: "Equipment Inspection",  passed: true  },
  { label: "Hazard Communication",  passed: false },
  { label: "First Aid Kit Present", passed: true  },
];

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

function scoreColor(score: number): string {
  if (score >= 85) return "#22c55e";
  if (score >= 70) return "#f59e0b";
  return "#ef4444";
}

export function SafetyScoreGauge({ jobId: _jobId, tenantId, className }: Props) {
  const [score, setScore] = useState<number>(MOCK_SCORE);
  const [checks, setChecks] = useState(MOCK_CHECKS);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    supabase
      .from("safety_checklists")
      .select("id, ppe_items, compliance_status, completed_at")
      .eq("tenant_id", tenantId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return;
        const ppeItems = data.ppe_items;
        if (!ppeItems || typeof ppeItems !== "object") return;
        const derived = Object.entries(ppeItems).map(([label, passed]) => ({
          label,
          passed: Boolean(passed),
        }));
        if (derived.length === 0) return;
        const passedCount = derived.filter((c) => c.passed).length;
        const totalChecks = derived.length;
        const computedScore = Math.round((passedCount / totalChecks) * 100);
        setScore(computedScore);
        setChecks(derived);
      });
  }, [tenantId]);

  const color = scoreColor(score);
  const failed = checks.filter((c) => !c.passed);

  const chartData = [{ name: "score", value: score, fill: color }];

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-900">Safety Score</span>
        {failed.length > 0 && (
          <span className="text-xs font-medium bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
            {failed.length} issue{failed.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex gap-4 flex-1">
        {/* Gauge */}
        <div className="relative w-24 h-24 flex-shrink-0">
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
                cornerRadius={6}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          </div>
        </div>

        {/* Checklist */}
        <ul className="flex-1 space-y-1 text-xs">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-1.5">
              <span className={c.passed ? "text-green-500" : "text-red-500"}>
                {c.passed ? "✓" : "✗"}
              </span>
              <span className={c.passed ? "text-gray-700" : "text-red-600 font-medium"}>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
