"use client";

// npm packages required: vaul, fuse.js, cmdk
// Install: npm install vaul fuse.js cmdk

import { useState } from "react";
import { Drawer } from "vaul";
import { VoiceRecorder } from "@/components/field/VoiceRecorder";
import { PhotoCapture } from "@/components/field/PhotoCapture";
import { createClient } from "@/lib/supabase";

interface FieldDrawerProps {
  jobId: string;
  triggerLabel?: string;
}

export function FieldDrawer({ jobId, triggerLabel = "Capture Field Data" }: FieldDrawerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"voice" | "photo" | "text">("voice");

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <button className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-blue-600 text-white font-medium rounded-full shadow-lg hover:bg-blue-700 active:scale-95 transition-all md:hidden">
          <span>⊕</span>
          <span className="text-sm">{triggerLabel}</span>
        </button>
      </Drawer.Trigger>

      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-12 rounded-full bg-gray-300 dark:bg-gray-600" />
          </div>

          <div className="px-4 pb-safe">
            <Drawer.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Field Capture — Job {jobId}
            </Drawer.Title>

            {/* Mode tabs */}
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-4">
              {(["voice", "photo", "text"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                    mode === m
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  {m === "voice" ? "🎙 Voice" : m === "photo" ? "📷 Photo" : "✍️ Text"}
                </button>
              ))}
            </div>

            {/* Content area */}
            <div className="mb-4">
              {mode === "voice" && (
                <VoiceRecorder jobId={jobId} onComplete={() => setOpen(false)} />
              )}
              {mode === "photo" && (
                <PhotoCapture jobId={jobId} onComplete={() => setOpen(false)} />
              )}
              {mode === "text" && (
                <TextNoteForm jobId={jobId} onComplete={() => setOpen(false)} />
              )}
            </div>
            <div className="h-6" /> {/* Safe area bottom */}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

interface TextNoteFormProps {
  jobId: string;
  onComplete: () => void;
}

function TextNoteForm({ jobId, onComplete }: TextNoteFormProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await sb.from("field_events").insert({
        job_id: jobId,
        user_id: user.id,
        event_type: "text",
        transcript: text.trim(),
        compliance_status: "pending",
      });
      if (error) throw error;
      onComplete();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter field notes…"
        rows={5}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
      <button
        type="submit"
        disabled={submitting || !text.trim()}
        className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Saving…" : "Save Note"}
      </button>
    </form>
  );
}
