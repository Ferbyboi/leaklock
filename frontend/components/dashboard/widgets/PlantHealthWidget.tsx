"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const MOCK_PLANTS = [
  { id: "p1", name: "Japanese Maple",      location: "Front yard",    health: "excellent", last_check: "2026-03-24", notes: "Leafing out well" },
  { id: "p2", name: "Rose Bush (East)",    location: "Side bed",      health: "good",      last_check: "2026-03-22", notes: "Minor aphids, treated" },
  { id: "p3", name: "Blue Spruce",         location: "Back corner",   health: "fair",      last_check: "2026-03-20", notes: "Needle drop, watch watering" },
  { id: "p4", name: "Hydrangea Cluster",   location: "Back bed",      health: "poor",      last_check: "2026-03-18", notes: "Overwatered, root rot suspected" },
  { id: "p5", name: "Italian Cypress",     location: "Driveway",      health: "excellent", last_check: "2026-03-25", notes: "Healthy, trimmed last week" },
  { id: "p6", name: "Boxwood Hedge",       location: "Front border",  health: "good",      last_check: "2026-03-23", notes: "Slight browning on tips" },
];

type Plant = (typeof MOCK_PLANTS)[0];

const HEALTH_STYLES: Record<string, { badge: string; dot: string }> = {
  excellent: { badge: "bg-green-50 text-green-700",  dot: "bg-green-500"  },
  good:      { badge: "bg-blue-50 text-blue-700",    dot: "bg-blue-400"   },
  fair:      { badge: "bg-yellow-50 text-yellow-700", dot: "bg-yellow-400" },
  poor:      { badge: "bg-red-50 text-red-700",       dot: "bg-red-500"    },
};

function healthFromScore(score: number): string {
  if (score >= 8) return "excellent";
  if (score >= 6) return "good";
  if (score >= 4) return "fair";
  return "poor";
}

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function PlantHealthWidget({ jobId, tenantId, className }: Props) {
  const [plants, setPlants] = useState<Plant[]>(MOCK_PLANTS);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    supabase
      .from("plant_health_photos")
      .select("id, plant_id, health_score, issues_detected, assessed_at")
      .eq("tenant_id", tenantId)
      .order("assessed_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        const transformed: Plant[] = data.map((r) => ({
          id: r.id,
          name: r.plant_id ?? "Unknown Plant",
          location: "—",
          health: healthFromScore(r.health_score),
          last_check: (r.assessed_at ?? "").split("T")[0],
          notes: (r.issues_detected ?? []).join(", ") || "No issues",
        }));
        setPlants(transformed);
      });
  }, [tenantId]);

  const poorCount = plants.filter((p) => p.health === "poor").length;
  const fairCount = plants.filter((p) => p.health === "fair").length;

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Plant Health</span>
        <div className="flex gap-1.5">
          {poorCount > 0 && (
            <span className="text-xs font-medium bg-red-50 text-red-700 px-2 py-0.5 rounded-full">
              {poorCount} poor
            </span>
          )}
          {fairCount > 0 && (
            <span className="text-xs font-medium bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
              {fairCount} fair
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5">
        {plants.map((plant) => {
          const styles = HEALTH_STYLES[plant.health] ?? HEALTH_STYLES.good;
          return (
            <div
              key={plant.id}
              className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs"
            >
              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800 truncate">{plant.name}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 capitalize ${styles.badge}`}>
                    {plant.health}
                  </span>
                </div>
                <p className="text-gray-500 text-[10px] mt-0.5 truncate">{plant.notes}</p>
                <p className="text-gray-400 text-[10px]">{plant.location} · checked {plant.last_check}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
