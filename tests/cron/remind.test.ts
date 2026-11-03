import { beforeEach, describe, expect, it } from 'vitest';
import type { BotCtx } from '../../src/bot/context';
import { handleRemindRequest, remind } from '../../src/cron/remind';
import { createMemoryStore } from '../../src/store/memory';
import type { Session, Store } from '../../src/store/types';
import { createFakeTelegram } from '../helpers/fake-telegram';

const session = (over: Partial<Session>): Omit<Session, 'id'> => ({
  slot: 'new', portionId: null, startedAt: '2026-11-03T06:00:00.000Z', finishedAt: '2026-11-03T06:15:00.000Z', items: [], cursor: 0,
  messageIds: [], lastUpdateId: null, state: {}, correct: 5, total: 5, ...over,
});

describe('remind', () => {
  let store: Store;
  let tg: ReturnType<typeof createFakeTelegram>;
  let now: Date;
  let ctx: BotCtx;
  beforeEach(() => {
    store = createMemoryStore();
    tg = createFakeTelegram();
    now = new Date('2026-11-03T06:00:00Z'); // 08:00 in Vilnius
    ctx = { store, api: tg.api, chatId: 1, now: () => now };
  });

  it('sends a morning reminder with a start button and a low-bank warning', async () => {
    expect(await remind(ctx)).toBe('sent');
    expect(tg.last().text).toContain('нового материала');
    expect(tg.last().text).toContain('⚠️');
    expect(tg.buttons(tg.last())[0].callback_data).toBe('start');
  });

  it('skips the morning reminder after a new session today', async () => {
    await store.createSession(session({ startedAt: '2026-11-03T05:30:00.000Z' }));
    expect(await remind(ctx)).toBe('skipped');
  });

  it('skips the evening reminder after two sessions and replaces older reminders', async () => {
    now = new Date('2026-11-03T17:00:00Z');
    await remind(ctx);
    const first = tg.last().id;
    await remind(ctx);
    expect(tg.messages.find((m) => m.id === first)!.deleted).toBe(true);
    await store.createSession(session({}));
    await store.createSession(session({ slot: 'review', startedAt: '2026-11-03T16:00:00.000Z' }));
    expect(await remind(ctx)).toBe('skipped');
  });

  it('closes an abandoned session', async () => {
    const s = await store.createSession(session({ startedAt: '2026-11-02T18:00:00.000Z', finishedAt: null, messageIds: [100] }));
    await remind(ctx);
    expect((await store.getSession(s.id))?.finishedAt).not.toBeNull();
  });

  it('requires the cron secret', async () => {
    const secret = 'cron_secret_cron_secret';
    const bad = await handleRemindRequest(new Request('https://x', { headers: { authorization: 'Bearer nope' } }), secret, ctx);
    expect(bad.status).toBe(403);
    const ok = await handleRemindRequest(new Request('https://x', { headers: { authorization: `Bearer ${secret}` } }), secret, ctx);
    expect(await ok.json()).toEqual({ result: 'sent' });
  });
});
