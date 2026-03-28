"use client";

import { useState } from "react";

interface Step {
  title: string;
  description: string;
  details: string[];
  link?: { href: string; label: string };
}

const STEPS: Step[] = [
  {
    title: "What is LeakLock?",
    description:
      "LeakLock catches revenue you earned but forgot to bill. When your techs finish a job, we compare what was done in the field against what's on the invoice — if something's missing, you get an alert before the invoice goes out.",
    details: [
      "Your tech writes a field note or snaps a photo of the work",
      "LeakLock reads it with AI and compares it to the quote and invoice",
      "If work was done but not billed, we flag it as a revenue leak",
      "You review, confirm, and update the invoice before the customer pays",
    ],
  },
  {
    title: "Connect your CRM",
    description:
      "LeakLock pulls job data automatically from your existing software. No double entry needed.",
    details: [
      "Go to Settings > Integrations",
      "Click 'Connect' next to your CRM (ServiceTitan, HousecallPro, Square, etc.)",
      "Authorize LeakLock to read your job and invoice data",
      "Or use webhooks if your CRM supports them — no login required",
    ],
    link: { href: "/settings/integrations", label: "Go to Integrations" },
  },
  {
    title: "Capture field data",
    description:
      "After a job, techs capture what actually happened — voice notes, typed notes, or photos of completed work.",
    details: [
      "Open the Field Capture page from the sidebar",
      "Select the job from the list",
      "Record a voice note, type a note, or snap a photo",
      "LeakLock's AI reads it and extracts materials, labor, and issues",
    ],
    link: { href: "/field", label: "Go to Field Capture" },
  },
  {
    title: "Review revenue leaks",
    description:
      "When LeakLock detects unbilled work, it shows up on the Auditor page. This is where you decide what to do.",
    details: [
      "Each leak shows the job, what was missed, and the estimated dollar amount",
      "'Confirm Leak' — update your invoice and recover the revenue",
      "'False Positive' — dismiss if it's not actually missing",
      "'Admin Override' — manually override the AI's decision",
    ],
    link: { href: "/auditor", label: "Go to Auditor" },
  },
  {
    title: "Set up notifications",
    description:
      "Get alerted the moment a leak is detected — by email, SMS, or push notification. Never miss unbilled work again.",
    details: [
      "Go to Settings and toggle on your preferred alert channels",
      "Set a dollar threshold so you only get notified for leaks above a certain amount",
      "Owners get all alerts by default; auditors can customize their preferences",
    ],
    link: { href: "/settings", label: "Go to Settings" },
  },
  {
    title: "Track your results",
    description:
      "The Dashboard and Reports pages show you how much revenue LeakLock has caught and your team's performance.",
    details: [
      "Dashboard — live overview of jobs, leaks, and recovery stats",
      "Reports — weekly/monthly breakdowns you can export as PDF or CSV",
      "Alerts page — history of all notifications sent",
    ],
    link: { href: "/dashboard", label: "Go to Dashboard" },
  },
];

const FAQ = [
  {
    q: "Do my techs need to learn new software?",
    a: "Barely. They just open Field Capture, pick the job, and talk or type. It takes 30 seconds. No training manual needed.",
  },
  {
    q: "What if LeakLock flags something that's not actually a leak?",
    a: "Just hit 'False Positive' on the Auditor page. We track your false positive rate and the AI gets better over time.",
  },
  {
    q: "Can I export data for my accountant?",
    a: "Yes. Every page with data has CSV and JSON export buttons. The Reports page also generates PDF summaries.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. Every query is filtered by your tenant ID. Your data is completely isolated from other businesses. We use Supabase with Row Level Security.",
  },
  {
    q: "What CRMs do you support?",
    a: "ServiceTitan, HousecallPro, Square, Toast POS, QuickBooks, and Jobber. Any CRM with webhooks can also connect directly.",
  },
];

export default function GettingStartedPage() {
  const [expandedStep, setExpandedStep] = useState<number>(0);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Getting Started
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Welcome to LeakLock. Here&apos;s everything you need to know to start
          catching unbilled revenue.
        </p>
      </div>

      {/* How it works — visual summary */}
      <section className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 rounded-xl border border-blue-100 dark:border-blue-900 p-6">
        <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">
          How LeakLock works in 30 seconds
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { step: "1", label: "Tech completes job", sub: "Field note or photo" },
            { step: "2", label: "AI reads the work", sub: "Extracts line items" },
            { step: "3", label: "3-way match", sub: "Quote vs. field vs. invoice" },
            { step: "4", label: "Leak alert", sub: "You review & recover $" },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold mb-2">
                {s.step}
              </div>
              <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                {s.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Step-by-step guide */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Step-by-step guide
        </h2>
        {STEPS.map((step, i) => {
          const isOpen = expandedStep === i;
          return (
            <div
              key={step.title}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden"
            >
              <button
                onClick={() => setExpandedStep(isOpen ? -1 : i)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {step.title}
                  </h3>
                  {!isOpen && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {step.description}
                    </p>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-0 border-t border-gray-50 dark:border-gray-800">
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">
                    {step.description}
                  </p>
                  <ul className="space-y-1.5 mb-4">
                    {step.details.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="text-blue-500 mt-0.5 shrink-0">-</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                  {step.link && (
                    <a
                      href={step.link.href}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      {step.link.label} &rarr;
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Frequently asked questions
        </h2>
        {FAQ.map((faq, i) => {
          const isOpen = expandedFaq === i;
          return (
            <div
              key={faq.q}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden"
            >
              <button
                onClick={() => setExpandedFaq(isOpen ? null : i)}
                className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {faq.q}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 ml-3 transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 pt-0 border-t border-gray-50 dark:border-gray-800">
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    {faq.a}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Help footer */}
      <div className="text-center py-4">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          Still have questions?{" "}
          <a
            href="mailto:support@leaklock.io"
            className="text-blue-600 hover:underline"
          >
            Contact support &rarr;
          </a>
        </p>
      </div>
    </div>
  );
}
