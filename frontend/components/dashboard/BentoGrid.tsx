"use client";

import { type NicheType } from "@/lib/design-tokens";
import { getWidgets } from "./WidgetRegistry";
import { Suspense } from "react";
import { ComplianceScoreWidget }   from "./widgets/ComplianceScoreWidget";
import { AlertFeedWidget }         from "./widgets/AlertFeedWidget";
import { DailyChecklistWidget }    from "./widgets/DailyChecklistWidget";
import { TempLogWidget }           from "./widgets/TempLogWidget";
import { GreaseTrapWidget }        from "./widgets/GreaseTrapWidget";
import { LeakRateWidget }          from "./widgets/LeakRateWidget";
import { SanitationStreakWidget }  from "./widgets/SanitationStreakWidget";
import { ChemLogWidget }           from "./widgets/ChemLogWidget";
import { HoodScoreWidget }         from "./widgets/HoodScoreWidget";
import { RefrigerantLogWidget }    from "./widgets/RefrigerantLogWidget";
import { PressureWidget }          from "./widgets/PressureWidget";
import { SafetyScoreGauge }        from "./widgets/SafetyScoreGauge";
import { TreeMapWidget }           from "./widgets/TreeMapWidget";
import { EquipmentLogWidget }      from "./widgets/EquipmentLogWidget";
import { IrrigationWidget }        from "./widgets/IrrigationWidget";
import { PlantHealthWidget }       from "./widgets/PlantHealthWidget";
import { ClientFormulasWidget }    from "./widgets/ClientFormulasWidget";
import { WaiverQueueWidget }       from "./widgets/WaiverQueueWidget";

// ── Skeleton for niche-specific widgets not yet implemented ───────────────────
function WidgetSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center justify-center text-gray-500 text-sm">
      {label}
    </div>
  );
}

// ── Widget component map ───────────────────────────────────────────────────────
// Props superset — covers both legacy { locationId } and newer { jobId, tenantId } shapes
type WidgetProps = { locationId?: string; jobId?: string; tenantId?: string; className?: string };
const WIDGET_COMPONENTS: Record<string, React.ComponentType<WidgetProps>> = {
  ComplianceScoreWidget,
  AlertFeedWidget,
  DailyChecklistWidget,
  // Niche-specific widgets
  TempLogWidget,
  GreaseTrapWidget,
  LeakRateWidget,
  SanitationStreakWidget,
  ChemLogWidget,
  // Niche-specific widgets (fully implemented)
  HoodScoreWidget,
  RefrigerantLogWidget,
  PressureWidget,
  SafetyScoreGauge,
  TreeMapWidget,
  EquipmentLogWidget,
  IrrigationWidget,
  PlantHealthWidget,
  ClientFormulasWidget,
  WaiverQueueWidget,
};

interface BentoGridProps {
  nicheType: NicheType;
  locationId?: string;
  /** Supabase tenant ID — required by niche-specific widgets */
  tenantId?: string;
}

export function BentoGrid({ nicheType, locationId, tenantId = "" }: BentoGridProps) {
  const widgets = getWidgets(nicheType);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {widgets.map((config) => {
        const Component = WIDGET_COMPONENTS[config.component];
        if (!Component) return null;

        return (
          <div
            key={config.id}
            className={`${config.colSpan} ${config.rowSpan}`}
          >
            <Suspense fallback={<WidgetSkeleton label={config.component} />}>
              <Component locationId={locationId} tenantId={tenantId} />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
