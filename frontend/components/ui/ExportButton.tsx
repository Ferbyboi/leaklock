"use client";

import { useState } from "react";

interface ExportButtonProps {
  type?: "jobs" | "leaks" | "notifications";
  className?: string;
}

export function ExportButton({ type = "jobs", className = "" }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  async function doExport(format: "csv" | "json") {
    setExporting(true);
    try {
      const url = `/api/export?type=${type}&format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1]
        ?? `export.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={() => doExport("csv")}
        disabled={exporting}
        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {exporting ? "Exporting…" : "↓ CSV"}
      </button>
      <button
        onClick={() => doExport("json")}
        disabled={exporting}
        className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        ↓ JSON
      </button>
    </div>
  );
}
