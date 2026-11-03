import { beforeEach, describe, expect, it } from 'vitest';
import { bankStatus, decideAdvance, getProgress, weakTags } from '../../src/learn/progress';
import { planSession } from '../../src/learn/plan-session';
import { nextBox } from '../../src/learn/srs';
import { createMemoryStore } from '../../src/store/memory';
import type { Store } from '../../src/store/types';
import { choiceTask, word } from '../store/contract';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const DAY = new Date('2026-11-02T22:00:00.000Z');

describe('nextBox', () => {
  it('moves a remembered word up with growing intervals', () => {
    expect(nextBox(0, true, NOW)).toEqual({ box: 1, dueAt: '2026-11-04T08:00:00.000Z' });
    expect(nextBox(3, true, NOW)).toEqual({ box: 4, dueAt: '2026-11-11T08:00:00.000Z' });
    expect(nextBox(6, true, NOW).box).toBe(6);
  });
  it('sends a forgotten word back to box 1 in 10 minutes', () => {
    expect(nextBox(5, false, NOW)).toEqual({ box: 1, dueAt: '2026-11-03T08:10:00.000Z' });
  });
});

describe('decideAdvance', () => {
  it('continues while portions remain', () => {
    expect(decideAdvance({ portionsReady: 1, accuracy: 0.1, revisions: 0 })).toBe('continue');
  });
  it('advances at 70% accuracy', () => {
    expect(decideAdvance({ portionsReady: 0, accuracy: 0.7, revisions: 0 })).toBe('advance');
  });
  it('revises below 70%', () => {
    expect(decideAdvance({ portionsReady: 0, accuracy: 0.69, revisions: 2 })).toBe('revise');
  });
  it('advances after 3 revisions', () => {
    expect(decideAdvance({ portionsReady: 0, accuracy: 0.2, revisions: 3 })).toBe('advance');
  });
});

async function seedLesson(store: Store, lessonNo: number, seqs: number[], tasksPer = 3) {
  for (const seq of seqs) {
    const p = await store.addPortion({ lessonNo, seq, theory: `L${lessonNo}.${seq}`, words: [word(`w${lessonNo}${seq}`)] });
    await store.addTasks(
      Array.from({ length: tasksPer }, () => ({ payload: choiceTask({ lessonNo, slot: 'new', portionKey: `${lessonNo}.${seq}` }), portionId: p.id })),
      NOW.toISOString(),
    );
  }
}
const addReview = (store: Store, n: number, over = {}) =>
  store.addTasks(Array.from({ length: n }, () => ({ payload: choiceTask({ slot: 'review', ...over }), portionId: null })), NOW.toISOString());

const answer = (store: Store, lessonNo: number, correct: boolean, tags = ['t'], at = NOW.toISOString()) =>
  store.addAnswer({ kind: 'task', taskId: null, wordId: null, sessionId: null, answer: 'x', correct, exact: correct, tags, lessonNo, createdAt: at });

