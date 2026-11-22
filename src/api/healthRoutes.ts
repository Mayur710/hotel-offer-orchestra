import { Router } from 'express';
import pino from 'pino';
import { env } from '../config/env';
import redis from '../redis/client';

const router = Router();
const logger = pino({ name: 'hotel-health', level: env.logLevel });

type ComponentStatus = 'up' | 'down';

async function probeSupplier(supplier: 'A' | 'B'): Promise<ComponentStatus> {
  try {
    const url = `${env.supplierBaseUrl}/supplier${supplier}/hotels?city=delhi`;
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

async function probeRedis(): Promise<ComponentStatus> {
  try {
    await redis.ping();
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * 200 when Redis is up (status "ok" or "degraded" per supplier) so compose
 * keeps `app` healthy during supplier-down simulations; 503 when Redis is down.
 */
router.get('/health', async (_req, res) => {
  const [supplierA, supplierB, redisStatus] = await Promise.all([
    probeSupplier('A'),
    probeSupplier('B'),
    probeRedis(),
  ]);
  const suppliers = { supplierA, supplierB };

  if (redisStatus === 'down') {
    logger.error({ suppliers }, 'Health check failed: Redis is down');
    res.status(503).json({ status: 'error', redis: 'down', suppliers });
    return;
  }

  const status = supplierA === 'up' && supplierB === 'up' ? 'ok' : 'degraded';
  if (status === 'ok') {
    logger.info({ suppliers }, 'Health check ok');
  } else {
    logger.warn({ suppliers }, 'Health check degraded');
  }
  res.status(200).json({ status, redis: 'up', suppliers });
});

export default router;
