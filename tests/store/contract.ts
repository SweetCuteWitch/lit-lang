import { beforeEach, expect, it } from 'vitest';
import type { TaskInput } from '../../src/tasks/schema';
import type { Store, WordInput } from '../../src/store/types';

export const choiceTask = (over: Partial<TaskInput> = {}): TaskInput =>
  ({
    kind: 'choice', lessonNo: 1, slot: 'review', tags: ['t'], unverified: [],
    question: 'Labas?', options: ['a', 'b'], correct: 0, explanation: '', ...over,
  }) as TaskInput;

export const word = (lemma: string, over: Partial<WordInput> = {}): WordInput => ({
  lemma, translation: lemma.toUpperCase(), pos: 'noun', gender: 'f', keyForms: [lemma], example: null, verified: true, ...over,
});

const T0 = '2026-11-03T08:00:00.000Z';
const T1 = '2026-11-03T09:00:00.000Z';
const T2 = '2026-11-04T09:00:00.000Z';

export function storeContract(makeStore: () => Store | Promise<Store>) {
  let store: Store;
  beforeEach(async () => {
    store = await makeStore();
  });

  it('stores settings as JSON', async () => {
    expect(await store.getSetting('progress')).toBeNull();
    await store.setSetting('progress', { lessonNo: 2 });
    await store.setSetting('progress', { lessonNo: 3 });
    expect(await store.getSetting('progress')).toEqual({ lessonNo: 3 });
  });

  it('upserts lessons and lists them in order', async () => {
    await store.upsertLessons([
      { no: 2, title: 'B', grammar: 'g', topic: 't', skill: 's', words: ['x'] },
      { no: 1, title: 'A', grammar: 'g', topic: 't', skill: 's', words: [] },
    ]);
    await store.upsertLessons([{ no: 2, title: 'B2', grammar: 'g', topic: 't', skill: 's', words: ['y'] }]);
    expect((await store.listLessons()).map((l) => l.title)).toEqual(['A', 'B2']);
    expect((await store.getLesson(2))?.words).toEqual(['y']);
    expect(await store.getLesson(9)).toBeNull();
  });

  it('serves portions in seq order and rejects duplicates', async () => {
    const p2 = await store.addPortion({ lessonNo: 1, seq: 2, theory: 'two', words: [] });
    const p1 = await store.addPortion({ lessonNo: 1, seq: 1, theory: 'one', words: [word('knyga')] });
    await expect(store.addPortion({ lessonNo: 1, seq: 1, theory: 'dup', words: [] })).rejects.toThrow();
    expect((await store.nextPortion(1))?.id).toBe(p1.id);
    await store.markPortionServed(p1.id, T0);
    expect((await store.getPortion(p1.id))?.status).toBe('served');
    expect((await store.nextPortion(1))?.id).toBe(p2.id);
    expect(await store.nextPortion(2)).toBeNull();
    expect((await store.listPortions(1)).map((p) => p.seq)).toEqual([1, 2]);
    expect((await store.getPortion(p1.id))?.words[0].lemma).toBe('knyga');
  });

  it('upserts words keeping their review box', async () => {
    const w = await store.upsertWord(word('knyga'), 1, T0);
    expect(w).toMatchObject({ lemma: 'knyga', box: 0, dueAt: T0, lessonNo: 1 });
    await store.updateWordBox(w.id, 3, T2);
    const again = await store.upsertWord(word('knyga', { translation: 'книга' }), 2, T1);
    expect(again).toMatchObject({ id: w.id, box: 3, dueAt: T2, translation: 'книга', lessonNo: 1 });
    await store.upsertWord(word('namas'), 1, T0);
    expect((await store.dueWords(T1, 10)).map((x) => x.lemma)).toEqual(['namas']);
    expect((await store.listWords()).length).toBe(2);
  });

  it('adds, filters and updates tasks', async () => {
    const p = await store.addPortion({ lessonNo: 1, seq: 1, theory: 't', words: [] });
    const [a, b] = await store.addTasks(
      [
        { payload: choiceTask({ slot: 'new', portionKey: '1.1' }), portionId: p.id },
        { payload: choiceTask({ lessonNo: 2, tags: ['x', 'y'] }), portionId: null },
      ],
      T0,
    );
    expect(a).toMatchObject({ kind: 'choice', slot: 'new', portionId: p.id, status: 'ready', lessonNo: 1 });
    expect(b.tags).toEqual(['x', 'y']);
    expect((await store.listTasks({ portionId: p.id })).map((t) => t.id)).toEqual([a.id]);
    expect((await store.listTasks({ slot: 'review', status: 'ready' })).map((t) => t.id)).toEqual([b.id]);
    await store.setTaskStatus([a.id, b.id], 'served');
    expect(await store.listTasks({ status: 'ready' })).toEqual([]);
    expect((await store.listTasks({ limit: 1 })).length).toBe(1);
    await store.updateTaskPayload(b.id, choiceTask({ question: 'Changed?' }));
    expect(((await store.getTask(b.id))?.payload as { question: string }).question).toBe('Changed?');
  });

  it('tracks the active session', async () => {
    expect(await store.activeSession()).toBeNull();
    const s = await store.createSession({
      slot: 'new', portionId: null, startedAt: T0, finishedAt: null, items: [{ type: 'word', wordId: 'w' }],
      cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0,
    });
    expect((await store.activeSession())?.id).toBe(s.id);
    await store.updateSession(s.id, { cursor: 1, messageIds: [5, 6], state: { picked: [1] }, lastUpdateId: 42 });
    expect(await store.getSession(s.id)).toMatchObject({ cursor: 1, messageIds: [5, 6], state: { picked: [1] }, lastUpdateId: 42 });
    await store.updateSession(s.id, { finishedAt: T1 });
    expect(await store.activeSession()).toBeNull();
    expect((await store.listSessions(T0)).length).toBe(1);
    expect((await store.listSessions(T2)).length).toBe(0);
  });

  it('records and filters answers', async () => {
    const base = { taskId: null, wordId: null, sessionId: null, exact: true, tags: ['case:gen'], lessonNo: 1 };
    const a1 = await store.addAnswer({ ...base, kind: 'task', answer: 'x', correct: false, createdAt: T0 });
    const w = await store.addAnswer({ ...base, kind: 'writing', answer: 'Labas', correct: null, createdAt: T1 });
    expect((await store.listAnswers({ kind: 'task' })).map((a) => a.id)).toEqual([a1.id]);
    expect((await store.listAnswers({ pendingReview: true })).map((a) => a.id)).toEqual([w.id]);
    expect((await store.listAnswers({ since: T1 })).map((a) => a.id)).toEqual([w.id]);
    expect((await store.listAnswers({})).map((a) => a.id)).toEqual([w.id, a1.id]);
    await store.updateAnswer(a1.id, { disputed: true, correct: true });
    expect((await store.listAnswers({ pendingDispute: true })).map((a) => a.id)).toEqual([a1.id]);
    await store.updateAnswer(a1.id, { disputeNote: 'ok' });
    expect(await store.listAnswers({ pendingDispute: true })).toEqual([]);
    await store.updateAnswer(w.id, { review: 'good', reviewedAt: T2 });
    expect(await store.listAnswers({ pendingReview: true })).toEqual([]);
    expect((await store.getAnswer(w.id))?.review).toBe('good');
  });
}
