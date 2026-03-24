import { client } from '../index';
import { eventTrigger } from '@trigger.dev/sdk';
import { z } from 'zod';
import type { JobCompletedPayload } from '../job-completed';

// Jobber webhook → normalise to internal JobCompletedPayload schema
const JobberWebhookPayload = z.object({
  data: z.object({
    webHookEvent: z.object({
      itemId:    z.string(),
      jobStatus: z.string(),
    }),
    job: z.object({
      id:          z.string(),
      client:      z.object({ name: z.string() }),
      fieldNotes:  z.string().optional(),
      photoUrls:   z.array(z.string()).optional(),
    }),
  }),
  tenantId: z.string().uuid(),
});

client.defineJob({
  id:      'jobber-webhook-normalizer',
  name:    'Normalise Jobber Webhook → job.completed',
  version: '1.0.0',
  trigger: eventTrigger({ name: 'webhook.jobber' }),

  run: async (payload, io) => {
    const data = JobberWebhookPayload.parse(payload);

    if (data.data.webHookEvent.jobStatus !== 'completed') {
      await io.logger.info('Ignoring non-completed job status', {
        status: data.data.webHookEvent.jobStatus,
      });
      return { skipped: true };
    }

    const normalized: JobCompletedPayload = {
      crm_job_id:  data.data.job.id,
      tenant_id:   data.tenantId,
      client_name: data.data.job.client.name,
      tech_notes:  data.data.job.fieldNotes,
      photo_urls:  data.data.job.photoUrls,
    };

    await io.sendEvent('forward-to-ingestion', {
      name:    'job.completed',
      payload: normalized,
    });

    return { forwarded: true, crm_job_id: data.data.job.id };
  },
});
