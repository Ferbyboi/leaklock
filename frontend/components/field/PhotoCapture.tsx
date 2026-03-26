"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

interface Props {
  jobId: string;
  locationId?: string;
  onComplete?: (fieldEventId: string, photoUrl: string) => void;
  maxSizeMb?: number;
}

type UploadState = "idle" | "uploading" | "done" | "error";

export function PhotoCapture({ jobId, locationId, onComplete, maxSizeMb = 10 }: Props) {
  const [state, setState] = useState<UploadState>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`File exceeds ${maxSizeMb} MB limit`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setState("uploading");

    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `photos/${user.id}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await sb.storage
        .from("field-media")
        .upload(path, file, { contentType: file.type });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = sb.storage.from("field-media").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const { data: eventData, error: eventErr } = await sb
        .from("field_events")
        .insert({
          job_id: jobId,
          location_id: locationId ?? null,
          user_id: user.id,
          event_type: "photo",
          raw_storage_url: publicUrl,
          compliance_status: "pending",
        })
        .select("id")
        .single();

      if (eventErr) throw eventErr;

      // Trigger OCR + compliance evaluation
      sb.functions.invoke("evaluate-compliance", {
        body: { field_event_id: eventData.id, photo_url: publicUrl },
      });

      URL.revokeObjectURL(objectUrl);
      setState("done");
      onComplete?.(eventData.id, publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setState("error");
      URL.revokeObjectURL(objectUrl);
      setPreview(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4 rounded-xl border bg-card">
      <h3 className="text-sm font-medium">Photo</h3>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {state === "idle" && (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-20 h-20 rounded-xl border-2 border-dashed border-muted-foreground/40 hover:border-primary flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-primary transition-colors"
        >
          <CameraIcon />
          <span className="text-xs">Take photo</span>
        </button>
      )}

      {preview && state === "uploading" && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview" className="w-32 h-32 object-cover rounded-lg opacity-60" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}

      {state === "done" && preview && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Captured" className="w-32 h-32 object-cover rounded-lg" />
          <span className="text-green-600 text-sm font-medium">✓ Photo saved</span>
          <button
            onClick={() => { setState("idle"); setPreview(null); }}
            className="text-xs text-gray-500 underline"
          >
            Add another
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-red-600 text-sm">{error}</span>
          <button
            onClick={() => { setState("idle"); setError(null); setPreview(null); }}
            className="text-xs text-gray-500 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
