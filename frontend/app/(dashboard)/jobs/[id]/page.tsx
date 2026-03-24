import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect, notFound } from 'next/navigation';
import ReconciliationCard from '@/components/ui/ReconciliationCard';
import ApproveButton from '@/components/ui/ApproveButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending_invoice:  'Pending Invoice',
  approved:         'Approved',
  discrepancy:      'Revenue Leak Detected',
  frozen:           'Frozen — Awaiting Resolution',
  parsing:          'Parsing Field Notes…',
};

const STATUS_COLOR: Record<string, string> = {
  pending_invoice: 'text-yellow-700 bg-yellow-50',
  approved:        'text-green-700 bg-green-50',
  discrepancy:     'text-red-700 bg-red-50',
  frozen:          'text-orange-700 bg-orange-50',
  parsing:         'text-blue-700 bg-blue-50',
};

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(`${apiUrl}/jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (res.status === 404) notFound();
  if (!res.ok) redirect('/jobs');

  const job = await res.json();
  const rec = job.reconciliation_results?.[0];
  const fieldNote = job.field_notes?.[0];
  const invoice = job.draft_invoices?.[0];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">Job</p>
          <h1 className="text-xl font-semibold text-gray-900 font-mono">{job.crm_job_id}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOR[job.status] ?? 'text-gray-600 bg-gray-50'}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
          {job.status === 'pending_invoice' && <ApproveButton jobId={job.id} />}
        </div>
      </div>

      {/* Revenue Leak Alert Banner */}
      {rec?.status === 'discrepancy' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">
            Revenue leak detected — ${(rec.estimated_leak_cents / 100).toFixed(2)} unbilled
          </p>
          <p className="text-xs text-red-500 mt-1">
            Invoice is held. Resolve discrepancies below before approving.
          </p>
        </div>
      )}

      {/* Three-Way Match */}
      {rec && (
        <ReconciliationCard
          status={rec.status}
          missingItems={rec.missing_items ?? []}
          extraItems={rec.extra_items ?? []}
          leakCents={rec.estimated_leak_cents ?? 0}
        />
      )}

      {/* Field Notes */}
      {fieldNote && (
        <section className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Field Notes</h2>
          {fieldNote.raw_text ? (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{fieldNote.raw_text}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No text notes recorded.</p>
          )}
          {fieldNote.parsed_items && fieldNote.parsed_items.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Parsed line items</p>
              <div className="space-y-1">
                {fieldNote.parsed_items.map((item: { item: string; qty: number; unit: string; confidence: number }, i: number) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg">
                    <span>{item.qty}× {item.item} {item.unit && `(${item.unit})`}</span>
                    <span className="text-gray-400">{Math.round(item.confidence * 100)}% conf.</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Draft Invoice */}
      {invoice?.line_items && invoice.line_items.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Draft Invoice</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Unit Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoice.line_items.map((li: { description: string; qty: number; unit_price: number }, i: number) => (
                <tr key={i}>
                  <td className="py-2 text-gray-700">{li.description}</td>
                  <td className="py-2 text-right text-gray-500">{li.qty}</td>
                  <td className="py-2 text-right text-gray-500">${li.unit_price.toFixed(2)}</td>
                  <td className="py-2 text-right font-medium text-gray-700">
                    ${(li.qty * li.unit_price).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
