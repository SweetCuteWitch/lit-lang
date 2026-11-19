import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotCtx } from '../../src/bot/context';
import { handleUpdate, type TgUpdate } from '../../src/bot/handle-update';
import { createMemoryStore } from '../../src/store/memory';
import type { Store } from '../../src/store/types';
import type { TaskInput } from '../../src/tasks/schema';
import { taskDueAt } from '../../src/learn/mastery';
import { BTN_START } from '../../src/telegram/format';
import { createFakeTelegram } from '../helpers/fake-telegram';
import { word } from '../store/contract';

const CHAT = 555;
const T = { lessons: 11, training: 12, vocab: 13, writing: 14 };

const base = { lessonNo: 1, tags: ['t1'], unverified: [] };
const choice: TaskInput = { ...base, kind: 'choice', slot: 'new', portionKey: '1.1', question: 'Kaip sekasi?', options: ['Gerai', 'Blogai'], correct: 0, explanation: 'gerai = хорошо' };
const input: TaskInput = { ...base, kind: 'input', slot: 'new', portionKey: '1.1', question: 'Aš ___ (gyventi) Vilniuje.', accept: ['gyvenu'], reject: [], explanation: '1 л. ед. ч.', tags: ['verb:pres'] };
const order: TaskInput = { ...base, kind: 'order', slot: 'new', portionKey: '1.1', question: 'Я живу в Вильнюсе', words: ['Vilniuje', 'Aš', 'gyvenu'], accept: ['Aš gyvenu Vilniuje'], explanation: '' };
const reading: TaskInput = { ...base, kind: 'reading', slot: 'review', title: 'Skelbimas', text: 'Parduotuvė dirba nuo 8 iki 20.', questions: [{ q: 'Parduotuvė dirba nuo 8?', options: ['Taip', 'Ne'], correct: 0 }, { q: 'Iki 22?', options: ['Taip', 'Ne'], correct: 1 }], glossary: {} };
const writing: TaskInput = { ...base, kind: 'writing', slot: 'review', prompt: 'Parašykite draugui laišką.', minWords: 30, maxWords: 50 };

