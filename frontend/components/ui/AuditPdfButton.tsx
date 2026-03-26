"use client";

import { useState } from "react";

interface AuditPdfButtonProps {
  jobId: string;
  crmJobId?: string;
}

export function AuditPdfButton({ jobId, crmJobId }: AuditPdfButtonProps) {
  const [loading, setLoading] = useState(false);

  async function download() {
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${apiBase}/reports/job/${jobId}/audit.pdf`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const filename = `leaklock-audit-${crmJobId ?? jobId.slice(0, 8)}.pdf`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={loading}
      title="Download audit PDF"
      className="px-2 py-0.5 text-xs font-medium text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
    >
      {loading ? "…" : "↓ PDF"}
    </button>
  );
}
