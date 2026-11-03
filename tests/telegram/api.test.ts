import { expect, it } from 'vitest';
import { createTelegramAdmin } from '../../src/telegram/api';

it('sets the webhook with one connection so updates are handled one at a time', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as unknown as typeof fetch;
  await createTelegramAdmin('1:x', fetchImpl).setWebhook('https://a/b', 'secret');
  expect(calls[0].body).toMatchObject({ url: 'https://a/b', secret_token: 'secret', max_connections: 1 });
});
