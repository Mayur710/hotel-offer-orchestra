/**
 * Typed environment loader with defaults.
 * Fails fast on missing required variables so a misconfigured container
 * crashes at startup instead of on the first request.
 */

function requiredString(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

export interface Env {
  port: number;
  redisUrl: string;
  temporalAddress: string;
  supplierBaseUrl: string;
  supplierADown: boolean;
  supplierBDown: boolean;
  logLevel: string;
}

function loadEnv(): Env {
  return {
    port: optionalInt('PORT', 3000),
    redisUrl: requiredString('REDIS_URL'),
    temporalAddress: requiredString('TEMPORAL_ADDRESS'),
    supplierBaseUrl: requiredString('SUPPLIER_BASE_URL').replace(/\/+$/, ''),
    supplierADown: optionalBool('SUPPLIER_A_DOWN', false),
    supplierBDown: optionalBool('SUPPLIER_B_DOWN', false),
    logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  };
}

export const env: Env = loadEnv();
