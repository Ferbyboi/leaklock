export const dynamic = 'force-dynamic';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import AuditorReviewButtons from '@/components/ui/AuditorReviewButtons';
import ApproveButton from '@/components/ui/ApproveButton';
import { AuditPdfButton } from '@/components/ui/AuditPdfButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

type ReconciliationResult = {
  id: string;
  created_at: string;
  status: string;
  estimated_leak_cents: number;
  missing_items: string[];
};

type FieldEvent = {
  id: string;
  event_type: 'voice' | 'photo' | 'text' | string;
  created_at: string;
  raw_storage_url: string | null;
  transcript: string | null;
  compliance_status: string | null;
};

type Job = {
  id: string;
  crm_job_id: string;
  status: string;
  created_at: string;
  customer_name?: string;
  address?: string;
  scheduled_at?: string;
  total_amount_cents?: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending_invoice: 'Pending Invoice',
  approved:        'Approved',
  discrepancy:     'Revenue Leak Detected',
  frozen:          'Frozen — Awaiting Resolution',
  parsing:         'Parsing Field Notes…',
};

const STATUS_COLOR: Record<string, string> = {
  pending_invoice: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  approved:        'text-green-700 bg-green-50 border-green-200',
  discrepancy:     'text-red-700 bg-red-50 border-red-200',
  frozen:          'text-orange-700 bg-orange-50 border-orange-200',
  parsing:         'text-blue-700 bg-blue-50 border-blue-200',
};

