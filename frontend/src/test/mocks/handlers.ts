import { http, HttpResponse } from 'msw'

const mockJobs = [
  {
    id: 'job-001',
    tenant_id: 'tenant-abc',
    title: 'Leak inspection - Unit 4B',
    status: 'pending',
    niche_type: 'plumbing',
    created_at: '2026-03-20T10:00:00Z',
    invoice_total: 350,
    quote_total: 300,
  },
  {
    id: 'job-002',
    tenant_id: 'tenant-abc',
    title: 'HVAC annual service',
    status: 'reconciled',
    niche_type: 'hvac',
    created_at: '2026-03-21T09:00:00Z',
    invoice_total: 1200,
    quote_total: 1200,
  },
]

const mockReconciliationResult = {
  id: 'result-001',
  job_id: 'job-001',
  status: 'REVENUE_LEAK_ALERT',
  matched_items: [
    { item: 'Valve replacement', in_quote: true, in_invoice: true },
  ],
  leaked_items: [
    { item: 'Pipe sealant applied', in_quote: false, in_invoice: false },
  ],
  total_leaked: 50,
  created_at: '2026-03-20T12:00:00Z',
}

export const handlers = [
  // GET /api/jobs - list all jobs
  http.get('/api/jobs', () => {
    return HttpResponse.json(mockJobs)
  }),

  // GET /api/jobs/:id - single job
  http.get('/api/jobs/:id', ({ params }) => {
    const job = mockJobs.find((j) => j.id === params.id)
    if (!job) {
      return HttpResponse.json({ detail: 'Job not found' }, { status: 404 })
    }
    return HttpResponse.json(job)
  }),

  // POST /api/jobs/:id/reconciliation - trigger reconciliation
  http.post('/api/jobs/:id/reconciliation', ({ params }) => {
    return HttpResponse.json(
      { ...mockReconciliationResult, job_id: params.id as string },
      { status: 201 }
    )
  }),

  // GET /api/jobs/:id/reconciliation/:resultId - get reconciliation result
  http.get('/api/jobs/:id/reconciliation/:resultId', () => {
    return HttpResponse.json(mockReconciliationResult)
  }),

  // POST /api/jobs/:id/approve
  http.post('/api/jobs/:id/approve', () => {
    return HttpResponse.json({ success: true }, { status: 200 })
  }),
]
