import { client } from '../index';
import { eventTrigger } from '@trigger.dev/sdk';
import { z } from 'zod';
import type { JobCompletedPayload } from '../job-completed';

// ServiceTitan webhook payload schema
// Ref: https://developer.servicetitan.io/apis/webhooks
const ServiceTitanWebhookPayload = z.object({
  eventId:   z.string(),
  eventType: z.string(),  // e.g. "JobComplete"
  tenantId:  z.string().uuid(),
  data: z.object({
    job: z.object({
      id:             z.number(),
      customerId:     z.number(),
      customerName:   z.string(),
      technicianNotes: z.string().optional(),
      attachments:    z.array(z.object({ url: z.string() })).optional(),
      invoice: z.object({
        items: z.array(z.object({
          description: z.string(),
          qty:         z.number(),
          unitPrice:   z.number(),
        })).optional(),
      }).optional(),
    }),
  }),
});

client.defineJob({
  id:      'servicetitan-webhook-normalizer',
  name:    'Normalise ServiceTitan Webhook → job.completed',
  version: '1.0.0',
  trigger: eventTrigger({ name: 'webhook.servicetitan' }),

  run: async (payload, io) => {
    const data = ServiceTitanWebhookPayload.parse(payload);

    // Only process job completion events
    if (!data.eventType.toLowerCase().includes('jobcomplete')) {
      await io.logger.info('Ignoring non-completion event', { eventType: data.eventType });
      return { skipped: true };
    }

    const job = data.data.job;

    const normalized: JobCompletedPayload = {
      crm_job_id:  String(job.id),
      tenant_id:   data.tenantId,
      client_name: job.customerName,
      tech_notes:  job.technicianNotes,
      photo_urls:  job.attachments?.map((a) => a.url),
      draft_invoice: job.invoice?.items
        ? {
            line_items: job.invoice.items.map((item) => ({
              description: item.description,
              qty:         item.qty,
              unit_price:  item.unitPrice,
            })),
          }
        : undefined,
    };

    await io.sendEvent('forward-to-ingestion', {
      name:    'job.completed',
      payload: normalized,
    });

    return { forwarded: true, crm_job_id: normalized.crm_job_id };
  },
});
