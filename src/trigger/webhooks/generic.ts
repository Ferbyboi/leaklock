import { client } from '../index';
import { eventTrigger } from '@trigger.dev/sdk';
import { z } from 'zod';

// Generic / manual webhook — matches JobCompletedPayload directly
const GenericPayload = z.object({
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

client.defineJob({
  id:      'generic-webhook-forwarder',
  name:    'Generic Webhook → job.completed',
  version: '1.0.0',
  trigger: eventTrigger({ name: 'webhook.generic' }),

  run: async (payload, io) => {
    const data = GenericPayload.parse(payload);

    await io.sendEvent('forward-to-ingestion', {
      name:    'job.completed',
      payload: data,
    });

    return { forwarded: true, crm_job_id: data.crm_job_id };
  },
});
