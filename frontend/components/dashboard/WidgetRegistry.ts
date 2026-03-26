/**
 * Widget Registry — maps each tenant_type to an ordered array of widget
 * component names with size and grid position.
 *
 * BentoGrid reads this to decide what to render per niche.
 * Universal widgets appear in every niche. Niche-specific widgets only
 * appear for their industry.
 */
import type { NicheType } from "@/lib/design-tokens";

export type WidgetSize = "sm" | "md" | "lg";

export interface WidgetConfig {
  id: string;
  /** Component name — must match a key in WIDGET_COMPONENTS in BentoGrid */
  component: string;
  size: WidgetSize;
  /** Tailwind col-span class */
  colSpan: string;
  /** Tailwind row-span class */
  rowSpan: string;
}

// Universal widgets shown in every niche
const UNIVERSAL: WidgetConfig[] = [
  { id: "compliance-score",  component: "ComplianceScoreWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
  { id: "alert-feed",        component: "AlertFeedWidget",       size: "lg", colSpan: "col-span-2", rowSpan: "row-span-2" },
  { id: "daily-checklist",   component: "DailyChecklistWidget",  size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
];

export const WIDGET_REGISTRY: Record<NicheType, WidgetConfig[]> = {
  restaurant: [
    ...UNIVERSAL,
    { id: "temp-log",     component: "TempLogWidget",     size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "grease-trap",  component: "GreaseTrapWidget",  size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "hood-score",   component: "HoodScoreWidget",   size: "sm", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  hvac: [
    ...UNIVERSAL,
    { id: "leak-rate",      component: "LeakRateWidget",      size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "refrigerant-log", component: "RefrigerantLogWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "pressure",       component: "PressureWidget",       size: "sm", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  plumbing: [
    ...UNIVERSAL,
    { id: "leak-rate",      component: "LeakRateWidget",      size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "pressure",       component: "PressureWidget",       size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  tree_service: [
    { id: "alert-feed",      component: "AlertFeedWidget",      size: "lg", colSpan: "col-span-2", rowSpan: "row-span-2" },
    { id: "daily-checklist", component: "DailyChecklistWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "safety-score",    component: "SafetyScoreGauge",     size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "tree-map",        component: "TreeMapWidget",         size: "lg", colSpan: "col-span-2", rowSpan: "row-span-2" },
    { id: "equipment-log",   component: "EquipmentLogWidget",   size: "sm", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  landscaping: [
    ...UNIVERSAL,
    { id: "chem-log",    component: "ChemLogWidget",    size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "irrigation",  component: "IrrigationWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "plant-health", component: "PlantHealthWidget", size: "sm", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  barber: [
    { id: "alert-feed",      component: "AlertFeedWidget",      size: "lg", colSpan: "col-span-2", rowSpan: "row-span-2" },
    { id: "daily-checklist", component: "DailyChecklistWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "sanitation-streak", component: "SanitationStreakWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "client-formulas", component: "ClientFormulasWidget",  size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "waiver-queue",    component: "WaiverQueueWidget",     size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
  salon: [
    { id: "alert-feed",      component: "AlertFeedWidget",      size: "lg", colSpan: "col-span-2", rowSpan: "row-span-2" },
    { id: "daily-checklist", component: "DailyChecklistWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "sanitation-streak", component: "SanitationStreakWidget", size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
    { id: "client-formulas", component: "ClientFormulasWidget",  size: "lg", colSpan: "col-span-2", rowSpan: "row-span-1" },
    { id: "waiver-queue",    component: "WaiverQueueWidget",     size: "md", colSpan: "col-span-1", rowSpan: "row-span-1" },
  ],
};

export function getWidgets(nicheType: NicheType): WidgetConfig[] {
  return WIDGET_REGISTRY[nicheType] ?? UNIVERSAL;
}
