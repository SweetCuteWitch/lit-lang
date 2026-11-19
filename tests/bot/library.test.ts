import { beforeEach, describe, expect, it } from 'vitest';
import type { BotCtx } from '../../src/bot/context';
import { handleUpdate, type TgUpdate } from '../../src/bot/handle-update';
import { createMemoryStore } from '../../src/store/memory';
import type { Store } from '../../src/store/types';
import type { TaskInput } from '../../src/tasks/schema';
import { BTN_PROGRESS, BTN_START } from '../../src/telegram/format';
import { createFakeTelegram } from '../helpers/fake-telegram';
import { word } from '../store/contract';

const CHAT = 555;
const T = { lessons: 11, training: 12, vocab: 13, writing: 14 };
let updateId = 1;
const msg = (text: string): TgUpdate => ({ update_id: updateId++, message: { message_id: 9000 + updateId, chat: { id: CHAT }, text } });
const press = (data: string): TgUpdate => ({
  update_id: updateId++, callback_query: { id: `cb${updateId}`, data, message: { message_id: 1, chat: { id: CHAT } } },
});

describe('vocab and lessons', () => {
  let store: Store;
  let tg: ReturnType<typeof createFakeTelegram>;
  let ctx: BotCtx;
  let now: Date;
  const inTopic = (t: number) => tg.messages.filter((m) => m.threadId === t && !m.deleted).map((m) => m.text);

  beforeEach(async () => {
    store = createMemoryStore();
    tg = createFakeTelegram();
    now = new Date('2026-11-03T07:00:00Z');
    ctx = { store, api: tg.api, chatId: CHAT, now: () => now };
    await store.setSetting('topics', T);
    await store.upsertLessons([
      { no: 1, title: 'Labas!', grammar: '', topic: '', skill: '', words: [] },
      { no: 2, title: 'Aš esu', grammar: '', topic: '', skill: '', words: [] },
      { no: 3, title: 'Kas tai?', grammar: '', topic: '', skill: '', words: [] },
    ]);
    for (const [lessonNo, seq] of [[1, 1], [2, 1], [2, 2], [3, 1]]) {
      const p = await store.addPortion({ lessonNo, seq, theory: `теория ${lessonNo}.${seq}`, words: [] });
      if (lessonNo < 3) await store.markPortionServed(p.id, now.toISOString());
    }
    await store.upsertWord(word('labas', { translation: 'привет', gender: null }), 1, now.toISOString());
  });

  it('progress message has vocab and lessons buttons', async () => {
    await handleUpdate(msg(BTN_PROGRESS), ctx);
    const last = tg.messages.at(-1)!;
    const markup = last.markup as { inline_keyboard: { callback_data: string }[][] };
    expect(markup.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['vocab', 'lessons']);
  });

  it('vocab button sends the word list to the vocab topic', async () => {
    await handleUpdate(press('vocab'), ctx);
    expect(inTopic(T.vocab).join('\n')).toContain('<b>labas</b> — привет');
    await handleUpdate(msg('/vocab'), ctx);
    expect(inTopic(T.vocab)).toHaveLength(2);
  });

  it('lists passed lessons, then sends the theory of the chosen one once', async () => {
    await handleUpdate(press('lessons'), ctx);
    const list = inTopic(T.lessons).at(-1)!;
    expect(list).toContain('1. Labas!');
    expect(list).toContain('2. Aš esu');
    expect(list).not.toContain('3. Kas tai?');
    await handleUpdate(msg('2'), ctx);
    const sent = inTopic(T.lessons);
    expect(sent.slice(-2)).toEqual(['📚 <b>Урок 2: Aš esu</b> · часть 1\n\nтеория 2.1', '📚 <b>Урок 2: Aš esu</b> · часть 2\n\nтеория 2.2']);
    const count = tg.messages.length;
    await handleUpdate(msg('2'), ctx);
    expect(inTopic(T.lessons)).toHaveLength(sent.length);
    expect(tg.messages.length).toBe(count + 1); // the usual "no task" reply
  });

  it('a wrong number keeps waiting and names the available lessons', async () => {
    await handleUpdate(msg('/lessons'), ctx);
    await handleUpdate(msg('7'), ctx);
    expect(inTopic(T.lessons).at(-1)).toBe('Такого урока пока нет. Доступны: 1, 2.');
    await handleUpdate(msg('1'), ctx);
    expect(inTopic(T.lessons).at(-1)).toContain('теория 1.1');
  });

  it('a number during a session picks the lesson instead of answering, only while waiting', async () => {
    const p = (await store.listPortions(3))[0];
    const input: TaskInput = { lessonNo: 3, tags: ['t'], unverified: [], kind: 'input', slot: 'new', portionKey: '3.1', question: '___', accept: ['2'], reject: [], explanation: '' };
    await store.addTasks([{ payload: input, portionId: p.id }], now.toISOString());
    await store.setSetting('progress', { lessonNo: 3, revisions: 0 });
    await handleUpdate(msg(BTN_START), ctx);
    await handleUpdate(press('lessons'), ctx);
    await handleUpdate(msg('2'), ctx);
    expect(await store.listAnswers({})).toHaveLength(0);
    expect(inTopic(T.lessons).at(-1)).toContain('теория 2.2');
    await handleUpdate(msg('2'), ctx);
    expect(await store.listAnswers({})).toHaveLength(1);
  });

  it('stops waiting after 10 minutes', async () => {
    await handleUpdate(press('lessons'), ctx);
    const before = inTopic(T.lessons).length;
    now = new Date(now.getTime() + 11 * 60_000);
    await handleUpdate(msg('2'), ctx);
    expect(inTopic(T.lessons)).toHaveLength(before);
  });
});
