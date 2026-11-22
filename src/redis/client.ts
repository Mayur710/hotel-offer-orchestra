import Redis from 'ioredis';
import pino from 'pino';
import { env } from '../config/env';

const logger = pino({ name: 'redis', level: env.logLevel });

/** Singleton ioredis client shared by the API and the Temporal worker. */
const redis = new Redis(env.redisUrl, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

export default redis;
