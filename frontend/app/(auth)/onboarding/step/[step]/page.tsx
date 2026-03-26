'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { NICHE_LABELS, type NicheType } from '@/lib/design-tokens';

// ── Types ────────────────────────────────────────────────────────────────────

type ValidStep = 1 | 2 | 3 | 4 | 5;

const VALID_STEPS: ValidStep[] = [1, 2, 3, 4, 5];

// ── Plan data (aligned with billing.py PLAN_PRICES) ──────────────────────────

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$49',
    period: '/mo',
    seats: '2 tech seats',
    features: [
      '2 tech seats',
      '3-way match engine',
      'Email alerts',
      'PDF reports',
      '50 jobs/month',
    ],
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$99',
    period: '/mo',
    seats: '5 tech seats',
    features: [
      '5 tech seats',
      'Slack + SMS alerts',
      'Auditor dashboard',
      'PostHog analytics',
      '250 jobs/month',
    ],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$199',
    period: '/mo',
    seats: 'Unlimited seats',
    features: [
      'Unlimited seats',
      'Custom CRM integrations',
      'Priority support',
      'SLA guarantee',
      'Unlimited jobs',
    ],
    popular: false,
  },
];

// ── Niche options ─────────────────────────────────────────────────────────────

const NICHE_OPTIONS: { type: NicheType; icon: string; desc: string }[] = [
  { type: 'restaurant',   icon: '🍽️', desc: 'Restaurants, cafes, food service'       },
  { type: 'plumbing',     icon: '💧', desc: 'Plumbing, pipes, water systems'          },
  { type: 'hvac',         icon: '❄️', desc: 'HVAC, refrigeration, EPA 608'            },
  { type: 'tree_service', icon: '🌳', desc: 'Tree trimming, removal, OSHA safety'     },
  { type: 'landscaping',  icon: '🌿', desc: 'Lawn care, chemical application, EPA'    },
  { type: 'barber',       icon: '✂️', desc: 'Barber shops, salons, state board'       },
];

// ── Tour steps for Step 5 ─────────────────────────────────────────────────────

const TOUR_TIPS = [
  {
    id: 'sidebar',
    title: 'Sidebar Navigation',
    body: 'Use the sidebar to switch between Jobs, Reports, and Settings.',
    icon: '🗂️',
  },
  {
    id: 'bento',
    title: 'Dashboard Overview',
    body: 'The BentoGrid shows live revenue recovery metrics and recent alerts.',
    icon: '📊',
  },
  {
    id: 'capture',
    title: 'Field Capture',
    body: 'Tap the capture button to upload photos or voice notes from the field.',
    icon: '📸',
  },
];

// ── Shared API helper ─────────────────────────────────────────────────────────

async function apiPost(path: string, body: object, accessToken: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? 'Request failed');
  }
  return res.json();
}

// ── PostHog event helper ──────────────────────────────────────────────────────

