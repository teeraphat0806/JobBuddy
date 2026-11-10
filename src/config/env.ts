import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  APP_TIMEZONE: z.string().default('Asia/Bangkok'),
  /** Create/update the LINE rich menu on startup. Set to "false" to skip (e.g. local dev). */
  RICH_MENU_SYNC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Pull jobs from company job boards on a schedule. */
  JOB_SYNC: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  JOB_SYNC_INTERVAL_HOURS: z.coerce.number().positive().max(168).default(6),
  /** Push interview reminders (uses the LINE monthly push quota). */
  REMINDERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REMINDER_INTERVAL_MINUTES: z.coerce.number().positive().max(60).default(5),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}
