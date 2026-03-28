"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const TOUR_STEPS = [
  {
    title: "Welcome to LeakLock!",
    body: "LeakLock catches revenue your team earned but forgot to bill. Let's take a quick look around.",
    page: "/dashboard",
  },
  {
    title: "Your Dashboard",
    body: "This is your home base. You'll see active jobs, detected leaks, and how much revenue you've recovered at a glance.",
    page: "/dashboard",
  },
  {
    title: "Field Capture",
    body: "After a job, your techs record what happened here — voice notes, typed notes, or photos. Our AI reads it and extracts line items automatically.",
    page: "/field",
  },
  {
    title: "Auditor Review",
    body: "When we detect unbilled work, it lands here. You'll review each leak and either confirm it (update the invoice) or dismiss it as a false positive.",
    page: "/auditor",
  },
  {
    title: "Alerts & Notifications",
    body: "Get notified instantly when a leak is detected. Set up email, SMS, or push alerts in Settings so you never miss one.",
    page: "/alerts",
  },
  {
    title: "You're all set!",
    body: "You can revisit this guide anytime from 'Getting Started' in the sidebar. Now go catch some revenue!",
    page: "/getting-started",
  },
];

const STORAGE_KEY = "leaklock_tour_completed";

export function OnboardingTour() {
  const [step, setStep] = useState(-1); // -1 = not started / hidden
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Show tour only once, only on dashboard
    if (pathname !== "/dashboard") return;
    try {
      const done = localStorage.getItem(STORAGE_KEY);
      if (!done) {
        // Small delay so the page renders first
        const timer = setTimeout(() => {
          setStep(0);
          setVisible(true);
        }, 800);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage not available
    }
  }, [pathname]);

  function next() {
    const nextStep = step + 1;
    if (nextStep >= TOUR_STEPS.length) {
      finish();
      return;
    }
    setStep(nextStep);
    const nextPage = TOUR_STEPS[nextStep]?.page;
    if (nextPage && nextPage !== pathname) {
      router.push(nextPage);
    }
  }

  function back() {
    const prevStep = step - 1;
    if (prevStep < 0) return;
    setStep(prevStep);
    const prevPage = TOUR_STEPS[prevStep]?.page;
    if (prevPage && prevPage !== pathname) {
      router.push(prevPage);
    }
  }

  function finish() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore
    }
  }

  function skip() {
    finish();
    router.push("/getting-started");
  }

  if (!visible || step < 0) return null;

  const current = TOUR_STEPS[step]!;
  const isLast = step === TOUR_STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[9998] transition-opacity" />

      {/* Tour card */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[90vw] max-w-md">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-gray-100 dark:bg-gray-800">
            <div
              className="h-1 bg-blue-600 transition-all duration-300"
              style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>

          <div className="p-5">
            {/* Step counter */}
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
              {step + 1} of {TOUR_STEPS.length}
            </p>

            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              {current.title}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {current.body}
            </p>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5">
              <button
                onClick={skip}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {isLast ? "" : "Skip tour"}
              </button>
              <div className="flex items-center gap-2">
                {!isFirst && (
                  <button
                    onClick={back}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={next}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {isLast ? "Get started" : isFirst ? "Take the tour" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
