"use client";

interface Segment {
  label: string;
  count: number;
  color: string;
  textColor: string;
}

interface Props {
  total: number;
  segments: Segment[];
}

export function PipelineBreakdown({ total, segments }: Props) {
  if (total === 0) return (
    <div className="flex items-center justify-center h-16 text-sm text-gray-400">No jobs yet</div>
  );

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex rounded-full overflow-hidden h-3 gap-0.5">
        {segments.filter(s => s.count > 0).map((s) => (
          <div
            key={s.label}
            className={`${s.color} transition-all`}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.color}`} />
            <span>{s.label}</span>
            <span className="font-semibold text-gray-900">{s.count}</span>
            <span className="text-gray-400">({Math.round((s.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
