"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { NicheType } from "@/lib/design-tokens";
import { NICHE_COLORS, NICHE_LABELS } from "@/lib/design-tokens";
import { analytics } from "@/lib/analytics";

// The task spec names 5 niches for the dropdown. We include all defined niches.
const NICHE_OPTIONS: { value: NicheType; label: string }[] = [
  { value: "restaurant",   label: "Restaurant"    },
  { value: "hvac",         label: "HVAC"          },
  { value: "tree_service", label: "Tree Service"  },
  { value: "landscaping",  label: "Landscaping"   },
  { value: "barber",       label: "Barber / Salon" },
];

// Map niche → solid dot color (Tailwind safe-listed classes)
const NICHE_DOT: Record<NicheType, string> = {
  restaurant:   "bg-red-500",
  hvac:         "bg-blue-500",
  plumbing:     "bg-blue-500",
  tree_service: "bg-green-500",
  landscaping:  "bg-emerald-500",
  barber:       "bg-purple-500",
  salon:        "bg-purple-500",
};

interface NicheToggleProps {
  /** Supabase tenants.id — passed down from the server layout */
  tenantId: string;
  /** Starting niche read from auth JWT / DB in the server layout */
  initialNiche: NicheType;
}

export function NicheToggle({ tenantId, initialNiche }: NicheToggleProps) {
  const router = useRouter();
  const [current, setCurrent] = useState<NicheType>(initialNiche);
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [, startTransition]   = useTransition();

  const colors = NICHE_COLORS[current];

  async function handleSelect(niche: NicheType) {
    if (niche === current) { setOpen(false); return; }
    setSaving(true);
    const sb = createClient();
    const { error } = await sb
      .from("tenants")
      .update({ tenant_type: niche })
      .eq("id", tenantId);

    setSaving(false);
    if (!error) {
      analytics.nicheChanged(current, niche);
      setCurrent(niche);
    }
    setOpen(false);
    // Re-render server components so BentoGrid picks up the new niche
    startTransition(() => router.refresh());
  }

  return (
    <div className="relative px-2 mb-1">
      {/* Badge / trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch niche"
        className={`
          w-full flex items-center justify-between gap-1.5
          px-2.5 py-1.5 rounded-lg text-xs font-medium border
          transition-opacity
          ${colors.bg} ${colors.border} ${colors.text}
          disabled:opacity-50 hover:brightness-95
        `}
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className={`w-2 h-2 rounded-full shrink-0 ${NICHE_DOT[current]}`} />
          {NICHE_LABELS[current]}
        </span>
        {saving ? (
          <svg className="h-3 w-3 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg
            className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20" fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <ul
            role="listbox"
            aria-label="Select niche"
            className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden text-xs"
          >
            {NICHE_OPTIONS.map((opt) => {
              const isActive = opt.value === current;
              return (
                <li key={opt.value}>
                  <button
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(opt.value)}
                    className={`
                      w-full text-left px-3 py-2 flex items-center gap-2
                      transition-colors hover:bg-gray-50 dark:hover:bg-gray-800
                      ${isActive ? "font-semibold" : "font-normal text-gray-600 dark:text-gray-300"}
                    `}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${NICHE_DOT[opt.value]}`} />
                    {opt.label}
                    {isActive && (
                      <svg className="ml-auto h-3 w-3 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
