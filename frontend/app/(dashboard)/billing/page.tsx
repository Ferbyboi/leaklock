import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import BillingActions from '@/components/ui/BillingActions';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$49',
    period: '/mo',
    jobs: '50 jobs/month',
    features: ['3-way match engine', 'Email alerts', 'Jobber + ServiceTitan webhooks'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$149',
    period: '/mo',
    jobs: '250 jobs/month',
    features: ['Everything in Starter', 'Slack + SMS alerts', 'Auditor dashboard', 'PostHog analytics'],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$399',
    period: '/mo',
    jobs: 'Unlimited jobs',
    features: ['Everything in Growth', 'Custom CRM integrations', 'Priority support', 'SLA guarantee'],
  },
];

export default async function BillingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-400 mt-1">Choose the plan that fits your business</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl border p-6 flex flex-col ${
              plan.popular ? 'border-blue-200 shadow-sm' : 'border-gray-100'
            }`}
          >
            {plan.popular && (
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full self-start mb-3">
                Most Popular
              </span>
            )}
            <h2 className="text-base font-semibold text-gray-900">{plan.name}</h2>
            <div className="mt-2 mb-4">
              <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
              <span className="text-gray-400 text-sm">{plan.period}</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">{plan.jobs}</p>
            <ul className="space-y-2 flex-1 mb-6">
              {plan.features.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-600">
                  <span className="text-green-500">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <BillingActions planId={plan.id} />
          </div>
        ))}
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-100 p-5">
        <p className="text-sm font-medium text-gray-700 mb-1">Already subscribed?</p>
        <p className="text-xs text-gray-400 mb-3">Manage your subscription, invoices, and payment method.</p>
        <BillingActions planId="portal" />
      </div>
    </div>
  );
}
