"use client";

import { useRef, useState, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";
import { createClient } from "@/lib/supabase";

const MOCK_QUEUE = [
  { id: "w1", client_name: "Alex Kim",   service: "Keratin Treatment", status: "pending" },
  { id: "w2", client_name: "Jordan Lee", service: "Chemical Relaxer",  status: "pending" },
  { id: "w3", client_name: "Sam Patel",  service: "Full Highlights",   status: "signed"  },
];

type WaiverEntry = (typeof MOCK_QUEUE)[0];

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function WaiverQueueWidget({ jobId, tenantId, className }: Props) {
  const [queue, setQueue] = useState<WaiverEntry[]>(MOCK_QUEUE);
  const [signing, setSigning] = useState<string | null>(null);
  const sigRef = useRef<SignatureCanvas | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    async function fetchData() {
      const { data, error } = await supabase
        .from("signed_waivers")
        .select("id, client_name, service_type, signed_at")
        .eq("tenant_id", tenantId)
        .order("signed_at", { ascending: false, nullsFirst: true })
        .limit(20);

      if (error || !data || data.length === 0) return;

      const fetched: WaiverEntry[] = data.map((r) => ({
        id: r.id,
        client_name: r.client_name,
        service: r.service_type,
        status: r.signed_at ? "signed" : "pending",
      }));

      setQueue(fetched);
    }

    fetchData();
  }, [tenantId]);

  const pendingCount = queue.filter((w) => w.status === "pending").length;

  function handleOpenSign(id: string) {
    setSigning(id);
  }

  async function handleSaveSignature() {
    if (!sigRef.current || sigRef.current.isEmpty()) return;

    // Update local state immediately so the UI doesn't block
    setQueue((prev) =>
      prev.map((w) => (w.id === signing ? { ...w, status: "signed" } : w))
    );
    const signingId = signing;
    setSigning(null);

    // Persist to Supabase in the background
    try {
      const dataUrl = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();
      const sb = createClient();
      const path = `waivers/${tenantId}/${signingId}-${Date.now()}.png`;
      const { data: uploadData } = await sb.storage
        .from("field-photos")
        .upload(path, blob, { contentType: "image/png" });

      if (uploadData) {
        const { data: urlData } = sb.storage.from("field-photos").getPublicUrl(path);
        await sb
          .from("signed_waivers")
          .update({ signed_at: new Date().toISOString(), signature_url: urlData.publicUrl })
          .eq("id", signingId)
          .eq("tenant_id", tenantId);
      }
    } catch {
      // Don't block the UI on upload failure
    }
  }

  function handleClear() {
    sigRef.current?.clear();
  }

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Waiver Queue</span>
        {pendingCount > 0 && (
          <span className="text-xs font-medium bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Signing pad overlay */}
      {signing && (
        <div className="flex-1 flex flex-col gap-2">
          <p className="text-xs text-gray-600">
            Signing waiver for:{" "}
            <strong>{queue.find((w) => w.id === signing)?.client_name}</strong>
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
            <SignatureCanvas
              ref={sigRef}
              penColor="#1e293b"
              canvasProps={{
                className: "w-full",
                style: { width: "100%", height: 120 },
              }}
            />
          </div>
          <p className="text-[10px] text-gray-400">Sign in the box above</p>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-lg py-1.5 hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setSigning(null)}
              className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-lg py-1.5 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSignature}
              className="flex-1 text-xs bg-indigo-600 text-white rounded-lg py-1.5 hover:bg-indigo-700 transition-colors font-medium"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Queue list */}
      {!signing && (
        <ul className="flex-1 overflow-y-auto space-y-1.5">
          {queue.map((waiver) => (
            <li
              key={waiver.id}
              className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs"
            >
              <div>
                <p className="font-medium text-gray-800">{waiver.client_name}</p>
                <p className="text-gray-500 text-[10px]">{waiver.service}</p>
              </div>
              {waiver.status === "pending" ? (
                <button
                  onClick={() => handleOpenSign(waiver.id)}
                  className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-1 rounded-md hover:bg-indigo-100 transition-colors font-medium"
                >
                  Sign
                </button>
              ) : (
                <span className="text-xs bg-green-50 text-green-700 border border-green-100 px-2 py-1 rounded-md font-medium">
                  Signed
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