describe('planSession', () => {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
  });

  it('starts with new material from the current lesson portion plus review', async () => {
    await seedLesson(store, 1, [1, 2]);
    await addReview(store, 5);
    const plan = await planSession(store, NOW, DAY);
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan.slot).toBe('new');
    expect(plan.portion?.seq).toBe(1);
    expect(plan.items.filter((i) => i.type === 'task')).toHaveLength(5);
  });

  it('gives a review session after a new one today', async () => {
    await seedLesson(store, 1, [1, 2]);
    await addReview(store, 10);
    await store.upsertWord(word('knyga'), 1, NOW.toISOString());
    await store.createSession({
      slot: 'new', portionId: null, startedAt: '2026-11-03T07:00:00.000Z', finishedAt: '2026-11-03T07:15:00.000Z',
      items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0,
    });
    const plan = await planSession(store, NOW, DAY);
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan.slot).toBe('review');
    expect(plan.items.filter((i) => i.type === 'word')).toHaveLength(1);
    expect(plan.items.filter((i) => i.type === 'task')).toHaveLength(8);
  });

  it('allows a second new portion on request, but not a third', async () => {
    await seedLesson(store, 1, [1, 2, 3]);
    const mk = (h: number) =>
      store.createSession({
        slot: 'new', portionId: null, startedAt: `2026-11-03T0${h}:00:00.000Z`, finishedAt: `2026-11-03T0${h}:10:00.000Z`,
        items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0,
      });
    await mk(5);
    const second = await planSession(store, NOW, DAY, { preferNew: true });
    expect('empty' in second ? null : second.slot).toBe('new');
    await mk(6);
    const third = await planSession(store, NOW, DAY, { preferNew: true });
    expect('empty' in third ? 'empty' : third.slot).not.toBe('new');
  });

  it('puts tasks with weak tags first in review', async () => {
    await addReview(store, 10, { tags: ['ok'] });
    const [weak] = await addReview(store, 1, { tags: ['case:gen'] });
    await answer(store, 1, false, ['case:gen']);
    await store.createSession({
      slot: 'new', portionId: null, startedAt: '2026-11-03T07:00:00.000Z', finishedAt: null,
      items: [], cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0,
    });
    const plan = await planSession(store, NOW, DAY);
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan.items[0]).toEqual({ type: 'task', taskId: weak.id });
  });

  it('advances to the next lesson when the current one is done well', async () => {
    await store.upsertLessons([1, 2].map((no) => ({ no, title: `L${no}`, grammar: '', topic: '', skill: '', words: [] })));
    await seedLesson(store, 1, [1]);
    await store.markPortionServed((await store.nextPortion(1))!.id, NOW.toISOString());
    for (let i = 0; i < 10; i++) await answer(store, 1, i < 8);
    await seedLesson(store, 2, [1]);
    const plan = await planSession(store, NOW, DAY);
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan.portion?.lessonNo).toBe(2);
    expect(await getProgress(store)).toEqual({ lessonNo: 2, revisions: 0 });
  });

  it('revises the lesson when accuracy is low', async () => {
    await seedLesson(store, 1, [1]);
    await store.markPortionServed((await store.nextPortion(1))!.id, NOW.toISOString());
    for (let i = 0; i < 10; i++) await answer(store, 1, i < 3);
    await addReview(store, 4, { lessonNo: 1 });
    const plan = await planSession(store, NOW, DAY);
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan).toMatchObject({ slot: 'new', revision: true, portion: null });
    expect(plan.items).toHaveLength(4);
    expect(await getProgress(store)).toEqual({ lessonNo: 1, revisions: 1 });
  });

  it('reports an empty bank instead of an empty session', async () => {
    const plan = await planSession(store, NOW, DAY);
    expect(plan).toEqual({ empty: expect.stringContaining('урока 1') });
  });

  it('adds a writing task to review every few days', async () => {
    await addReview(store, 3);
    const [w] = await store.addTasks([{ payload: { kind: 'writing', lessonNo: 1, slot: 'review', tags: [], unverified: [], prompt: 'Parašykite', minWords: 30, maxWords: 50 }, portionId: null }], NOW.toISOString());
    const plan = await planSession(store, NOW, DAY, { forceReview: true });
    if ('empty' in plan) throw new Error(plan.empty);
    expect(plan.items.at(-1)).toEqual({ type: 'task', taskId: w.id });
  });
});

describe('weakTags and bankStatus', () => {
  it('counts wrong-answer tags', async () => {
    const store = createMemoryStore();
    await answer(store, 1, false, ['a', 'b']);
    await answer(store, 1, false, ['a']);
    await answer(store, 1, true, ['c']);
    expect(await weakTags(store, NOW, 14)).toEqual([{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }]);
  });
  it('estimates days of material left', async () => {
    const store = createMemoryStore();
    await seedLesson(store, 1, [1, 2, 3]);
    await addReview(store, 16);
    expect(await bankStatus(store)).toMatchObject({ portionsReady: 3, reviewReady: 16, days: 2 });
  });
});
