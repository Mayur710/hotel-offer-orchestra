import type { HotelOffer } from '../temporal/types';
import redis from './client';

const TTL_SECONDS = 300;

interface CityKeys {
  pricesKey: string;
  detailsKey: string;
}

function cityKeys(city: string): CityKeys {
  const c = city.trim().toLowerCase();
  return {
    pricesKey: `hotels:city:${c}:prices`,
    detailsKey: `hotels:city:${c}:details`,
  };
}

/**
 * Atomically replaces the city's price ZSET and details HASH inside a single
 * MULTI/EXEC transaction. DEL clears stale offers (supplier outage, empty city).
 */
export async function saveCityOffers(city: string, offers: HotelOffer[]): Promise<void> {
  const { pricesKey, detailsKey } = cityKeys(city);
  const multi = redis.multi().del(pricesKey, detailsKey);

  if (offers.length > 0) {
    const priceArgs: Array<string | number> = [];
    const detailArgs: string[] = [];
    for (const offer of offers) {
      const member = offer.name.trim().toLowerCase();
      priceArgs.push(offer.price, member);
      detailArgs.push(member, JSON.stringify(offer));
    }
    multi.zadd(pricesKey, ...priceArgs);
    multi.hset(detailsKey, ...detailArgs);
    multi.expire(pricesKey, TTL_SECONDS);
    multi.expire(detailsKey, TTL_SECONDS);
  }

  await multi.exec();
}

/**
 * Reads price-filtered offers straight from Redis:
 * ZRANGEBYSCORE (price range) + HMGET (details), sorted ascending by price.
 */
export async function queryCityOffers(
  city: string,
  minPrice?: number,
  maxPrice?: number,
): Promise<HotelOffer[]> {
  const { pricesKey, detailsKey } = cityKeys(city);
  const min = minPrice !== undefined ? String(minPrice) : '-inf';
  const max = maxPrice !== undefined ? String(maxPrice) : '+inf';

  const members = await redis.zrangebyscore(pricesKey, min, max);
  if (members.length === 0) {
    return [];
  }

  const raw = await redis.hmget(detailsKey, ...members);
  const offers: HotelOffer[] = [];
  for (const entry of raw) {
    if (entry !== null) {
      offers.push(JSON.parse(entry) as HotelOffer);
    }
  }
  return offers;
}
