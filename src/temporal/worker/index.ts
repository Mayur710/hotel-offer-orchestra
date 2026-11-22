import path from 'node:path';
import pino from 'pino';
import { NativeConnection, Runtime, Worker, type RuntimeOptions } from '@temporalio/worker';
import { env } from '../../config/env';
import * as hotelActivities from '../activities/hotelActivities';
import { TASK_QUEUE } from '../types';

const logger = pino({ name: 'temporal-worker', level: env.logLevel });

type TemporalLogger = NonNullable<RuntimeOptions['logger']>;

/** Bridges Temporal SDK logs (workflow.log, activity log, worker events) into pino. */
const temporalLogger: TemporalLogger = {
  log(level, message, meta) {
    const bindings = meta ?? {};
    switch (level) {
      case 'TRACE':
        logger.trace(bindings, message);
        break;
      case 'DEBUG':
        logger.debug(bindings, message);
        break;
      case 'WARN':
        logger.warn(bindings, message);
        break;
      case 'ERROR':
        logger.error(bindings, message);
        break;
      default:
        logger.info(bindings, message);
    }
  },
  trace(message, meta) {
    logger.trace(meta ?? {}, message);
  },
  debug(message, meta) {
    logger.debug(meta ?? {}, message);
  },
  info(message, meta) {
    logger.info(meta ?? {}, message);
  },
  warn(message, meta) {
    logger.warn(meta ?? {}, message);
  },
  error(message, meta) {
    logger.error(meta ?? {}, message);
  },
};

Runtime.install({ logger: temporalLogger });

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.temporalAddress });
  try {
    const worker = await Worker.create({
      connection,
      workflowsPath: path.join(__dirname, '../workflows/hotelOfferWorkflow.js'),
      activities: hotelActivities,
      taskQueue: TASK_QUEUE,
    });

    logger.info({ taskQueue: TASK_QUEUE, address: env.temporalAddress }, 'Temporal worker started');
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  logger.fatal({ err }, 'Temporal worker exited unexpectedly');
  process.exit(1);
});
