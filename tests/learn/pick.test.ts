import { describe, expect, it } from 'vitest';
import { rotatingCandidates, spreadByRecipe, weightedSample } from '../../src/learn/pick';
import type { Task } from '../../src/store/types';
import { choiceTask } from '../store/contract';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const YESTERDAY = '2026-11-02T08:00:00.000Z';
const TOMORROW = '2026-11-04T08:00:00.000Z';

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`, kind: 'choice', lessonNo: 1, portionId: null, slot: 'review', payload: choiceTask(), tags: ['t'],
  status: 'ready', createdAt: YESTERDAY, score: 0, dueAt: null, recipeId: null, variantKey: null, ...over,
});

describe('weightedSample', () => {
  it('returns k distinct items and never takes zero weight', () => {
    const items = ['a', 'b', 'c', 'd', 'zero'];
    let i = 0;
    const rand = () => [0.9, 0.1, 0.5, 0.7, 0.99][i++ % 5]!;
    const got = weightedSample(items, (x) => (x === 'zero' ? 0 : 1), 3, rand);
    expect(got).toHaveLength(3);
    expect(new Set(got).size).toBe(3);
    expect(got).not.toContain('zero');
    expect(weightedSample(items, (x) => (x === 'zero' ? 0 : 1), 10, Math.random)).toHaveLength(4);
  });

  it('picks the heavy item first almost always', () => {
    let first = 0;
    for (let n = 0; n < 1000; n++) if (weightedSample(['heavy', 'light'], (x) => (x === 'heavy' ? 18 : 0.3), 1, Math.random)[0] === 'heavy') first++;
    expect(first).toBeGreaterThanOrEqual(950);
  });
});

describe('rotatingCandidates', () => {
  it('keeps due rotating tasks only', () => {
    const served = task({ slot: 'new', status: 'served', dueAt: null });
    const due = task({ status: 'served', dueAt: YESTERDAY });
    const fresh = task();
    const list = [
      served, due, fresh,
      task({ status: 'retired' }),
      task({ kind: 'writing' }),
      task({ slot: 'new', status: 'ready' }),
      task({ status: 'served', dueAt: TOMORROW }),
      task({ lessonNo: 2 }),
    ];
    expect(rotatingCandidates(list, NOW, 1).map((t) => t.id)).toEqual([served.id, due.id, fresh.id]);
  });

  it('limits to one lesson when asked', () => {
    const l1 = task({ lessonNo: 1 });
    const l2 = task({ lessonNo: 2 });
    expect(rotatingCandidates([l1, l2], NOW, 2, 2)).toEqual([l2]);
  });
});

describe('spreadByRecipe', () => {
  it('avoids three tasks of one recipe in a row', () => {
    const list = ['r1', 'r1', 'r1', 'x'].map((r) => task({ recipeId: r }));
    const ids = spreadByRecipe(list).map((t) => t.recipeId);
    expect(ids).toHaveLength(4);
    expect(ids.join(',')).not.toContain('r1,r1,r1');
  });

  const noTriple = (out: Task[]) =>
    out.every((t, i) => i < 2 || !t.recipeId || t.recipeId !== out[i - 1]!.recipeId || t.recipeId !== out[i - 2]!.recipeId);
  const sameSet = (out: Task[], input: Task[]) => expect([...out].sort((p, q) => p.id.localeCompare(q.id))).toEqual([...input].sort((p, q) => p.id.localeCompare(q.id)));

  it('spreads a recipe block that comes after other tasks', () => {
    const list = [task({ recipeId: 'x' }), task({ recipeId: 'y' }), ...['a', 'a', 'a', 'a'].map((r) => task({ recipeId: r }))];
    const out = spreadByRecipe(list);
    sameSet(out, list);
    expect(noTriple(out)).toBe(true);
  });

  it('spreads recipe tasks appended after tasks without a recipe', () => {
    const list = [...Array.from({ length: 6 }, () => task()), ...Array.from({ length: 4 }, () => task({ recipeId: 'r' }))];
    const out = spreadByRecipe(list);
    sameSet(out, list);
    expect(noTriple(out)).toBe(true);
  });

  it('returns every task even when a triple is unavoidable', () => {
    const list = ['a', 'a', 'a', 'a'].map((r) => task({ recipeId: r }));
    sameSet(spreadByRecipe(list), list);
  });
});
