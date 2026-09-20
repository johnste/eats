import { z } from 'zod';

/**
 * Validated once at boot. A missing secret should stop the process here, not
 * surface as a confusing auth failure an hour into production.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  OFF_USER_AGENT: z.string().min(1).default('Eats/1.0'),
  INVITE_BOOTSTRAP_CODE: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Directory holding the built SPA; unset means API-only (dev). */
  WEB_DIST: z.string().optional(),
  /**
   * Origin this server is reached at, e.g. https://eats.example.com. OAuth
   * metadata has to state absolute URLs and an issuer, and a request's Host
   * header is attacker-controlled, so it cannot be derived per request.
   */
  PUBLIC_URL: z
    .url()
    .transform((u) => u.replace(/\/+$/, ''))
    .default('http://localhost:3000'),
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

  // Left at its default in production, OAuth metadata would advertise
  // localhost as the issuer and every connector would fail with an error
  // that says nothing about the cause. Better to refuse to start.
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.PUBLIC_URL.includes('localhost')) {
    throw new Error(
      'Invalid environment:\n  PUBLIC_URL must be the real origin in production, ' +
        'e.g. https://eats.example.com -- it is what OAuth clients are told to use.',
    );
  }
  return env;
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