let updateId = 1;
const msg = (text: string, extra: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate => ({
  update_id: updateId++, message: { message_id: 9000 + updateId, chat: { id: CHAT }, text, ...extra },
});
const press = (data: string, messageId: number): TgUpdate => ({
  update_id: updateId++, callback_query: { id: `cb${updateId}`, data, message: { message_id: messageId, chat: { id: CHAT } } },
});

describe('bot', () => {
  let store: Store;
  let tg: ReturnType<typeof createFakeTelegram>;
  let ctx: BotCtx;
  let now: Date;

  beforeEach(async () => {
    store = createMemoryStore();
    tg = createFakeTelegram();
    now = new Date('2026-11-03T07:00:00Z');
    ctx = { store, api: tg.api, chatId: CHAT, now: () => now };
    await store.setSetting('topics', T);
    await store.upsertLessons([{ no: 1, title: 'Pažintis', grammar: '', topic: '', skill: '', words: [] }]);
  });

  async function seedPortion(tasks: TaskInput[]) {
    const p = await store.addPortion({ lessonNo: 1, seq: 1, theory: '<b>Labas</b> = привет', words: [word('labas', { translation: 'привет' })] });
    await store.addTasks(tasks.map((payload) => ({ payload, portionId: payload.slot === 'new' ? p.id : null })), now.toISOString());
  }

  it('runs a full new-material session and leaves only the summary in training', async () => {
    await seedPortion([choice, input, order]);
    await handleUpdate(msg(BTN_START), ctx);

    const lessons = tg.visible().filter((m) => m.threadId === T.lessons);
    expect(lessons[0].text).toContain('Урок 1: Pažintis');
    expect(tg.visible().filter((m) => m.threadId === T.vocab)[0].text).toContain('labas');
    expect((await store.listWords()).map((w) => w.lemma)).toEqual(['labas']);

    // choice
    expect(tg.last().text).toContain('Kaip sekasi?');
    await handleUpdate(press('c:0', tg.last().id), ctx);
    // input (typed, without diacritics issue)
    expect(tg.last().text).toContain('gyventi');
    await handleUpdate(msg('Gyvenu.'), ctx);
    expect(tg.visible().some((m) => m.text.startsWith('✅ Верно!'))).toBe(true);
    // order
    const orderMsg = tg.last();
    expect(orderMsg.text).toContain('Соберите');
    await handleUpdate(press('o:1', orderMsg.id), ctx);
    await handleUpdate(press('o:2', orderMsg.id), ctx);
    await handleUpdate(press('o:0', orderMsg.id), ctx);
    expect(tg.messages.find((m) => m.id === orderMsg.id)!.text).toContain('Aš gyvenu Vilniuje');
    await handleUpdate(press('od', orderMsg.id), ctx);

    // Only the feedback of the last task and the summary stay.
    const training = tg.visible().filter((m) => m.threadId === T.training);
    expect(training[0].text.startsWith('✅ Верно!')).toBe(true);
    expect(training).toHaveLength(2);
    expect(training[1].text).toContain('Занятие завершено</b>: 3/3');
    expect(await store.activeSession()).toBeNull();
    expect((await store.nextPortion(1))).toBeNull();
  });

  it('marks a wrong answer, shows the correct one and lets the user dispute it', async () => {
    await seedPortion([input, choice]);
    await handleUpdate(msg(BTN_START), ctx);
    await handleUpdate(msg('gyveni'), ctx);
    const fb = tg.visible().find((m) => m.text.startsWith('❌'))!;
    expect(fb.text).toContain('gyvenu');
    const btn = tg.buttons(fb).find((b) => b.callback_data.startsWith('d:'))!;
    await handleUpdate(press(btn.callback_data, fb.id), ctx);
    expect(tg.callbacks.at(-1)?.text).toContain('Отправлено на проверку');
    const [a] = await store.listAnswers({ pendingDispute: true });
    expect(a).toMatchObject({ answer: 'gyveni', correct: true, disputed: true });
    await handleUpdate(press('c:0', tg.last().id), ctx);
    expect(tg.visible().find((m) => m.text.includes('Занятие завершено'))!.text).toContain('2/2');
  });

  describe('task mastery', () => {
    const taskOf = async () => (await store.listTasks({}))[0];

    it('raises the score on a correct choice and schedules the next review', async () => {
      await seedPortion([choice]);
      await handleUpdate(msg(BTN_START), ctx);
      await handleUpdate(press('c:0', tg.last().id), ctx);
      const t = await taskOf();
      expect(t.score).toBe(1);
      expect(t.dueAt).toBe(taskDueAt(1, now));
    });

    it('keeps the score for an answer without diacritics', async () => {
      await seedPortion([{ ...input, accept: ['šiandien'], question: 'Сегодня = ___' }]);
      await handleUpdate(msg(BTN_START), ctx);
      const t0 = await taskOf();
      await store.updateTaskScore(t0.id, 2, t0.dueAt!);
      await handleUpdate(msg('siandien'), ctx);
      const t1 = await taskOf();
      expect(t1.score).toBe(2);
      expect(t1.dueAt).toBe(taskDueAt(2, now));
    });

    it('resets the score on "I do not know"', async () => {
      await seedPortion([input]);
      await handleUpdate(msg(BTN_START), ctx);
      const t0 = await taskOf();
      await store.updateTaskScore(t0.id, 3, t0.dueAt!);
      await handleUpdate(press('idk', tg.last().id), ctx);
      expect((await taskOf()).score).toBe(0);
    });

    it('scores a reading item once, after the last question', async () => {
      const q = (correct: number) => ({ q: 'Q?', options: ['Taip', 'Ne'], correct });
      await seedPortion([{ ...reading, slot: 'new', questions: [q(0), q(0), q(0)] }]);
      const spy = vi.spyOn(store, 'updateTaskScore');
      await handleUpdate(msg(BTN_START), ctx);
      const t0 = await taskOf();
      await store.updateTaskScore(t0.id, 2, t0.dueAt!);
      spy.mockClear();
      await handleUpdate(press('r:0', tg.last().id), ctx);
      await handleUpdate(press('r:1', tg.last().id), ctx); // wrong
      expect(spy).not.toHaveBeenCalled();
      await handleUpdate(press('r:0', tg.last().id), ctx);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await taskOf()).score).toBe(0);
    });

    it('sets the score to 2 when an answer is disputed', async () => {
      await seedPortion([input, choice]);
      await handleUpdate(msg(BTN_START), ctx);
      await handleUpdate(msg('gyveni'), ctx);
      const t0 = (await store.listTasks({})).find((t) => t.payload.kind === 'input')!;
      expect(t0.score).toBe(0);
      const fb = tg.visible().find((m) => m.text.startsWith('❌'))!;
      const btn = tg.buttons(fb).find((b) => b.callback_data.startsWith('d:'))!;
      await handleUpdate(press(btn.callback_data, fb.id), ctx);
      const t1 = (await store.listTasks({})).find((t) => t.id === t0.id)!;
      expect(t1.score).toBe(2);
      expect(t1.dueAt).toBe(taskDueAt(2, now));
    });
  });

  it('accepts an answer without diacritics and shows the spelling', async () => {
    await seedPortion([{ ...input, accept: ['šiandien'], question: 'Сегодня = ___' }]);
    await handleUpdate(msg(BTN_START), ctx);
    await handleUpdate(msg('siandien'), ctx);
    expect(tg.messages.some((m) => m.text.includes('Правильное написание: <b>šiandien</b>'))).toBe(true);
  });

  it('runs word review and reading in a review session', async () => {
    await store.addTasks([{ payload: reading, portionId: null }], now.toISOString());
    await store.upsertWord(word('namas', { translation: 'дом' }), 1, now.toISOString());
    // A new session already happened today, so this one is review.
    await store.createSession({ slot: 'new', portionId: null, startedAt: '2026-11-03T06:00:00Z', finishedAt: '2026-11-03T06:10:00Z', items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0 });
    await handleUpdate(msg(BTN_START), ctx);
    expect(tg.last().text).toContain('namas');
    await handleUpdate(press('w:y', tg.last().id), ctx); // not revealed yet → stale
    expect(tg.callbacks.at(-1)?.text).toBe('Это задание уже не активно');
    await handleUpdate(press('w:show', tg.last().id), ctx);
    expect(tg.last().text).toContain('дом');
    await handleUpdate(press('w:n', tg.last().id), ctx);
    const w = (await store.listWords())[0];
    expect(w.box).toBe(1);
    expect(tg.last().text).toContain('Parduotuvė dirba');
    await handleUpdate(press('r:0', tg.last().id), ctx);
    expect(tg.last().text).toContain('Iki 22?');
    await handleUpdate(press('r:0', tg.last().id), ctx);
    expect(tg.visible().find((m) => m.text.includes('Занятие завершено'))!.text).toContain('1/3');
  });

  it('posts a writing task to the writing topic and saves the reply', async () => {
    await store.addTasks([{ payload: { ...choice, slot: 'review', portionKey: undefined }, portionId: null }, { payload: writing, portionId: null }], now.toISOString());
    await store.createSession({ slot: 'new', portionId: null, startedAt: '2026-11-03T06:00:00Z', finishedAt: '2026-11-03T06:10:00Z', items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0 });
    await handleUpdate(msg(BTN_START), ctx);
    await handleUpdate(press('c:0', tg.last().id), ctx);
    const prompt = tg.visible().find((m) => m.threadId === T.writing)!;
    expect(prompt.text).toContain('Parašykite draugui');
    await handleUpdate(msg('Labas, Tomai! Kviečiu tave į svečius.', { message_thread_id: T.writing }), ctx);
    const [a] = await store.listAnswers({ pendingReview: true });
    expect(a.answer).toContain('Kviečiu');
    expect(tg.last().text).toContain('Текст сохранён');
  });

  it('says so when there is nothing to study', async () => {
    await handleUpdate(msg(BTN_START), ctx);
    expect(tg.last().text).toContain('ещё нет материала');
    expect(await store.activeSession()).toBeNull();
  });

  it('ignores other chats and repeated updates', async () => {
    await seedPortion([input]);
    await handleUpdate({ update_id: updateId++, message: { message_id: 1, chat: { id: 999 }, text: BTN_START } }, ctx);
    expect(tg.messages).toHaveLength(0);
    await handleUpdate(msg(BTN_START), ctx);
    const answerUpdate = msg('gyvenu');
    await handleUpdate(answerUpdate, ctx);
    await handleUpdate(answerUpdate, ctx);
    expect(await store.listAnswers({ kind: 'task' })).toHaveLength(1);
  });

  it('hints when a text arrives and no answer is expected', async () => {
    await handleUpdate(msg('labas'), ctx);
    expect(tg.last().text).toContain('не жду ответа');
  });

  it('sends everything to the main chat when topics are not configured', async () => {
    await store.setSetting('topics', null);
    await seedPortion([choice]);
    await handleUpdate(msg(BTN_START), ctx);
    expect(tg.messages.every((m) => m.threadId === null)).toBe(true);
  });

  it('resumes a fresh active session and closes an abandoned one', async () => {
    await seedPortion([choice, input]);
    await handleUpdate(msg(BTN_START), ctx);
    const first = await store.activeSession();
    await handleUpdate(msg(BTN_START), ctx);
    expect((await store.activeSession())?.id).toBe(first!.id);
    now = new Date('2026-11-03T12:00:00Z');
    tg.undeletable.add(first!.messageIds[0]);
    await handleUpdate(msg(BTN_START), ctx);
    expect((await store.getSession(first!.id))?.finishedAt).not.toBeNull();
  });

  it('rejects a button from an old message', async () => {
    await seedPortion([choice, input]);
    await handleUpdate(msg(BTN_START), ctx);
    const old = tg.last().id;
    await handleUpdate(press('c:0', old), ctx);
    await handleUpdate(press('c:1', old), ctx);
    expect(tg.callbacks.at(-1)?.text).toBe('Это задание уже не активно');
    expect(await store.listAnswers({ kind: 'task' })).toHaveLength(1);
  });

  it('keeps working when update ids restart lower (after a week of silence)', async () => {
    await handleUpdate({ update_id: 900000, message: { message_id: 1, chat: { id: CHAT }, text: '/start' } }, ctx);
    await handleUpdate({ update_id: 3, message: { message_id: 2, chat: { id: CHAT }, text: '/start' } }, ctx);
    expect(tg.messages.filter((m) => m.text.includes('Labas!'))).toHaveLength(2);
  });

  it('keeps the feedback of the last task visible and disputable', async () => {
    await seedPortion([input]);
    await handleUpdate(msg(BTN_START), ctx);
    await handleUpdate(msg('gyveni'), ctx);
    const fb = tg.visible().find((m) => m.text.startsWith('❌'));
    expect(fb?.text).toContain('gyvenu');
    expect(tg.buttons(fb!).some((x) => x.callback_data.startsWith('d:'))).toBe(true);
  });

  it('always answers the callback even when handling fails', async () => {
    await seedPortion([order, input]);
    await handleUpdate(msg(BTN_START), ctx);
    const id = tg.last().id;
    tg.api.editMessageText = async () => { throw new Error('Bad Request: message is not modified'); };
    await expect(handleUpdate(press('or', id), ctx)).rejects.toThrow();
    expect(tg.callbacks.length).toBeGreaterThan(0);
  });

  it('accepts a plain message as writing when topics are off and a writing prompt is pending', async () => {
    await store.setSetting('topics', null);
    await store.addTasks([{ payload: writing, portionId: null }], now.toISOString());
    await store.createSession({ slot: 'new', portionId: null, startedAt: '2026-11-03T06:00:00Z', finishedAt: '2026-11-03T06:10:00Z', items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0 });
    await store.upsertWord(word('namas'), 1, '2026-11-10T00:00:00Z');
    await handleUpdate(msg(BTN_START), ctx);
    expect(tg.visible().some((m) => m.text.includes('Письменное задание'))).toBe(true);
    await handleUpdate(msg('Labas, Tomai!'), ctx);
    expect((await store.listAnswers({ pendingReview: true })).map((a) => a.answer)).toEqual(['Labas, Tomai!']);
  });
});
