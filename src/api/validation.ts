export interface HotelQuery {
  city: string;
  minPrice?: number;
  maxPrice?: number;
}

export type ValidationResult =
  | { ok: true; value: HotelQuery }
  | { ok: false; error: string };

type PriceResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

function parsePriceParam(raw: unknown, name: 'minPrice' | 'maxPrice'): PriceResult {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  const error = {
    ok: false as const,
    error: `Query parameter '${name}' must be a non-negative number.`,
  };
  if (typeof raw !== 'string') {
    return error;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return error;
  }
  const value = Number(trimmed);
  if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
    return error;
  }
  return { ok: true, value };
}

/**
 * Validates and normalizes /api/hotels query params synchronously, before any
 * Temporal workflow is started.
 */
export function parseHotelQuery(query: Record<string, unknown>): ValidationResult {
  const rawCity = query.city;
  if (typeof rawCity !== 'string' || rawCity.trim() === '') {
    return {
      ok: false,
      error: "Query parameter 'city' is required and must be a non-empty string.",
    };
  }

  const min = parsePriceParam(query.minPrice, 'minPrice');
  if (!min.ok) {
    return min;
  }
  const max = parsePriceParam(query.maxPrice, 'maxPrice');
  if (!max.ok) {
    return max;
  }
  if (min.value !== undefined && max.value !== undefined && min.value > max.value) {
    return { ok: false, error: "'minPrice' cannot be greater than 'maxPrice'." };
  }

  return {
    ok: true,
    value: {
      city: rawCity.trim().toLowerCase(),
      minPrice: min.value,
      maxPrice: max.value,
    },
  };
}
