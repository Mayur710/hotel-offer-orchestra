import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import type * as hotelActivities from '../activities/hotelActivities';
import type { HotelOffer, RawSupplierHotel } from '../types';
import { dedupeAndSelectBestOffers } from './dedupe';

const { fetchSupplier, saveToRedis } = proxyActivities<typeof hotelActivities>({
  startToCloseTimeout: '5s',
  retry: {
    initialInterval: '500ms',
    backoffCoefficient: 2,
    maximumInterval: '2s',
    maximumAttempts: 3,
  },
});

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Aggregates hotel offers for a city:
 * - calls Supplier A and Supplier B in parallel,
 * - degrades gracefully when a single supplier fails,
 * - fails non-retryably when both suppliers fail,
 * - dedupes deterministically, saves to Redis, returns the offers.
 * No I/O, Date.now or Math.random here: workflow code must stay deterministic.
 */
export async function hotelOfferAggregationWorkflow(city: string): Promise<HotelOffer[]> {
  const [supplierA, supplierB] = await Promise.allSettled([
    fetchSupplier('A', city),
    fetchSupplier('B', city),
  ]);

  if (supplierA.status === 'rejected' && supplierB.status === 'rejected') {
    throw ApplicationFailure.nonRetryable('All hotel suppliers failed');
  }

  let rawA: RawSupplierHotel[] = [];
  let rawB: RawSupplierHotel[] = [];

  if (supplierA.status === 'fulfilled') {
    rawA = supplierA.value;
  } else {
    log.warn('Supplier A failed; continuing with Supplier B offers only', {
      city,
      reason: errorMessage(supplierA.reason),
    });
  }

  if (supplierB.status === 'fulfilled') {
    rawB = supplierB.value;
  } else {
    log.warn('Supplier B failed; continuing with Supplier A offers only', {
      city,
      reason: errorMessage(supplierB.reason),
    });
  }

  const offers = dedupeAndSelectBestOffers(rawA, rawB);
  await saveToRedis(city, offers);
  return offers;
}
