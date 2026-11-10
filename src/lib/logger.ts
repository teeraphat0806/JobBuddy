type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

export type Logger = typeof logger;

export function errorFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const fields: Record<string, unknown> = { error: err.message, stack: err.stack };
  if (err.cause !== undefined) {
    fields.cause = err.cause instanceof Error ? err.cause.message : String(err.cause);
  }
  // LINE SDK HTTPFetchError: the response body says exactly which property was rejected.
  const http = err as { status?: unknown; body?: unknown };
  if (typeof http.status === 'number') fields.status = http.status;
  if (typeof http.body === 'string' && http.body) fields.body = http.body.slice(0, 2000);
  return fields;
}

/** HTTP status of a LINE API error, if that's what this is. */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}
