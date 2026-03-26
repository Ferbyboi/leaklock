"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const MOCK_CLIENTS = [
  {
    id: "c1",
    name: "Maria G.",
    last_visit: "2026-03-20",
    base_color: "7N Natural Blonde",
    toner: "T18 Wella",
    developer: "20 vol",
    process_time_min: 35,
    notes: "Sensitive scalp — skip bleach on roots",
  },
  {
    id: "c2",
    name: "Jordan T.",
    last_visit: "2026-03-18",
    base_color: "4A Ash Brown",
    toner: null,
    developer: "30 vol",
    process_time_min: 40,
    notes: "Resistant grays — section crown separately",
  },
  {
    id: "c3",
    name: "Sam R.",
    last_visit: "2026-03-15",
    base_color: "Balayage — freehand",
    toner: "Olaplex 8 bond mask",
    developer: "40 vol (highlights)",
    process_time_min: 60,
    notes: "Full foil on top, balayage underneath",
  },
  {
    id: "c4",
    name: "Alex K.",
    last_visit: "2026-03-10",
    base_color: "5R Medium Auburn",
    toner: null,
    developer: "20 vol",
    process_time_min: 30,
    notes: "Always use extra conditioner — very dry",
  },
];

type ClientFormula = (typeof MOCK_CLIENTS)[0];

interface Props {
  jobId?: string;
  tenantId?: string;
  className?: string;
}

export function ClientFormulasWidget({ jobId: _jobId, tenantId, className }: Props) {
  const [clients, setClients] = useState<ClientFormula[]>(MOCK_CLIENTS);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const supabase = createClient();

    supabase
      .from("client_formulas")
      .select("id, client_name, service_type, formula_data, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return;
        const transformed: ClientFormula[] = data.map((r) => ({
          id: r.id,
          name: r.client_name,
          last_visit: (r.updated_at ?? "").split("T")[0],
          base_color: r.formula_data?.base_color ?? r.service_type ?? "—",
          toner: r.formula_data?.toner ?? null,
          developer: r.formula_data?.developer ?? "—",
          process_time_min: r.formula_data?.process_time_min ?? 0,
          notes: r.formula_data?.notes ?? "",
        }));
        setClients(transformed);
      });
  }, [tenantId]);

  const selectedClient = clients.find((c) => c.id === selected) ?? null;

  return (
    <div className={`rounded-xl border bg-white p-4 h-full flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-900">Client Formulas</span>
        <span className="text-xs text-gray-500">{clients.length} clients</span>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* Client list */}
        <ul className="w-32 flex-shrink-0 space-y-1 overflow-y-auto">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setSelected(selected === c.id ? null : c.id)}
                className={`w-full text-left rounded-lg px-2 py-2 text-xs transition-colors ${
                  selected === c.id
                    ? "bg-purple-50 text-purple-800 font-semibold border border-purple-200"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <p className="font-medium truncate">{c.name}</p>
                <p className="text-[10px] text-gray-400">{c.last_visit}</p>
              </button>
            </li>
          ))}
        </ul>

        {/* Formula card */}
        <div className="flex-1 min-w-0">
          {selectedClient ? (
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 h-full text-xs space-y-2">
              <p className="font-semibold text-gray-900 text-sm">{selectedClient.name}</p>
              <div className="space-y-1.5">
                <Row label="Base" value={selectedClient.base_color} />
                {selectedClient.toner && <Row label="Toner" value={selectedClient.toner} />}
                <Row label="Developer" value={selectedClient.developer} />
                <Row label="Process" value={`${selectedClient.process_time_min} min`} />
              </div>
              {selectedClient.notes && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-[10px] text-yellow-800">
                  <span className="font-semibold">Note: </span>{selectedClient.notes}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-gray-400">
              Select a client to view formula
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="font-medium text-gray-800 text-right">{value}</span>
    </div>
  );
}
