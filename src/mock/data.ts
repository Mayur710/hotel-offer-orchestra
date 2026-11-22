import type { RawSupplierHotel } from '../temporal/types';

/**
 * Static, deterministic supplier datasets.
 * Both suppliers overlap on hotel names (case-insensitively) so dedupe and
 * best-offer selection are exercised for every request.
 */
export const supplierAHotels: RawSupplierHotel[] = [
  { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
  { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
  { hotelId: 'a3', name: 'Taj Palace', price: 8200, city: 'delhi', commissionPct: 12 },
  { hotelId: 'a4', name: 'Oberoi Grand', price: 9500, city: 'delhi', commissionPct: 15 },
  { hotelId: 'a5', name: 'Leela Ambience', price: 7100, city: 'delhi', commissionPct: 14 },
  { hotelId: 'a6', name: 'ITC Maurya', price: 8800, city: 'delhi', commissionPct: 11 },
  { hotelId: 'a7', name: 'Bloomrooms', price: 3200, city: 'delhi', commissionPct: 8 },
  { hotelId: 'a8', name: 'Trident Nariman', price: 7500, city: 'mumbai', commissionPct: 12 },
  { hotelId: 'a9', name: 'Taj Mahal Tower', price: 11000, city: 'mumbai', commissionPct: 14 },
  { hotelId: 'a10', name: 'Ginger Andheri', price: 3500, city: 'mumbai', commissionPct: 9 },
];

export const supplierBHotels: RawSupplierHotel[] = [
  { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
  { hotelId: 'b2', name: 'Radison', price: 6200, city: 'delhi', commissionPct: 18 },
  { hotelId: 'b3', name: 'Taj Palace', price: 7900, city: 'delhi', commissionPct: 16 },
  { hotelId: 'b4', name: 'oberoi grand', price: 9900, city: 'delhi', commissionPct: 19 },
  { hotelId: 'b5', name: 'Hyatt Regency', price: 6500, city: 'delhi', commissionPct: 15 },
  { hotelId: 'b6', name: 'Lemon Tree', price: 4100, city: 'delhi', commissionPct: 12 },
  { hotelId: 'b7', name: 'Shangri-La', price: 7600, city: 'delhi', commissionPct: 17 },
  { hotelId: 'b8', name: 'Trident Nariman', price: 7200, city: 'mumbai', commissionPct: 16 },
  { hotelId: 'b9', name: 'St. Regis', price: 12500, city: 'mumbai', commissionPct: 18 },
  { hotelId: 'b10', name: 'Suba Palace', price: 4800, city: 'mumbai', commissionPct: 11 },
];
