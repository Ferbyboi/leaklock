"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { VoiceRecorder } from "@/components/field/VoiceRecorder";
import { PhotoCapture } from "@/components/field/PhotoCapture";
import { FieldDrawer } from "@/components/field/FieldDrawer";

type CaptureTab = "voice" | "photo";

function FieldCaptureContent() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const locationId = params.get("locationId") ?? undefined;

  const [tab, setTab] = useState<CaptureTab>("voice");
  const [events, setEvents] = useState<{ id: string; type: CaptureTab; timestamp: Date }[]>([]);

  if (!jobId) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        No job selected. Navigate here from a job page.
      </div>
    );
  }

  function addEvent(id: string, type: CaptureTab) {
    setEvents((prev) => [{ id, type, timestamp: new Date() }, ...prev]);
  }

  return (
    <div className="max-w-md mx-auto space-y-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Field Capture</h1>
        <p className="text-sm text-gray-500 mt-1 font-mono">Job {jobId.slice(0, 8)}…</p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border bg-muted p-1 gap-1">
        {(["voice", "photo"] as CaptureTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "voice" ? "🎙 Voice" : "📷 Photo"}
          </button>
        ))}
      </div>

      {/* Capture component */}
      {tab === "voice" ? (
        <VoiceRecorder
          jobId={jobId}
          locationId={locationId}
          onComplete={(id) => addEvent(id, "voice")}
        />
      ) : (
        <PhotoCapture
          jobId={jobId}
          locationId={locationId}
          onComplete={(id) => addEvent(id, "photo")}
        />
      )}

      {/* Captured events log */}
      {events.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Captured this session
          </h2>
          <ul className="space-y-1">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center gap-2 text-xs text-gray-500 bg-muted rounded-lg px-3 py-2"
              >
                <span>{ev.type === "voice" ? "🎙" : "📷"}</span>
                <span className="font-mono truncate flex-1">{ev.id.slice(0, 16)}…</span>
                <span>{ev.timestamp.toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldDrawer jobId={jobId} />
    </div>
  );
}

export default function FieldCapturePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading…</div>}>
      <FieldCaptureContent />
    </Suspense>
  );
}
