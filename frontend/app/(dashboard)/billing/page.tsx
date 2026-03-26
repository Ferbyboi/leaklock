"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { PlanTier } from "@/lib/design-tokens";
import { PLAN_RANK } from "@/lib/design-tokens";

interface PlanFeature {
  label: string;
  starter: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}

const PLAN_FEATURES: PlanFeature[] = [
  { label: "Jobs per month",        starter: "100",      pro: "1,000",    enterprise: "Unlimited" },
  { label: "Field capture (voice)", starter: true,       pro: true,       enterprise: true },
  { label: "Photo AI analysis",     starter: false,      pro: true,       enterprise: true },
  { label: "Revenue leak detection",starter: true,       pro: true,       enterprise: true },
  { label: "Niche compliance",      starter: "1 niche",  pro: "All",      enterprise: "All" },
  { label: "PDF reports",           starter: false,      pro: true,       enterprise: true },
  { label: "CSV export",            starter: false,      pro: true,       enterprise: true },
  { label: "API webhooks",          starter: false,      pro: false,      enterprise: true },
  { label: "Custom API access",     starter: false,      pro: false,      enterprise: true },
  { label: "SSO / SAML",           starter: false,      pro: false,      enterprise: true },
  { label: "Dedicated support",     starter: false,      pro: false,      enterprise: true },
];

const PLAN_PRICES: Record<string, { monthly: number; label: string; description: string; priceId: string }> = {
  starter:    { monthly: 49,   label: "Starter",    description: "For small crews",          priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID  ?? "" },
  pro:        { monthly: 149,  label: "Pro",         description: "For growing businesses",   priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID      ?? "" },
  growth:     { monthly: 149,  label: "Pro",         description: "For growing businesses",   priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID      ?? "" },
  enterprise: { monthly: 499,  label: "Enterprise",  description: "Unlimited scale + support", priceId: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID ?? "" },
};

function FeatureValue({ value }: { value: boolean | string }) {
  if (value === true)  return <span className="text-green-500">✓</span>;
  if (value === false) return <span className="text-gray-300">—</span>;
  return <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{value}</span>;
}

export default function BillingPage() {
  const [currentPlan, setCurrentPlan] = useState<PlanTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sb = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;

      const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;
      if (!tenantId) { setLoading(false); return; }

      const { data } = await sb
        .from("tenants")
        .select("plan")
        .eq("id", tenantId)
        .single();

      setCurrentPlan((data?.plan as PlanTier) ?? "starter");
      setLoading(false);
    }
    load();
  }, [sb]);

  async function handleUpgrade(plan: PlanTier) {
    if (plan === currentPlan) return;
    setCheckingOut(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Checkout failed");
      // Redirect to Stripe embedded checkout (or hosted)
      if (body.url) window.location.href = body.url;
      else if (body.client_secret) {
        // Embedded mode — for now redirect to onboarding billing step
        window.location.href = `/onboarding/step/4?client_secret=${body.client_secret}`;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setCheckingOut(null);
    }
  }

  const plans: PlanTier[] = ["starter", "pro", "enterprise"];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Billing</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your subscription plan.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-64 rounded-xl bg-gray-200/50 dark:bg-gray-700/30 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Current plan banner */}
          {currentPlan && PLAN_PRICES[currentPlan] && (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Current plan: <span className="capitalize">{PLAN_PRICES[currentPlan].label}</span>
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                  ${PLAN_PRICES[currentPlan].monthly}/mo · {PLAN_PRICES[currentPlan].description}
                </p>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 bg-blue-600 text-white rounded-full capitalize">
                {PLAN_PRICES[currentPlan].label}
              </span>
            </div>
          )}

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(plan => {
              const info = PLAN_PRICES[plan];
              // treat "growth" (legacy alias) as equivalent to "pro"
              const normalizedCurrent = currentPlan === "growth" ? "pro" : currentPlan;
              const isCurrent = plan === normalizedCurrent;
              const isUpgrade = normalizedCurrent ? PLAN_RANK[plan] > PLAN_RANK[normalizedCurrent] : true;
              const isDowngrade = normalizedCurrent ? PLAN_RANK[plan] < PLAN_RANK[normalizedCurrent] : false;
              const isPro = plan === "pro";

              return (
                <div
                  key={plan}
                  className={`relative bg-white dark:bg-gray-900 rounded-xl border-2 p-6 flex flex-col ${
                    isCurrent ? "border-blue-500" :
                    isPro ? "border-blue-200 dark:border-blue-800" :
                    "border-gray-100 dark:border-gray-800"
                  }`}
                >
                  {isPro && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="text-xs font-semibold px-3 py-1 bg-blue-600 text-white rounded-full">Most Popular</span>
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="text-xs font-semibold px-3 py-1 bg-green-600 text-white rounded-full">Current Plan</span>
                    </div>
                  )}

                  <div className="mb-4">
                    <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{info.label}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{info.description}</p>
                  </div>

                  <div className="mb-6">
                    <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">${info.monthly}</span>
                    <span className="text-sm text-gray-400">/mo</span>
                  </div>

                  <button
                    onClick={() => handleUpgrade(plan)}
                    disabled={isCurrent || checkingOut !== null}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                      isCurrent
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-default"
                        : isUpgrade
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300"
                    }`}
                  >
                    {checkingOut === plan ? "Redirecting…" :
                     isCurrent ? "Current plan" :
                     isUpgrade ? `Upgrade to ${info.label}` :
                     `Downgrade to ${info.label}`}
                  </button>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950 px-4 py-3 rounded-lg">{error}</p>
          )}

          {/* Feature comparison table */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Feature Comparison</h2>
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Feature</th>
                    {plans.map(p => (
                      <th key={p} className={`px-4 py-3 text-center text-xs font-medium ${p === currentPlan ? "text-blue-600" : "text-gray-500 dark:text-gray-400"}`}>
                        {PLAN_PRICES[p].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {PLAN_FEATURES.map(feature => (
                    <tr key={feature.label} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">{feature.label}</td>
                      <td className="px-4 py-2.5 text-center"><FeatureValue value={feature.starter} /></td>
                      <td className="px-4 py-2.5 text-center"><FeatureValue value={feature.pro} /></td>
                      <td className="px-4 py-2.5 text-center"><FeatureValue value={feature.enterprise} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Contact for enterprise */}
          <div className="text-center py-4">
            <p className="text-sm text-gray-400">
              Need a custom plan?{" "}
              <a href="mailto:sales@leaklock.io" className="text-blue-600 hover:underline">Contact sales →</a>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
