import express, { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { env } from '../config/env';
import supplierRoutes from '../mock/supplierRoutes';
import healthRoutes from './healthRoutes';
import hotelRoutes from './hotelRoutes';

const logger = pino({ name: 'hotel-api-http', level: env.logLevel });
const app = express();

// Structured access log for every request.
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      'request completed',
    );
  });
  next();
});

app.use(express.json());
app.use(supplierRoutes); // GET /supplierA/hotels, GET /supplierB/hotels
app.use('/api', hotelRoutes); // GET /api/hotels
app.use(healthRoutes); // GET /health

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled request error');
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(env.port, () => {
  logger.info({ port: env.port }, 'API server listening');
});
