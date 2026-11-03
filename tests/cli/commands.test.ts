import { beforeEach, describe, expect, it } from 'vitest';
import { runCommand, type CliDeps } from '../../cli/commands';
import { createMemoryStore } from '../../src/store/memory';
import type { Store } from '../../src/store/types';
import { createFakeTelegram } from '../helpers/fake-telegram';
import { fixtureLexicon } from '../helpers/fixture-lexicon';

describe('cli', () => {
  let store: Store;
  let tg: ReturnType<typeof createFakeTelegram>;
  let out: string[];
  let files: Record<string, unknown>;
  let deps: CliDeps;
  const run = (...argv: string[]) => runCommand(argv, deps);

  beforeEach(async () => {
    store = createMemoryStore();
    tg = createFakeTelegram();
    out = [];
    files = {};
    deps = {
      store, api: tg.api, chatId: 1, now: () => new Date('2026-11-03T10:00:00Z'), lex: () => fixtureLexicon,
      out: (l) => { out.push(l); }, readFile: (p) => JSON.stringify(files[p]),
    };
    await store.upsertLessons([{ no: 1, title: 'Aš gyvenu', grammar: 'būti, gyventi', topic: 'знакомство', skill: 'grammar', words: ['būti'] }]);
  });

  it('adds a portion with lexicon word data and its tasks; rejects broken tasks', async () => {
    files['b.json'] = {
      portions: [{ lessonNo: 1, seq: 1, theory: '<b>gyventi</b> — жить', words: [{ lemma: 'gyventi', translation: 'жить' }, { lemma: 'namas', translation: 'дом' }] }],
      tasks: [
        { kind: 'input', lessonNo: 1, slot: 'new', portionKey: '1.1', tags: ['verb:pres'], question: 'Aš ___ (gyventi) Vilniuje.', accept: ['gyvenu'], target: { lemma: 'gyventi', key: 'pres.1sg' } },
        { kind: 'input', lessonNo: 1, slot: 'new', portionKey: '1.1', tags: [], question: 'Aš ___ (gyventi).', accept: ['gyvenuo'] },
        { kind: 'audio' },
      ],
    };
    expect(await run('bank', 'add', '--file', 'b.json')).toBe(1);
    expect(out.join('\n')).toContain('✓ порция 1.1: 2 слов');
    expect(out.join('\n')).toContain('✗ задание #1 (input): нет в лексиконе: gyvenuo');
    expect(out.join('\n')).toContain('✗ задание #2');
    expect(out.at(-1)).toContain('Сохранено заданий: 1');
    const [p] = await store.listPortions(1);
    expect(p.words[0]).toMatchObject({ lemma: 'gyventi', pos: 'verb', keyForms: ['gyventi', 'gyvena', 'gyveno'], verified: true });
    expect(p.words[1]).toMatchObject({ lemma: 'namas', gender: 'm', keyForms: ['namas', 'namo', 'namą'] });
    expect((await store.listTasks({ portionId: p.id })).length).toBe(1);
  });

  it('requires pos and forms for words outside the lexicon', async () => {
    files['b.json'] = { portions: [{ lessonNo: 1, seq: 1, theory: 'x', words: [{ lemma: 'kompiuteris', translation: 'компьютер' }] }] };
    expect(await run('bank', 'add', '--file', 'b.json')).toBe(1);
    expect(out[0]).toContain('укажите pos и keyForms');
  });

  it('prints forms and status', async () => {
    expect(await run('inflect', 'gyventi')).toBe(0);
    expect(out.join('\n')).toContain('pres.1sg=gyvenu');
    out.length = 0;
    await run('status');
    expect(out[0]).toContain('Урок: 1/1 «Aš gyvenu»');
    expect(out.join('\n')).toContain('МАЛО');
  });

  it('reviews writing and resolves disputes, notifying the user', async () => {
    const w = await store.addAnswer({ kind: 'writing', taskId: null, wordId: null, sessionId: null, answer: 'Labas', correct: null, exact: false, tags: [], lessonNo: 1 });
    const [task] = await store.addTasks([{ payload: { kind: 'input', lessonNo: 1, slot: 'review', tags: [], unverified: [], question: 'q', accept: ['a'], reject: [], explanation: '' }, portionId: null }], 'x');
    const d = await store.addAnswer({ kind: 'task', taskId: task.id, wordId: null, sessionId: null, answer: 'b', correct: false, exact: false, tags: [], lessonNo: 1 });
    await store.updateAnswer(d.id, { disputed: true, correct: true });

    await run('writing', 'pending');
    expect(out.join('\n')).toContain(`answerId=${w.id}`);
    files['r.json'] = [{ answerId: w.id, review: '<b>Gerai!</b> Без ошибок.' }];
    expect(await run('writing', 'review', '--file', 'r.json')).toBe(0);
    expect(tg.last().text).toContain('Разбор письма');
    expect(await store.listAnswers({ pendingReview: true })).toEqual([]);

    files['d.json'] = [{ answerId: d.id, verdict: 'correct', note: 'Тоже верно' }];
    expect(await run('disputes', 'resolve', '--file', 'd.json')).toBe(0);
    expect(((await store.getTask(task.id))!.payload as { accept: string[] }).accept).toEqual(['a', 'b']);
    expect(tg.last().text).toContain('Спорный ответ засчитан');
  });

  it('creates topics', async () => {
    await run('topics', 'setup');
    expect(tg.topics).toEqual(['📚 Уроки', '✏️ Тренировка', '📖 Словарь', '📝 Письмо']);
    expect(await store.getSetting('topics')).toEqual({ lessons: 11, training: 12, vocab: 13, writing: 14 });
  });

  it('prints usage for unknown commands', async () => {
    expect(await run('nope')).toBe(2);
    expect(out[0]).toContain('Команды:');
  });
});
