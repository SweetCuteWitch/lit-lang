import { describe, expect, it } from 'vitest';
import { nextTaskScore, tagClass, tagStats, taskAfterAnswer, taskDueAt, taskWeight, type TagStat } from '../../src/learn/mastery';
import { createMemoryStore } from '../../src/store/memory';

const stat = (over: Partial<TagStat>): TagStat => ({ tag: 't', answers: 0, wrong: 0, wrong7: 0, accuracy: 1, ...over });

describe('nextTaskScore', () => {
  it('raises on exact correct, caps, keeps on inexact, resets on wrong', () => {
    expect(nextTaskScore(0, { correct: true, exact: true })).toBe(1);
    expect(nextTaskScore(5, { correct: true, exact: true })).toBe(5);
    expect(nextTaskScore(3, { correct: true, exact: false })).toBe(3);
    expect(nextTaskScore(4, { correct: false, exact: false })).toBe(0);
  });
});

describe('taskDueAt', () => {
  it('is local Vilnius midnight after the interval', () => {
    const now = new Date('2026-11-03T20:00:00Z');
    expect(taskDueAt(0, now)).toBe('2026-11-03T22:00:00.000Z');
    expect(taskDueAt(1, now)).toBe('2026-11-05T22:00:00.000Z');
  });
});

describe('taskAfterAnswer', () => {
  const now = new Date('2026-11-03T20:00:00Z');
  it('never brings a correct answer back the next day', () => {
    expect(taskAfterAnswer(0, { correct: true, exact: false }, now)).toEqual({ score: 0, dueAt: taskDueAt(1, now) });
    expect(taskAfterAnswer(0, { correct: true, exact: true }, now)).toEqual({ score: 1, dueAt: taskDueAt(1, now) });
    expect(taskAfterAnswer(3, { correct: true, exact: false }, now)).toEqual({ score: 3, dueAt: taskDueAt(3, now) });
  });
  it('a wrong answer resets and is due the next day', () => {
    expect(taskAfterAnswer(4, { correct: false, exact: false }, now)).toEqual({ score: 0, dueAt: taskDueAt(0, now) });
  });
});

describe('tagClass', () => {
  it('classifies tags', () => {
    expect(tagClass(stat({ answers: 4, wrong: 3, accuracy: 0.25 }))).toBe('weak');
    expect(tagClass(stat({ answers: 3, wrong: 1, accuracy: 0.66 }))).toBe('weak');
    expect(tagClass(stat({ answers: 5, wrong: 0, wrong7: 0, accuracy: 1 }))).toBe('mastered');
    expect(tagClass(stat({ answers: 10, wrong: 1, wrong7: 1, accuracy: 0.9 }))).toBe('normal');
    expect(tagClass(undefined)).toBe('normal');
  });
});

describe('taskWeight', () => {
  const stats = new Map<string, TagStat>([
    ['weak', stat({ tag: 'weak', answers: 4, wrong: 3, accuracy: 0.25 })],
    ['good', stat({ tag: 'good', answers: 5, accuracy: 1 })],
  ]);
  it('weights by score and tag class', () => {
    expect(taskWeight({ score: 0, tags: ['weak'] }, stats)).toBe(18);
    expect(taskWeight({ score: 5, tags: ['good'] }, stats)).toBeCloseTo(0.3);
    expect(taskWeight({ score: 2, tags: ['weak', 'good'] }, stats)).toBe(12);
    expect(taskWeight({ score: 2, tags: ['other'] }, stats)).toBe(4);
  });
});

describe('tagStats', () => {
  it('counts answers, wrong and wrong in the last 7 days', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-11-10T08:00:00Z');
    const add = (correct: boolean, daysAgo: number) =>
      store.addAnswer({ kind: 'task', taskId: null, wordId: null, sessionId: null, answer: 'x', correct, exact: correct, tags: ['a'], lessonNo: 1, createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });
    await add(false, 8);
    await add(false, 1);
    await add(true, 1);
    const s = (await tagStats(store, now)).get('a')!;
    expect(s).toMatchObject({ tag: 'a', answers: 3, wrong: 2, wrong7: 1 });
    expect(s.accuracy).toBeCloseTo(1 / 3);
  });
});
