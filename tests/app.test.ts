import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { sign, silentLogger } from './helpers.js';

const secret = 'test-secret';

function setup(overrides: { checkDatabase?: () => Promise<void> } = {}) {
  const handleEvents = vi.fn().mockResolvedValue(undefined);
  const app = createApp({
    channelSecret: secret,
    handleEvents,
    checkDatabase: overrides.checkDatabase ?? (async () => {}),
    logger: silentLogger,
  });
  return { app, handleEvents };
}

function postWebhook(app: ReturnType<typeof setup>['app'], body: string, signature?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['x-line-signature'] = signature;
  return app.request('/webhooks/line', { method: 'POST', headers, body });
}

describe('POST /webhooks/line', () => {
  const body = JSON.stringify({
    destination: 'U0',
    events: [{ type: 'unfollow', source: { type: 'user', userId: 'U1' } }],
  });

  it('accepts a correctly signed request and dispatches events', async () => {
    const { app, handleEvents } = setup();
    const res = await postWebhook(app, body, sign(body, secret));
    expect(res.status).toBe(200);
    expect(handleEvents).toHaveBeenCalledWith([
      { type: 'unfollow', source: { type: 'user', userId: 'U1' } },
    ]);
  });

  it('rejects a missing signature', async () => {
    const { app, handleEvents } = setup();
    const res = await postWebhook(app, body);
    expect(res.status).toBe(401);
    expect(handleEvents).not.toHaveBeenCalled();
  });

  it('rejects a wrong signature', async () => {
    const { app, handleEvents } = setup();
    const res = await postWebhook(app, body, sign(body, 'other-secret'));
    expect(res.status).toBe(401);
    expect(handleEvents).not.toHaveBeenCalled();
  });

  it('answers 200 to the LINE console verify request (no events)', async () => {
    const { app, handleEvents } = setup();
    const verify = JSON.stringify({ destination: 'U0', events: [] });
    const res = await postWebhook(app, verify, sign(verify, secret));
    expect(res.status).toBe(200);
    expect(handleEvents).toHaveBeenCalledWith([]);
  });
});

describe('GET /health', () => {
  it('returns ok when the database responds', async () => {
    const { app } = setup();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const { app } = setup({
      checkDatabase: async () => {
        throw new Error('down');
      },
    });
    const res = await app.request('/health');
    expect(res.status).toBe(503);
  });
});
