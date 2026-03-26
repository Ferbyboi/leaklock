"use client";

// npm packages required: vaul, fuse.js, cmdk
// (This component uses a custom palette impl — cmdk is available as an alternative)

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const router = useRouter();

  const commands: Command[] = [
    // Navigation
    { id: "nav-dashboard", label: "Go to Dashboard", icon: "⬡", action: () => router.push("/"), keywords: ["home", "overview"] },
    { id: "nav-jobs", label: "Go to Jobs", icon: "⊞", action: () => router.push("/jobs"), keywords: ["list", "all jobs"] },
    { id: "nav-auditor", label: "Open Auditor", icon: "⊘", action: () => router.push("/auditor"), keywords: ["review", "leaks"] },
    { id: "nav-field", label: "Field Capture", icon: "⊕", action: () => router.push("/field"), keywords: ["voice", "photo", "capture"] },
    { id: "nav-schedule", label: "Schedule", icon: "⊡", action: () => router.push("/schedule"), keywords: ["calendar", "maintenance"] },
    { id: "nav-alerts", label: "Alerts", icon: "⊙", action: () => router.push("/alerts"), keywords: ["notifications", "warnings"] },
    { id: "nav-team", label: "Team", icon: "⊚", action: () => router.push("/team"), keywords: ["users", "members"] },
    { id: "nav-billing", label: "Billing", icon: "⊟", action: () => router.push("/billing"), keywords: ["plan", "subscription", "payment"] },
    { id: "nav-settings", label: "Settings", icon: "⊜", action: () => router.push("/settings"), keywords: ["preferences", "notifications", "profile"] },
    // Actions
    { id: "action-export-jobs", label: "Export Jobs CSV", icon: "↓", action: () => { window.open("/api/export?type=jobs&format=csv"); }, keywords: ["download", "csv", "export"] },
    { id: "action-export-leaks", label: "Export Leaks CSV", icon: "↓", action: () => { window.open("/api/export?type=leaks&format=csv"); }, keywords: ["download", "revenue", "discrepancy"] },
  ];

  const filtered = query
    ? commands.filter(cmd =>
        cmd.label.toLowerCase().includes(query.toLowerCase()) ||
        cmd.description?.toLowerCase().includes(query.toLowerCase()) ||
        cmd.keywords?.some(k => k.toLowerCase().includes(query.toLowerCase()))
      )
    : commands;

  // Cmd+Shift+P or Cmd+/ to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.shiftKey && e.key === "p")) {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const run = useCallback((cmd: Command) => {
    cmd.action();
    setOpen(false);
    setQuery("");
    setSelectedIdx(0);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[selectedIdx]) run(filtered[selectedIdx]);
  };

  useEffect(() => { setSelectedIdx(0); }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-gray-400">⌘</span>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a command or search…"
            className="flex-1 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
          />
          <kbd className="text-[10px] text-gray-400 font-mono">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
          {filtered.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                onClick={() => run(cmd)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors ${i === selectedIdx ? "bg-blue-50 dark:bg-blue-950" : ""}`}
              >
                {cmd.icon && <span className="text-lg w-6 text-center shrink-0">{cmd.icon}</span>}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{cmd.label}</p>
                  {cmd.description && <p className="text-xs text-gray-400">{cmd.description}</p>}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400">No commands found</li>
          )}
        </ul>
        <div className="px-4 py-2 border-t border-gray-50 dark:border-gray-800 text-[10px] text-gray-400 flex gap-4">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
