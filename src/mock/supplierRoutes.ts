import { Router } from 'express';
import { env } from '../config/env';
import type { RawSupplierHotel } from '../temporal/types';
import { supplierAHotels, supplierBHotels } from './data';

const router = Router();

function filterByCity(hotels: RawSupplierHotel[], city: unknown): RawSupplierHotel[] {
  if (typeof city !== 'string') {
    return hotels;
  }
  const normalized = city.trim().toLowerCase();
  return hotels.filter((hotel) => hotel.city.trim().toLowerCase() === normalized);
}

router.get('/supplierA/hotels', (req, res) => {
  if (env.supplierADown) {
    res.status(503).json({ error: 'Supplier A is currently unavailable' });
    return;
  }
  res.status(200).json(filterByCity(supplierAHotels, req.query.city));
});

router.get('/supplierB/hotels', (req, res) => {
  if (env.supplierBDown) {
    res.status(503).json({ error: 'Supplier B is currently unavailable' });
    return;
  }
  res.status(200).json(filterByCity(supplierBHotels, req.query.city));
});

export default router;
