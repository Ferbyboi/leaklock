"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

    if (!key) return; // Gracefully skip if not configured

    posthog.init(key, {
      api_host: host,
      capture_pageview: false, // Manual pageview tracking below
      persistence: "localStorage",
      autocapture: false, // Manual events only (per CLAUDE.md — track specific events)
      disable_session_recording: true, // Don't record sessions by default
    });
  }, []);

  // Track pageviews on route change
  useEffect(() => {
    if (typeof window === "undefined") return;
    posthog.capture("$pageview", {
      $current_url: window.location.href,
    });
  }, [pathname, searchParams]);

  return <>{children}</>;
}
