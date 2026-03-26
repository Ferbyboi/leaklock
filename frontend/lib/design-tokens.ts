/**
 * LeakLock Design Tokens
 * Niche-specific color accents + shared design constants.
 * Import from here — never hardcode colors in components.
 */

export type NicheType =
  | "restaurant"
  | "hvac"
  | "plumbing"
  | "tree_service"
  | "landscaping"
  | "barber"
  | "salon";

/** Primary accent color per niche (Tailwind CSS class suffixes) */
export const NICHE_COLORS: Record<NicheType, {
  accent: string;
  bg: string;
  border: string;
  text: string;
  hex: string;
}> = {
  restaurant: {
    accent: "red",
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-600 dark:text-red-400",
    hex: "#dc2626",
  },
  hvac: {
    accent: "blue",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-600 dark:text-blue-400",
    hex: "#2563eb",
  },
  plumbing: {
    accent: "blue",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-600 dark:text-blue-400",
    hex: "#2563eb",
  },
  tree_service: {
    accent: "green",
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
    text: "text-green-600 dark:text-green-400",
    hex: "#16a34a",
  },
  landscaping: {
    accent: "emerald",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-600 dark:text-emerald-400",
    hex: "#059669",
  },
  barber: {
    accent: "purple",
    bg: "bg-purple-50 dark:bg-purple-950",
    border: "border-purple-200 dark:border-purple-800",
    text: "text-purple-600 dark:text-purple-400",
    hex: "#9333ea",
  },
  salon: {
    accent: "purple",
    bg: "bg-purple-50 dark:bg-purple-950",
    border: "border-purple-200 dark:border-purple-800",
    text: "text-purple-600 dark:text-purple-400",
    hex: "#9333ea",
  },
};

/** Severity colors for alerts */
export const SEVERITY_COLORS = {
  critical: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300", hex: "#dc2626" },
  warning:  { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-300", hex: "#d97706" },
  info:     { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-300", hex: "#2563eb" },
} as const;

/** Compliance score color thresholds */
export function getComplianceColor(score: number): string {
  if (score >= 90) return "#16a34a"; // green
  if (score >= 70) return "#d97706"; // amber
  return "#dc2626";                  // red
}

/** Niche display names */
export const NICHE_LABELS: Record<NicheType, string> = {
  restaurant:   "Restaurant",
  hvac:         "HVAC",
  plumbing:     "Plumbing",
  tree_service: "Tree Service",
  landscaping:  "Landscaping",
  barber:       "Barber / Salon",
  salon:        "Barber / Salon",
};

/** Niche icons (Lucide icon names) */
export const NICHE_ICONS: Record<NicheType, string> = {
  restaurant:   "UtensilsCrossed",
  hvac:         "Thermometer",
  plumbing:     "Droplet",
  tree_service: "Trees",
  landscaping:  "Leaf",
  barber:       "Scissors",
  salon:        "Scissors",
};

// ── Niche Themes (full accent system) ────────────────────────────────────────

export interface NicheTheme {
  label: string;
  icon: string;
  accent: string;       // Tailwind bg class
  accentText: string;   // Tailwind text class
  accentBorder: string; // Tailwind border class
  accentLight: string;  // Light bg variant
  accentDark: string;   // Dark mode bg
}

export const NICHE_THEMES: Record<string, NicheTheme> = {
  restaurant: {
    label: "Restaurant",
    icon: "🍽️",
    accent: "bg-orange-500",
    accentText: "text-orange-600",
    accentBorder: "border-orange-300",
    accentLight: "bg-orange-50",
    accentDark: "dark:bg-orange-950",
  },
  hvac: {
    label: "HVAC",
    icon: "❄️",
    accent: "bg-sky-500",
    accentText: "text-sky-600",
    accentBorder: "border-sky-300",
    accentLight: "bg-sky-50",
    accentDark: "dark:bg-sky-950",
  },
  tree: {
    label: "Tree Service",
    icon: "🌲",
    accent: "bg-green-600",
    accentText: "text-green-700",
    accentBorder: "border-green-300",
    accentLight: "bg-green-50",
    accentDark: "dark:bg-green-950",
  },
  tree_service: {
    label: "Tree Service",
    icon: "🌲",
    accent: "bg-green-600",
    accentText: "text-green-700",
    accentBorder: "border-green-300",
    accentLight: "bg-green-50",
    accentDark: "dark:bg-green-950",
  },
  landscaping: {
    label: "Landscaping",
    icon: "🌿",
    accent: "bg-lime-500",
    accentText: "text-lime-700",
    accentBorder: "border-lime-300",
    accentLight: "bg-lime-50",
    accentDark: "dark:bg-lime-950",
  },
  barber: {
    label: "Barber",
    icon: "✂️",
    accent: "bg-purple-600",
    accentText: "text-purple-700",
    accentBorder: "border-purple-300",
    accentLight: "bg-purple-50",
    accentDark: "dark:bg-purple-950",
  },
};

// ── Status colors (richer, shared across all niches) ─────────────────────────

export const STATUS_THEME = {
  pending_invoice: {
    dot: "bg-yellow-400",
    text: "text-yellow-700",
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    label: "Pending",
  },
  approved: {
    dot: "bg-green-500",
    text: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
    label: "Approved",
  },
  discrepancy: {
    dot: "bg-red-500",
    text: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    label: "Leak",
  },
  frozen: {
    dot: "bg-orange-400",
    text: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-200",
    label: "Frozen",
  },
  parsing: {
    dot: "bg-blue-400",
    text: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    label: "Parsing",
  },
} as const;

// ── Plan tiers ────────────────────────────────────────────────────────────────

export const PLAN_RANK = {
  starter:    1,
  pro:        2,
  growth:     2,  // legacy alias — same tier as pro
  enterprise: 3,
} as const;

export type PlanTier = keyof typeof PLAN_RANK;
