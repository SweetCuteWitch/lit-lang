import { describe, expect, it } from 'vitest';
import { taskFromVariant, type Variant } from '../../src/tasks/from-variant';
import { TaskInput } from '../../src/tasks/schema';

const r = { lessonNo: 3, tags: ['būti'], explanation: 'Глагол būti.' };
const v: Variant = {
  key: 'pres.1sg',
  frame: 0,
  lemma: 'būti',
  question: 'Aš ___ studentas. (būti)',
  answer: 'esu',
  accept: ['esu'],
  reject: ['yra'],
  distractors: ['yra', 'esi'],
  orderWords: ['Aš', 'esu', 'studentas.'],
  present: ['input', 'choice', 'order'],
  note: 'Форма 1 л. ед. ч.',
  target: { lemma: 'būti', key: 'pres.1sg' },
};

describe('taskFromVariant', () => {
  it('builds an input task with target', () => {
    const t = taskFromVariant(r, v, 'input');
    expect(TaskInput.parse(t)).toBeTruthy();
    expect(t).toMatchObject({ kind: 'input', accept: ['esu'], target: { lemma: 'būti', key: 'pres.1sg' }, slot: 'review', unverified: [] });
  });

  it('builds a choice task with all options once', () => {
    const t = taskFromVariant(r, v, 'choice', () => 0);
    TaskInput.parse(t);
    if (t.kind !== 'choice') throw new Error('kind');
    expect([...t.options].sort()).toEqual(['esi', 'esu', 'yra']);
    expect(t.options[t.correct]).toBe('esu');
  });

  it('builds an order task with shuffled words', () => {
    const t = taskFromVariant(r, v, 'order', () => 0.99);
    TaskInput.parse(t);
    if (t.kind !== 'order') throw new Error('kind');
    expect(t.words).not.toEqual(v.orderWords);
    expect([...t.words].sort()).toEqual([...v.orderWords!].sort());
    expect(t.accept[0]).toBe('Aš esu studentas.');
    expect(t.question).toBe('Соберите фразу (būti)');
  });

  it('order without target uses plain question; null orderWords throws', () => {
    const t = taskFromVariant(r, { ...v, target: null }, 'order');
    if (t.kind !== 'order') throw new Error('kind');
    expect(t.question).toBe('Соберите фразу');
    expect(() => taskFromVariant(r, { ...v, orderWords: null }, 'order')).toThrow();
  });

  it('joins explanations', () => {
    expect(taskFromVariant(r, v, 'input')).toHaveProperty('explanation', 'Глагол būti. Форма 1 л. ед. ч.');
    expect(taskFromVariant(r, { ...v, note: '' }, 'input')).toHaveProperty('explanation', 'Глагол būti.');
  });
});