const COMPLIANCE_COLOR: Record<string, string> = {
  ok:       'text-green-600 bg-green-50 border-green-200',
  warning:  'text-yellow-700 bg-yellow-50 border-yellow-200',
  violation:'text-red-700 bg-red-50 border-red-200',
};

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new Error('NEXT_PUBLIC_API_URL is not set');
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? '';

  // Fetch job detail
  const jobRes = await fetch(`${apiUrl}/jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (jobRes.status === 404) {
    return (
      <div className="max-w-4xl space-y-6">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Jobs
        </Link>
        <div className="bg-white rounded-xl border border-gray-100 py-20 text-center">
          <p className="text-sm font-medium text-gray-700">Job not found</p>
          <p className="text-xs text-gray-400 mt-1">The job you are looking for does not exist or you do not have access.</p>
          <Link
            href="/jobs"
            className="inline-block mt-4 text-xs text-blue-600 hover:underline"
          >
            Return to all jobs
          </Link>
        </div>
      </div>
    );
  }

  if (!jobRes.ok) redirect('/jobs');

  const job: Job = await jobRes.json();

  // Fetch reconciliation results — try backend first, fall back to Supabase
  let reconciliationResults: ReconciliationResult[] = [];
  try {
    const recRes = await fetch(`${apiUrl}/reconciliation/${id}/results`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (recRes.ok) {
      const recData = await recRes.json();
      reconciliationResults = Array.isArray(recData) ? recData : (recData.results ?? []);
    } else {
      throw new Error('Backend reconciliation fetch failed');
    }
  } catch {
    const { data: sbRec } = await supabase
      .from('reconciliation_results')
      .select('id, created_at, status, estimated_leak_cents, missing_items')
      .eq('job_id', id)
      .order('created_at', { ascending: false });
    reconciliationResults = (sbRec as ReconciliationResult[] | null) ?? [];
  }

  // Fetch field events from Supabase
  const { data: fieldEvents } = await supabase
    .from('field_events')
    .select('id, event_type, created_at, raw_storage_url, transcript, compliance_status')
    .eq('job_id', id)
    .order('created_at', { ascending: true });

  const events: FieldEvent[] = (fieldEvents as FieldEvent[] | null) ?? [];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Back link */}
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Jobs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Job</p>
          <h1 className="text-xl font-bold text-gray-900 font-mono">{job.crm_job_id}</h1>
          <p className="text-xs text-gray-400 mt-1">
            Created {new Date(job.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium border shrink-0 ${STATUS_COLOR[job.status] ?? 'text-gray-600 bg-gray-50 border-gray-200'}`}
        >
          {STATUS_LABEL[job.status] ?? job.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Info grid */}
      {(job.customer_name || job.address || job.scheduled_at || job.total_amount_cents != null) && (
        <section className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Job Details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {job.customer_name && (
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Customer</dt>
                <dd className="text-sm text-gray-800 font-medium">{job.customer_name}</dd>
              </div>
            )}
            {job.address && (
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Address</dt>
                <dd className="text-sm text-gray-800">{job.address}</dd>
              </div>
            )}
            {job.scheduled_at && (
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Scheduled</dt>
                <dd className="text-sm text-gray-800">
                  {new Date(job.scheduled_at).toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                  })}
                  {' '}
                  {new Date(job.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </dd>
              </div>
            )}
            {job.total_amount_cents != null && (
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Job Value</dt>
                <dd className="text-sm text-gray-800 font-semibold">
                  ${(job.total_amount_cents / 100).toFixed(2)}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Revenue Leak Section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Revenue Reconciliation</h2>

        {reconciliationResults.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-10 text-center">
            <p className="text-sm text-gray-400">No reconciliation results yet.</p>
            <p className="text-xs text-gray-300 mt-1">Results will appear once field data has been parsed.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reconciliationResults.map((result) => {
              const isAlert = result.status === 'discrepancy' || result.status === 'frozen';
              return (
                <div
                  key={result.id}
                  className={`rounded-xl border p-5 space-y-4 ${
                    isAlert ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'
                  }`}
                >
                  {/* Result header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {isAlert && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                            REVENUE LEAK ALERT
                          </span>
                        )}
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[result.status] ?? 'text-gray-600 bg-gray-50 border-gray-200'}`}>
                          {STATUS_LABEL[result.status] ?? result.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Detected {new Date(result.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' at '}
                        {new Date(result.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    {result.estimated_leak_cents > 0 && (
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-500 mb-0.5">Estimated leak</p>
                        <p className="text-lg font-bold text-red-600">
                          ${(result.estimated_leak_cents / 100).toFixed(2)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Missing items */}
                  {result.missing_items && result.missing_items.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">
                        Missing from invoice ({result.missing_items.length} item{result.missing_items.length !== 1 ? 's' : ''})
                      </p>
                      <ul className="space-y-1">
                        {result.missing_items.map((item, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs bg-white/70 rounded-lg px-3 py-1.5 border border-red-100">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                            <span className="text-gray-700">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Auditor review buttons */}
                  <div className="pt-1 border-t border-red-100/70">
                    <p className="text-xs text-gray-400 mb-2">Auditor actions</p>
                    <AuditorReviewButtons jobId={job.id} resultId={result.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Field Evidence Section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Field Evidence</h2>

        {events.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 py-10 text-center">
            <p className="text-sm text-gray-400">No field events recorded yet.</p>
            <p className="text-xs text-gray-300 mt-1">
              Capture photos, voice notes, or text from the field to populate this section.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {events.map((event) => (
              <div key={event.id} className="p-4 flex gap-4">
                {/* Event type icon */}
                <div className="shrink-0 h-8 w-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center">
                  {event.event_type === 'voice' && (
                    <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                  {event.event_type === 'photo' && (
                    <svg className="h-4 w-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                  {event.event_type === 'text' && (
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  {!['voice', 'photo', 'text'].includes(event.event_type) && (
                    <svg className="h-4 w-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>

                {/* Event content */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 capitalize">{event.event_type}</span>
                      {event.compliance_status && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${COMPLIANCE_COLOR[event.compliance_status] ?? 'text-gray-500 bg-gray-50 border-gray-100'}`}>
                          {event.compliance_status}
                        </span>
                      )}
                    </div>
                    <time className="text-xs text-gray-400 shrink-0">
                      {new Date(event.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(event.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </time>
                  </div>

                  {/* Photo thumbnail */}
                  {event.event_type === 'photo' && event.raw_storage_url && (
                    <a
                      href={event.raw_storage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-fit"
                    >
                      <Image
                        src={event.raw_storage_url}
                        alt="Field photo"
                        width={160}
                        height={120}
                        className="rounded-lg border border-gray-100 object-cover hover:opacity-90 transition-opacity"
                      />
                    </a>
                  )}

                  {/* Voice transcript */}
                  {event.event_type === 'voice' && (
                    event.transcript ? (
                      <p className="text-sm text-gray-600 leading-relaxed">{event.transcript}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">Transcription pending…</p>
                    )
                  )}

                  {/* Text note */}
                  {event.event_type === 'text' && event.transcript && (
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{event.transcript}</p>
                  )}

                  {/* Photo — show transcript/OCR if available */}
                  {event.event_type === 'photo' && event.transcript && (
                    <p className="text-xs text-gray-500 italic mt-1">OCR: {event.transcript}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Actions */}
      <section className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {job.status === 'pending_invoice' && (
            <ApproveButton jobId={job.id} />
          )}
          <Link
            href={`/field?job=${job.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Capture Field Data
          </Link>
          <AuditPdfButton jobId={job.id} crmJobId={job.crm_job_id} />
        </div>
      </section>
    </div>
  );
}
