export type SupplierId = 'A' | 'B';

export interface RawSupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

export interface HotelOffer {
  name: string;
  price: number;
  supplier: 'Supplier A' | 'Supplier B';
  commissionPct: number;
}

/** Temporal task queue shared by the client and the worker. */
export const TASK_QUEUE = 'hotel-offers-queue';
