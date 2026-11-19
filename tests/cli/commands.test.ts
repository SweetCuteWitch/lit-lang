import { beforeEach, describe, expect, it } from 'vitest';
import { runCommand, type CliDeps } from '../../cli/commands';
import { taskDueAt } from '../../src/learn/mastery';
import { setProgress } from '../../src/learn/progress';
import { createMemoryStore } from '../../src/store/memory';
import type { Store } from '../../src/store/types';
import { taskFromVariant } from '../../src/tasks/from-variant';
import { expandRecipe, RecipeInput } from '../../src/tasks/recipe';
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

  const buti = (frames: { lt: string; key: string }[]) => ({
    name: 'buti', kind: 'form', lessonNo: 2, tags: ['verb:būti'], explanation: 'Спряжение būti.', frames, words: ['būti'], present: ['input'],
  });
  const F0 = { lt: 'Aš ___ studentas.', key: 'pres.1sg' };
  const F1 = { lt: 'Jos ___ mano draugės.', key: 'pres.3' };
  const F2 = { lt: 'Jos ___ draugės.', key: 'past.3' };
  /** Materializes every variant of the recipe as a task, like the planner does. */
  const materialize = async (name: string) => {
    const r = (await store.getRecipe(name))!;
    return store.addTasks(r.variants.map((v) => ({
      payload: taskFromVariant({ lessonNo: r.lessonNo, tags: r.tags, explanation: (r.payload as { explanation: string }).explanation }, v, 'input'), portionId: null, recipeId: r.id, variantKey: v.key,
    })), '2026-11-01T00:00:00Z');
  };
  const byKey = async (recipeId: string) => new Map((await store.listTasks({ recipeId })).map((t) => [t.variantKey, t]));

  describe('recipes', () => {
    beforeEach(async () => {
      await store.upsertLessons([{ no: 2, title: 'Aš esu studentas', grammar: 'būti', topic: 'учёба', skill: 'grammar', words: ['studentas', 'draugė'] }]);
    });

    it('adds a recipe in bank add and rejects broken ones', async () => {
      files['b.json'] = { recipes: [buti([F0, F1, F2]), { name: 'Bad Name' }, buti([{ lt: 'Aš esu iš ___.', key: 'gen.sg' }])] };
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(1);
      const text = out.join('\n');
      expect(text).toContain('✓ рецепт buti (урок 2): 3 вариантов');
      expect(text).toContain('✗ рецепт #1');
      expect(text).toContain('✗ рецепт #2');
      const recipes = await store.listRecipes();
      expect(recipes).toHaveLength(1);
      expect(recipes[0]!.variants.map((v) => v.key)).toEqual(['0#būti', '1#būti', '2#būti']);
      expect(recipes[0]!.payload).toMatchObject({ name: 'buti', explanation: 'Спряжение būti.' });
    });

    it('counts words of portions from the same file as known', async () => {
      files['b.json'] = {
        portions: [{ lessonNo: 3, seq: 1, theory: 'x', words: [{ lemma: 'namas', translation: 'дом' }] }],
        recipes: [{ ...buti([{ lt: 'Aš ___ namas.', key: 'pres.1sg' }]), lessonNo: 3 }],
      };
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      expect(out.join('\n')).toContain('✓ рецепт buti (урок 3): 1 вариантов');
    });

    it('replacing a recipe retires gone variants, rebuilds changed ones and keeps the rest', async () => {
      files['b.json'] = { recipes: [buti([F0, F1, F2])] };
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      const recipe = (await store.getRecipe('buti'))!;
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 3, '2026-12-01T00:00:00Z');

      files['b2.json'] = { recipes: [buti([{ lt: 'Aš ___ studentas.', key: 'past.1sg' }, F1])] };
      expect(await run('bank', 'add', '--file', 'b2.json')).toBe(0);
      expect((await store.getRecipe('buti'))!.id).toBe(recipe.id);
      const after = await byKey(recipe.id);
      expect(after.get('2#būti')!.status).toBe('retired');
      const changed = after.get('0#būti')!;
      expect(changed.status).toBe('ready');
      expect(changed.score).toBe(0);
      expect(changed.dueAt).toBe('2026-11-03T10:00:00.000Z');
      expect(changed.payload).toMatchObject({ kind: 'input', accept: ['buvau'] });
      expect(after.get('1#būti')).toMatchObject({ status: 'ready', score: 3, dueAt: '2026-12-01T00:00:00Z' });

      out.length = 0;
      await run('recipes', 'list');
      expect(out.join('\n')).toContain('buti\tурок 2\tverb:būti\tиспользовано 2 из 2 вариантов');
    });

    it('a fixed frame with the same answer updates the payload and keeps the score', async () => {
      files['b.json'] = { recipes: [buti([F0, F1])] };
      await run('bank', 'add', '--file', 'b.json');
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 3, '2026-12-01T00:00:00Z');
      out.length = 0;
      files['b2.json'] = { recipes: [buti([{ lt: 'Aš ___ geras studentas.', key: 'pres.1sg' }, F1])] };
      await store.upsertLessons([{ no: 2, title: 'Aš esu studentas', grammar: 'būti', topic: 'учёба', skill: 'grammar', words: ['studentas', 'draugė', 'geras'] }]);
      expect(await run('bank', 'add', '--file', 'b2.json')).toBe(0);
      expect(out).toContain('  обновлено: 1, сброшено: 0, возвращено: 0, снято: 0');
      const after = await byKey((await store.getRecipe('buti'))!.id);
      expect(after.get('0#būti')).toMatchObject({ status: 'ready', score: 3, dueAt: '2026-12-01T00:00:00Z' });
      expect(after.get('0#būti')!.payload).toMatchObject({ question: 'Aš ___ geras studentas. (būti)', accept: ['esu'] });
      expect(after.get('1#būti')).toMatchObject({ score: 3, payload: tasks[1]!.payload });
    });

    it('re-adding an identical recipe changes nothing', async () => {
      files['b.json'] = { recipes: [buti([F0, F1])] };
      await run('bank', 'add', '--file', 'b.json');
      const id = (await store.getRecipe('buti'))!.id;
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 3, '2026-12-01T00:00:00Z');
      const before = await store.listTasks({ recipeId: id });
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      expect(out).toEqual(['Сохранено заданий: 0, отклонено: 0', '✓ рецепт buti (урок 2): 2 вариантов']);
      expect(await store.listTasks({ recipeId: id })).toEqual(before);
    });

    it('a re-run converges after a run that saved the recipe but not the tasks', async () => {
      files['b.json'] = { recipes: [buti([F0, F1, F2])] };
      await run('bank', 'add', '--file', 'b.json');
      const recipe = (await store.getRecipe('buti'))!;
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 3, '2026-12-01T00:00:00Z');
      // A partial run of the old order: the new variants are saved, then it fails before touching tasks.
      const next = RecipeInput.parse(buti([{ lt: 'Aš ___ studentas.', key: 'past.1sg' }, F1]));
      const { variants } = expandRecipe(next, { lex: fixtureLexicon, known: () => new Set(['būti', 'studentas', 'draugė']) });
      await store.upsertRecipe({ name: 'buti', kind: 'form', lessonNo: 2, tags: next.tags, payload: next, variants }, '2026-11-03T10:00:00Z');

      files['b2.json'] = { recipes: [next] };
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b2.json')).toBe(0);
      expect(out).toContain('  обновлено: 0, сброшено: 1, возвращено: 0, снято: 1');
      const after = await byKey(recipe.id);
      expect(after.get('0#būti')).toMatchObject({ status: 'ready', score: 0, dueAt: '2026-11-03T10:00:00.000Z', payload: { accept: ['buvau'] } });
      expect(after.get('1#būti')).toMatchObject({ status: 'ready', score: 3 });
      expect(after.get('2#būti')!.status).toBe('retired');
    });

    it('a re-run converges after a run that updated the tasks but failed to save the recipe', async () => {
      files['b.json'] = { recipes: [buti([F0, F1, F2])] };
      await run('bank', 'add', '--file', 'b.json');
      const recipe = (await store.getRecipe('buti'))!;
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 3, '2026-12-01T00:00:00Z');
      const upsert = store.upsertRecipe.bind(store);
      store.upsertRecipe = async () => { throw new Error('network'); };
      files['b2.json'] = { recipes: [buti([{ lt: 'Aš ___ studentas.', key: 'past.1sg' }, F1])] };
      await expect(run('bank', 'add', '--file', 'b2.json')).rejects.toThrow('network');
      expect((await store.getRecipe('buti'))!.variants).toHaveLength(3);
      const half = await byKey(recipe.id);
      expect(half.get('0#būti')).toMatchObject({ score: 0, payload: { accept: ['buvau'] } });

      store.upsertRecipe = upsert;
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b2.json')).toBe(0);
      expect(out).toEqual(['Сохранено заданий: 0, отклонено: 0', '✓ рецепт buti (урок 2): 2 вариантов']);
      expect((await store.getRecipe('buti'))!.variants.map((v) => v.key)).toEqual(['0#būti', '1#būti']);
      expect(await byKey(recipe.id)).toEqual(half);
    });

    it('re-adding an identical choice recipe changes nothing although options are shuffled', async () => {
      files['b.json'] = { recipes: [{ ...buti([F0, F1]), present: ['choice'] }] };
      await run('bank', 'add', '--file', 'b.json');
      const r = (await store.getRecipe('buti'))!;
      await store.addTasks(r.variants.map((v) => ({
        payload: taskFromVariant({ lessonNo: r.lessonNo, tags: r.tags, explanation: 'Спряжение būti.' }, v, 'choice', () => 0.99),
        portionId: null, recipeId: r.id, variantKey: v.key,
      })), '2026-11-01T00:00:00Z');
      const before = await store.listTasks({ recipeId: r.id });
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      expect(out).toEqual(['Сохранено заданий: 0, отклонено: 0', '✓ рецепт buti (урок 2): 2 вариантов']);
      expect(await store.listTasks({ recipeId: r.id })).toEqual(before);
    });

    it('a rebuild drops a dispute-added accept and keeps the score while the answer is the same', async () => {
      files['b.json'] = { recipes: [buti([F0, F1])] };
      await run('bank', 'add', '--file', 'b.json');
      const [t0] = await materialize('buti');
      await store.updateTaskPayload(t0!.id, { ...(t0!.payload as Extract<typeof t0.payload, { kind: 'input' }>), accept: ['esu', 'esu!'] });
      await store.updateTaskScore(t0!.id, 3, '2026-12-01T00:00:00Z');
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      expect(out).toContain('  обновлено: 1, сброшено: 0, возвращено: 0, снято: 0');
      expect(await store.getTask(t0!.id)).toMatchObject({ score: 3, payload: { accept: ['esu'] } });
    });

    it('re-adding a retired recipe brings its tasks back with score 0', async () => {
      files['b.json'] = { recipes: [buti([F0, F1])] };
      await run('bank', 'add', '--file', 'b.json');
      const tasks = await materialize('buti');
      for (const t of tasks) await store.updateTaskScore(t.id, 4, '2026-12-01T00:00:00Z');
      await run('recipes', 'retire', 'buti');
      out.length = 0;
      expect(await run('bank', 'add', '--file', 'b.json')).toBe(0);
      expect(out).toContain('  обновлено: 0, сброшено: 0, возвращено: 2, снято: 0');
      for (const t of tasks) {
        expect(await store.getTask(t.id)).toMatchObject({ status: 'ready', score: 0, dueAt: '2026-11-03T10:00:00.000Z' });
      }
    });

    it('recipes retire retires every task and empties the variants', async () => {
      files['b.json'] = { recipes: [buti([F0, F1])] };
      await run('bank', 'add', '--file', 'b.json');
      const tasks = await materialize('buti');
      expect(await run('recipes', 'retire', 'buti')).toBe(0);
      for (const t of tasks) expect((await store.getTask(t.id))!.status).toBe('retired');
      expect((await store.getRecipe('buti'))!.variants).toEqual([]);
      out.length = 0;
      expect(await run('recipes', 'retire', 'nope')).toBe(1);
      expect(out).toEqual(['✗ рецепта nope нет']);
    });

    it('status shows rotation, recipes and topic classes', async () => {
      files['b.json'] = { recipes: [buti([F0, F1, F2])] };
      await run('bank', 'add', '--file', 'b.json');
      await setProgress(store, { lessonNo: 2, revisions: 0 });
      const [t] = await materialize('buti');
      await store.updateTaskScore(t!.id, 2, '2026-12-01T00:00:00Z');
      for (let i = 0; i < 3; i++) {
        await store.addAnswer({ kind: 'task', taskId: t!.id, wordId: null, sessionId: null, answer: 'x', correct: false, exact: false, tags: ['verb:būti'], lessonNo: 2 });
      }
      out.length = 0;
      await run('status');
      const text = out.join('\n');
      expect(text).toContain('Запас: ~0 дн. нового материала (порций: 0');
      expect(text).toContain('В обороте: 3 заданий, к показу сейчас: 2; по score 0–5: 2/0/1/0/0/0');
      expect(text).toContain('Рецепты: 1 (неиспользованных вариантов: 0)');
      expect(text).toContain('Слабые темы: verb:būti');
      expect(text).toContain('Освоенные темы: нет');
    });
  });

  it('disputes: wrong resets the task score, retireTask retires it', async () => {
    const [task] = await store.addTasks([{ payload: { kind: 'input', lessonNo: 1, slot: 'review', tags: [], unverified: [], question: 'q', accept: ['a'], reject: [], explanation: '' }, portionId: null }], 'x');
    await store.updateTaskScore(task!.id, 4, '2026-12-01T00:00:00Z');
    const dispute = async () => {
      const d = await store.addAnswer({ kind: 'task', taskId: task!.id, wordId: null, sessionId: null, answer: 'b', correct: true, exact: false, tags: [], lessonNo: 1 });
      await store.updateAnswer(d.id, { disputed: true });
      return d;
    };
    const d1 = await dispute();
    files['d.json'] = [{ answerId: d1.id, verdict: 'wrong', note: 'Нет' }];
    expect(await run('disputes', 'resolve', '--file', 'd.json')).toBe(0);
    expect(await store.getTask(task!.id)).toMatchObject({ score: 0, status: 'ready', dueAt: taskDueAt(0, new Date('2026-11-03T10:00:00Z')) });

    const d2 = await dispute();
    files['d.json'] = [{ answerId: d2.id, verdict: 'correct', note: 'Да', retireTask: true }];
    expect(await run('disputes', 'resolve', '--file', 'd.json')).toBe(0);
    expect((await store.getTask(task!.id))!.status).toBe('retired');
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
