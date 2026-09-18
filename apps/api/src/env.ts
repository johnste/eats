import { z } from 'zod';

/**
 * Validated once at boot. A missing secret should stop the process here, not
 * surface as a confusing auth failure an hour into production.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  OFF_USER_AGENT: z.string().min(1).default('Eats/1.0'),
  INVITE_BOOTSTRAP_CODE: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Directory holding the built SPA; unset means API-only (dev). */
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