function trackStep(step: number) {
  if (typeof window !== 'undefined' && (window as unknown as { posthog?: { capture: (e: string, p: object) => void } }).posthog) {
    (window as unknown as { posthog: { capture: (e: string, p: object) => void } }).posthog.capture(
      'onboarding_step_completed',
      { step },
    );
  }
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="flex gap-1.5 mb-8" aria-label={`Step ${current} of 5`}>
      {([1, 2, 3, 4, 5] as ValidStep[]).map((s) => (
        <div
          key={s}
          className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${
            s <= current ? 'bg-blue-600' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

// ── Step 1: Business type ─────────────────────────────────────────────────────

function Step1({
  onComplete,
}: {
  onComplete: (nicheType: NicheType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {NICHE_OPTIONS.map(({ type, icon, desc }) => (
        <button
          key={type}
          onClick={() => onComplete(type)}
          className="flex flex-col items-start gap-1.5 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 active:scale-95 transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span className="text-2xl" aria-hidden="true">{icon}</span>
          <span className="font-semibold text-sm text-gray-900">{NICHE_LABELS[type]}</span>
          <span className="text-xs text-gray-500 leading-snug">{desc}</span>
        </button>
      ))}
    </div>
  );
}

// ── Step 2: First location ────────────────────────────────────────────────────

function Step2({
  nicheType,
  onComplete,
}: {
  nicheType: NicheType | null;
  onComplete: () => void;
}) {
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired — please log in again');
      await apiPost('/onboard', {
        tenant_type: nicheType,
        location_name: locationName,
        location_address: locationAddress,
      }, session.access_token);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="loc-name" className="block text-sm font-medium text-gray-700 mb-1">
          Location name <span className="text-red-500">*</span>
        </label>
        <input
          id="loc-name"
          required
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          placeholder="Downtown Location"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="loc-addr" className="block text-sm font-medium text-gray-700 mb-1">
          Address
        </label>
        <input
          id="loc-addr"
          value={locationAddress}
          onChange={(e) => setLocationAddress(e.target.value)}
          placeholder="123 Main St, Chicago, IL"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}

// ── Step 3: Add team ──────────────────────────────────────────────────────────

function Step3({ onComplete }: { onComplete: () => void }) {
  const [input, setInput] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function handleAdd() {
    const phones = input
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!phones.length) return;

    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');
      for (const phone of phones) {
        await apiPost('/team/invite', { phone, role: 'tech' }, session.access_token);
      }
      setAdded((prev) => [...prev, ...phones]);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleAdd();
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Enter tech phone numbers (comma-separated). They&apos;ll receive an SMS magic-link
        to join your team.
      </p>

      <div className="flex gap-2">
        <input
          type="tel"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="+1 (312) 555-0100, +1 (312) 555-0101"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '…' : 'Add'}
        </button>
      </div>

      {added.length > 0 && (
        <ul className="space-y-1">
          {added.map((phone) => (
            <li
              key={phone}
              className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg"
            >
              <span className="text-green-600 font-medium">✓</span>
              {phone}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onComplete}
          className="flex-1 py-2.5 px-4 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Skip for now
        </button>
        {added.length > 0 && (
          <button
            type="button"
            onClick={onComplete}
            className="flex-1 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Choose plan ───────────────────────────────────────────────────────

function Step4({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function handlePlanSelect(planId: string) {
    setLoading(planId);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');

      // Call Next.js API route which proxies to the FastAPI backend
      const res = await fetch(`/api/billing/checkout/${planId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? 'Checkout failed');
      }
      const { checkout_url } = await res.json();
      if (checkout_url) {
        window.location.href = checkout_url;
      } else {
        // If embedded mode returns client_secret instead, navigate to success
        onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {PLANS.map((plan) => (
        <button
          key={plan.id}
          onClick={() => handlePlanSelect(plan.id)}
          disabled={loading !== null}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            plan.popular
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 text-sm">{plan.name}</span>
              {plan.popular && (
                <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">
                  Most Popular
                </span>
              )}
            </div>
            <span className="font-bold text-blue-600">
              {plan.price}
              <span className="text-gray-400 text-xs font-normal">{plan.period}</span>
            </span>
          </div>
          <ul className="mt-2 space-y-0.5">
            {plan.features.map((f) => (
              <li key={f} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="text-green-500 font-bold">✓</span>
                {f}
              </li>
            ))}
          </ul>
          {loading === plan.id && (
            <p className="mt-2 text-xs text-blue-600 font-medium">Redirecting to checkout…</p>
          )}
        </button>
      ))}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Step 5: Success + guided tour ─────────────────────────────────────────────

function Step5() {
  const [tourStep, setTourStep] = useState(0);
  const [tourDone, setTourDone] = useState(false);
  const router = useRouter();

  function nextTour() {
    if (tourStep < TOUR_TIPS.length - 1) {
      setTourStep((s) => s + 1);
    } else {
      setTourDone(true);
    }
  }

  const tip = TOUR_TIPS[tourStep];

  if (!tip) return null;

  return (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-900">You&apos;re all set!</h2>
        <p className="text-sm text-gray-500 mt-1">
          LeakLock is now protecting your revenue. Let&apos;s take a quick tour.
        </p>
      </div>

      {!tourDone ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-left">
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden="true">{tip.icon}</span>
            <div className="flex-1">
              <p className="font-semibold text-sm text-gray-900">{tip.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{tip.body}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-1">
              {TOUR_TIPS.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i === tourStep ? 'bg-blue-600' : 'bg-blue-200'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={nextTour}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              {tourStep < TOUR_TIPS.length - 1 ? 'Next tip →' : 'Got it!'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm text-green-700 font-medium">
            Tour complete! You know the essentials.
          </p>
        </div>
      )}

      <button
        onClick={() => router.push('/jobs')}
        className="w-full py-2.5 px-4 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

const STEP_TITLES: Record<ValidStep, string> = {
  1: 'What type of business?',
  2: 'Name your first location',
  3: 'Add your team',
  4: 'Choose your plan',
  5: "You're all set!",
};

export default function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step: stepParam } = use(params);
  const router = useRouter();

  const stepNum = parseInt(stepParam, 10);
  const currentStep: ValidStep = (
    VALID_STEPS.includes(stepNum as ValidStep) ? stepNum : 1
  ) as ValidStep;

  const [nicheType, setNicheType] = useState<NicheType | null>(null);

  function goTo(next: number) {
    trackStep(currentStep);
    router.push(`/onboarding/step/${next}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <ProgressBar current={currentStep} />

        <h1 className="text-xl font-bold text-gray-900 mb-6">
          {STEP_TITLES[currentStep]}
        </h1>

        {currentStep === 1 && (
          <Step1
            onComplete={(niche) => {
              setNicheType(niche);
              goTo(2);
            }}
          />
        )}

        {currentStep === 2 && (
          <Step2
            nicheType={nicheType}
            onComplete={() => goTo(3)}
          />
        )}

        {currentStep === 3 && (
          <Step3 onComplete={() => goTo(4)} />
        )}

        {currentStep === 4 && (
          <Step4 onComplete={() => goTo(5)} />
        )}

        {currentStep === 5 && <Step5 />}
      </div>
    </div>
  );
}
