import type { HotelOffer, RawSupplierHotel, SupplierId } from '../types';

const SUPPLIER_LABELS: Record<SupplierId, HotelOffer['supplier']> = {
  A: 'Supplier A',
  B: 'Supplier B',
};

function toOffer(hotel: RawSupplierHotel, supplier: SupplierId): HotelOffer {
  return {
    name: hotel.name.trim(),
    price: hotel.price,
    supplier: SUPPLIER_LABELS[supplier],
    commissionPct: hotel.commissionPct,
  };
}

/** True when `candidate` must replace `current` for the same canonical hotel name. */
function isBetterOffer(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) {
    return candidate.price < current.price;
  }
  if (candidate.commissionPct !== current.commissionPct) {
    return candidate.commissionPct < current.commissionPct;
  }
  return candidate.supplier === 'Supplier A' && current.supplier === 'Supplier B';
}

/**
 * Pure, deterministic dedupe executed directly inside the workflow:
 * 1. Canonical key = name.trim().toLowerCase().
 * 2. Cheaper price wins; equal price -> lower commissionPct; still tied -> Supplier A.
 * 3. Sorted ascending by price, ties alphabetical by name (code-unit order,
 *    never locale-dependent, to keep replay deterministic).
 */
export function dedupeAndSelectBestOffers(
  supplierA: RawSupplierHotel[],
  supplierB: RawSupplierHotel[],
): HotelOffer[] {
  const bestByKey = new Map<string, HotelOffer>();

  const consider = (hotel: RawSupplierHotel, supplier: SupplierId): void => {
    const offer = toOffer(hotel, supplier);
    const key = offer.name.toLowerCase();
    const current = bestByKey.get(key);
    if (current === undefined || isBetterOffer(offer, current)) {
      bestByKey.set(key, offer);
    }
  };

  for (const hotel of supplierA) {
    consider(hotel, 'A');
  }
  for (const hotel of supplierB) {
    consider(hotel, 'B');
  }

  const offers = Array.from(bestByKey.values());
  offers.sort((a, b) => {
    if (a.price !== b.price) {
      return a.price - b.price;
    }
    if (a.name === b.name) {
      return 0;
    }
    return a.name < b.name ? -1 : 1;
  });
  return offers;
}
