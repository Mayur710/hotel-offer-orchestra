import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { env } from '../../config/env';
import type { HotelOffer } from '../types';
import { TASK_QUEUE } from '../types';
import { hotelOfferAggregationWorkflow } from '../workflows/hotelOfferWorkflow';

let clientPromise: Promise<Client> | undefined;

/** Lazy singleton Temporal client; connects on first use. */
function getTemporalClient(): Promise<Client> {
  if (clientPromise === undefined) {
    clientPromise = Connection.connect({ address: env.temporalAddress }).then(
      (connection) => new Client({ connection }),
    );
  }
  return clientPromise;
}

/**
 * Starts one workflow execution per request. The unique workflow ID avoids
 * WorkflowExecutionAlreadyStarted collisions for concurrent same-city requests.
 */
export async function executeHotelOfferWorkflow(city: string): Promise<HotelOffer[]> {
  const client = await getTemporalClient();
  const normalizedCity = city.trim().toLowerCase();
  const handle = await client.workflow.start(hotelOfferAggregationWorkflow, {
    args: [normalizedCity],
    taskQueue: TASK_QUEUE,
    workflowId: `hotel-offers-${normalizedCity}-${randomUUID()}`,
  });
  return handle.result();
}
