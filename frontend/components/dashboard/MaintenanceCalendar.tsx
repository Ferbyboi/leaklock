"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";

export type ScheduleJob = {
  id: string;
  crm_job_id: string;
  status: string;
  created_at: string;
  scheduled_at?: string | null;
};

interface Props {
  jobs: ScheduleJob[];
}

const STATUS_COLOR: Record<string, string> = {
  pending_invoice: "#f59e0b",
  approved: "#10b981",
  discrepancy: "#ef4444",
  frozen: "#f97316",
  parsing: "#3b82f6",
};

export function MaintenanceCalendar({ jobs }: Props) {
  const events = jobs.map((job) => ({
    id: job.id,
    title: job.crm_job_id,
    date: job.scheduled_at
      ? job.scheduled_at.split("T")[0]
      : job.created_at.split("T")[0],
    backgroundColor: STATUS_COLOR[job.status] ?? "#6b7280",
    borderColor: STATUS_COLOR[job.status] ?? "#6b7280",
    textColor: "#ffffff",
    extendedProps: { status: job.status, jobId: job.id },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleEventClick(info: any) {
    window.location.href = `/jobs/${info.event.extendedProps.jobId}`;
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 [&_.fc-toolbar-title]:text-gray-900 dark:[&_.fc-toolbar-title]:text-gray-100 [&_.fc-col-header-cell-cushion]:text-gray-500 [&_.fc-daygrid-day-number]:text-gray-500 [&_.fc-button]:!bg-blue-600 [&_.fc-button]:!border-blue-600 [&_.fc-button]:!text-white [&_.fc-button:hover]:!bg-blue-700 [&_.fc-button-active]:!bg-blue-800">
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        events={events}
        eventClick={handleEventClick}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,dayGridWeek",
        }}
        height="auto"
        eventDisplay="block"
        dayMaxEvents={3}
        moreLinkText={(n) => `+${n} more`}
        eventTimeFormat={{
          hour: "2-digit",
          minute: "2-digit",
          meridiem: false,
        }}
      />

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3 border-t border-gray-100 dark:border-gray-800 pt-3">
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
              {status.replace(/_/g, " ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
