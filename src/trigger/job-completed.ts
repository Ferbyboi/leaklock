import { client } from './index';
import { eventTrigger } from '@trigger.dev/sdk';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const JobCompletedPayload = z.object({
  crm_job_id:    z.string(),
  tenant_id:     z.string().uuid(),
  client_name:   z.string(),
  tech_notes:    z.string().optional(),
  photo_urls:    z.array(z.string()).optional(),
  draft_invoice: z.object({
    line_items: z.array(z.object({
      description: z.string(),
      qty:         z.number(),
      unit_price:  z.number(),
    }))
  }).optional(),
});

export type JobCompletedPayload = z.infer<typeof JobCompletedPayload>;

client.defineJob({
  id:      'job-completed-ingestion',
  name:    'Ingest Completed Job for Reconciliation',
  version: '1.0.0',
  trigger: eventTrigger({ name: 'job.completed' }),

  run: async (payload, io) => {
    const data = JobCompletedPayload.parse(payload);

    // 1. Upsert job record
    const { data: job, error: jobError } = await io.runTask(
      'upsert-job',
      async () => supabase
        .from('jobs')
        .upsert({ crm_job_id: data.crm_job_id, tenant_id: data.tenant_id, status: 'pending_invoice', match_status: 'pending' })
        .select()
        .single()
    );
    if (jobError) throw new Error(`Failed to upsert job: ${jobError.message}`);

    // 2. Store field notes
    const { error: notesError } = await io.runTask(
      'store-field-notes',
      async () => supabase.from('field_notes').insert({
        job_id:       job.id,
        tenant_id:    data.tenant_id,
        raw_text:     data.tech_notes ?? null,
        photo_urls:   data.photo_urls ?? null,
        parse_status: 'pending',
      })
    );
    if (notesError) throw new Error(`Failed to store field notes: ${notesError.message}`);

    // 3. Store draft invoice if provided
    if (data.draft_invoice) {
      const { error: invError } = await io.runTask(
        'store-draft-invoice',
        async () => supabase.from('draft_invoices').insert({
          job_id:     job.id,
          tenant_id:  data.tenant_id,
          line_items: data.draft_invoice!.line_items,
        })
      );
      if (invError) throw new Error(`Failed to store draft invoice: ${invError.message}`);
    }

    // 4. Fire event to trigger Celery AI parsing worker
    await io.sendEvent('trigger-parse', {
      name:    'field_notes.parse',
      payload: { job_id: job.id, tenant_id: data.tenant_id },
    });

    await io.logger.info('Job ingested successfully', { job_id: job.id, tenant_id: data.tenant_id });

    return { job_id: job.id, status: 'queued' };
  },
});
