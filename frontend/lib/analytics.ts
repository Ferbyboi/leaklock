/**
 * PostHog event helpers — all events defined in CLAUDE.md KPI targets.
 * Uses posthog-js directly via lib/posthog (initialized in PostHogProvider).
 */

import { track as posthogTrack } from "@/lib/posthog";

type EventName =
  | "revenue_leak_detected"
  | "voice_capture_completed"
  | "photo_capture_completed"
  | "false_positive_flagged"
  | "job_approved"
  | "job_frozen"
  | "report_downloaded"
  | "export_triggered"
  | "search_performed"
  | "notification_sent"
  | "compliance_check_completed"
  | "niche_changed";

interface EventProps {
  [key: string]: string | number | boolean | null | undefined;
}

export function track(event: EventName, props?: EventProps) {
  posthogTrack(event, props);
}

// Typed helpers
export const analytics = {
  leakDetected: (jobId: string, leakCents: number, nicheType: string) =>
    track("revenue_leak_detected", { job_id: jobId, leak_cents: leakCents, niche_type: nicheType }),

  voiceCaptureCompleted: (jobId: string, durationSecs: number, wordCount: number) =>
    track("voice_capture_completed", { job_id: jobId, duration_secs: durationSecs, word_count: wordCount }),

  photoCaptureCompleted: (jobId: string, confidence: number) =>
    track("photo_capture_completed", { job_id: jobId, confidence }),

  falsePositiveFlagged: (jobId: string, reason: string) =>
    track("false_positive_flagged", { job_id: jobId, reason }),

  jobApproved: (jobId: string, leakCents: number) =>
    track("job_approved", { job_id: jobId, leak_cents: leakCents }),

  jobFrozen: (jobId: string) =>
    track("job_frozen", { job_id: jobId }),

  reportDownloaded: (jobId: string) =>
    track("report_downloaded", { job_id: jobId }),

  exportTriggered: (exportType: string, format: string, rowCount?: number) =>
    track("export_triggered", { export_type: exportType, format, row_count: rowCount }),

  searchPerformed: (query: string, resultCount: number) =>
    track("search_performed", { query_length: query.length, result_count: resultCount }),

  notificationSent: (channel: string, tenantId: string) =>
    track("notification_sent", { channel, tenant_id: tenantId }),

  complianceCheckCompleted: (jobId: string, score: number, nicheType: string, violations: number) =>
    track("compliance_check_completed", { job_id: jobId, score, niche_type: nicheType, violation_count: violations }),

  nicheChanged: (from: string, to: string) =>
    track("niche_changed", { from, to }),
};
