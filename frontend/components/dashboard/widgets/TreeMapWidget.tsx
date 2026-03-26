"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase";

// Leaflet must be imported dynamically — it references `window` and cannot SSR
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MapContainer = dynamic<any>(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TileLayer = dynamic<any>(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);

const MOCK_JOBS = [
  { id: "j1", address: "123 Oak Lane",     lat: 40.7128, lng: -74.006,  status: "completed" },
  { id: "j2", address: "456 Maple Ave",    lat: 40.7158, lng: -73.998,  status: "scheduled" },
  { id: "j3", address: "789 Elm St",       lat: 40.7098, lng: -74.012,  status: "in_progress" },
  { id: "j4", address: "321 Birch Blvd",   lat: 40.7068, lng: -73.992,  status: "completed" },
  { id: "j5", address: "654 Cedar Court",  lat: 40.7188, lng: -74.018,  status: "scheduled" },
];

type JobPin = (typeof MOCK_JOBS)[0];

const STATUS_COLORS: Record<string, string> = {
  completed:   "#22c55e",
  scheduled:   "#3b82f6",
  in_progress: "#f59e0b",
};

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function TreeMapWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [jobs] = useState<JobPin[]>(MOCK_JOBS);
  const [mounted, setMounted] = useState(false);
  const [realJobs, setRealJobs] = useState<{ id: string; crm_job_id: string; address: string; status: string }[]>([]);

  // Ensure we only render the map client-side
  useEffect(() => {
    setMounted(true);
    // Fix leaflet default icon paths that break with webpack
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const L = require("leaflet");
    delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    async function fetchData() {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, crm_job_id, address, status")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error || !data || data.length === 0) return;

      setRealJobs(data);
    }

    fetchData();
  }, [tenantId]);

  const center: [number, number] = [40.7128, -74.006];

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Job Locations</span>
        <div className="flex gap-2 text-[10px]">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1 text-gray-600 capitalize">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              {status.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      {realJobs.length > 0 ? (
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {realJobs.map(job => (
            <div key={job.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
              <div>
                <p className="font-medium text-gray-800 truncate">{job.address ?? "—"}</p>
                <p className="text-gray-500 text-[10px]">{job.crm_job_id}</p>
              </div>
              <span className="ml-2 flex-shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[job.status] ?? "#6b7280" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-gray-100" style={{ minHeight: 220 }}>
          {mounted && (
            <MapContainer
              center={center}
              zoom={13}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {jobs.map((job) => (
                <Marker key={job.id} position={[job.lat, job.lng]}>
                  <Popup>
                    <div className="text-xs">
                      <p className="font-semibold">{job.address}</p>
                      <p
                        className="capitalize mt-0.5"
                        style={{ color: STATUS_COLORS[job.status] ?? "#6b7280" }}
                      >
                        {job.status.replace("_", " ")}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}
          {!mounted && (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              Loading map...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
