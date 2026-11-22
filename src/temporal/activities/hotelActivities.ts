import pino from 'pino';
import { env } from '../../config/env';
import { saveCityOffers } from '../../redis/hotelStore';
import type { HotelOffer, RawSupplierHotel, SupplierId } from '../types';

const logger = pino({ name: 'hotel-activities', level: env.logLevel });

/**
 * Fetches one supplier's hotel list for a city.
 * Throws on non-2xx responses (including 503) so Temporal applies its
 * retry policy before the workflow sees the failure.
 */
export async function fetchSupplier(
  supplier: SupplierId,
  city: string,
): Promise<RawSupplierHotel[]> {
  const url = `${env.supplierBaseUrl}/supplier${supplier}/hotels?city=${encodeURIComponent(city)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`Supplier ${supplier} request failed with HTTP ${response.status}`);
  }
  const hotels = (await response.json()) as RawSupplierHotel[];
  logger.info({ supplier, city, count: hotels.length }, 'Fetched supplier hotels');
  return hotels;
}

/** Persists the deduplicated offers for a city (atomic ZSET + HASH replace). */
export async function saveToRedis(city: string, offers: HotelOffer[]): Promise<void> {
  await saveCityOffers(city, offers);
  logger.info({ city, count: offers.length }, 'Saved offers to Redis');
}
