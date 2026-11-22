import { Router } from 'express';
import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import pino from 'pino';
import { queryCityOffers } from '../redis/hotelStore';
import { executeHotelOfferWorkflow } from '../temporal/client/temporalClient';
import { parseHotelQuery } from './validation';

const router = Router();
const logger = pino({ name: 'hotel-api', level: process.env.LOG_LEVEL?.trim() || 'info' });

function isAllSuppliersFailedError(err: unknown): boolean {
  return (
    err instanceof WorkflowFailedError &&
    err.cause instanceof ApplicationFailure &&
    err.cause.nonRetryable === true &&
    err.cause.message === 'All hotel suppliers failed'
  );
}

router.get('/hotels', async (req, res) => {
  const parsed = parseHotelQuery(req.query);
  if (!parsed.ok) {
    logger.warn({ query: req.query, error: parsed.error }, 'Rejected invalid /api/hotels query');
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { city, minPrice, maxPrice } = parsed.value;
  try {
    // Wait for the workflow, then always read the response through Redis
    // (ZRANGEBYSCORE) so every request exercises the price index.
    await executeHotelOfferWorkflow(city);
    const offers = await queryCityOffers(city, minPrice, maxPrice);
    logger.info({ city, minPrice, maxPrice, count: offers.length }, 'Served /api/hotels');
    res.status(200).json(offers);
  } catch (err) {
    if (isAllSuppliersFailedError(err)) {
      logger.error({ city, err }, 'All hotel suppliers failed');
      res.status(502).json({ error: 'All hotel suppliers failed to respond.' });
      return;
    }
    logger.error({ city, err }, 'Failed to execute hotel offer workflow');
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
