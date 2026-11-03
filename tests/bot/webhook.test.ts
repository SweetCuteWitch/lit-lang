import { expect, it } from 'vitest';
import { handleWebhookRequest } from '../../src/bot/webhook';
import { createMemoryStore } from '../../src/store/memory';
import { createFakeTelegram } from '../helpers/fake-telegram';

const SECRET = 'secret_secret_secret';
const req = (secret: string | null, body: unknown) =>
  new Request('https://x/api/telegram/webhook', {
    method: 'POST',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    body: JSON.stringify(body),
  });

it('rejects requests without the secret and answers 200 even when handling fails', async () => {
  const tg = createFakeTelegram();
  const errors: string[] = [];
  const ctx = { store: createMemoryStore(), api: tg.api, chatId: 1, now: () => new Date(), log: (m: string) => { errors.push(m); } };
  expect((await handleWebhookRequest(req(null, {}), SECRET, ctx)).status).toBe(403);
  expect((await handleWebhookRequest(req('wrong_wrong_wrong_wr', {}), SECRET, ctx)).status).toBe(403);
  const ok = await handleWebhookRequest(req(SECRET, { update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: '/start' } }), SECRET, ctx);
  expect(ok.status).toBe(200);
  expect(tg.last().text).toContain('Labas');
  ctx.api.sendMessage = async () => { throw new Error('boom'); };
  const failed = await handleWebhookRequest(req(SECRET, { update_id: 2, message: { message_id: 2, chat: { id: 1 }, text: '/start' } }), SECRET, ctx);
  expect(failed.status).toBe(200);
  expect(errors).toEqual(['telegram update failed']);
});
