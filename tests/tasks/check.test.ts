import { describe, expect, it } from 'vitest';
import { checkChoice, checkText } from '../../src/tasks/check';
import { TaskInput } from '../../src/tasks/schema';

describe('checkText', () => {
  it('accepts an exact answer', () => {
    expect(checkText('gyvenu', ['gyvenu'])).toEqual({ correct: true, exact: true, expected: 'gyvenu' });
  });
  it('ignores case, spaces and trailing punctuation', () => {
    expect(checkText('  Aš gyvenu Vilniuje. ', ['Aš gyvenu Vilniuje'])).toMatchObject({ correct: true, exact: true });
  });
  it('accepts a missing-diacritics answer as correct but not exact', () => {
    expect(checkText('siandien', ['šiandien'])).toEqual({ correct: true, exact: false, expected: 'šiandien' });
  });
  it('rejects a folded answer that equals a reject form', () => {
    expect(checkText('knyga', ['knygą'], ['knyga'])).toEqual({ correct: false, exact: false, expected: 'knygą' });
  });
  it('accepts any of several answers and reports the closest as expected', () => {
    expect(checkText('as cia gyvenu', ['Aš gyvenu čia', 'Aš čia gyvenu'])).toEqual({
      correct: true, exact: false, expected: 'Aš čia gyvenu',
    });
  });
  it('rejects a wrong answer and shows the first accepted one', () => {
    expect(checkText('gyveni', ['gyvenu'])).toEqual({ correct: false, exact: false, expected: 'gyvenu' });
  });
  it('rejects an empty answer', () => {
    expect(checkText('   ', ['gyvenu']).correct).toBe(false);
  });
});

describe('checkChoice', () => {
  it('compares option index', () => {
    expect(checkChoice(1, 1)).toBe(true);
    expect(checkChoice(0, 1)).toBe(false);
  });
});

describe('TaskInput schema', () => {
  it('parses an input task', () => {
    const t = TaskInput.parse({
      kind: 'input', lessonNo: 3, slot: 'new', tags: ['verb:present'],
      question: 'Aš ___ (gyventi) Vilniuje.', accept: ['gyvenu'], explanation: 'gyventi → gyvenu',
      target: { lemma: 'gyventi', key: 'pres.1sg' },
    });
    expect(t.kind).toBe('input');
  });
  it('rejects a choice task whose correct index is out of range', () => {
    expect(() => TaskInput.parse({
      kind: 'choice', lessonNo: 1, slot: 'new', tags: [], question: '?', options: ['a', 'b'], correct: 2, explanation: '',
    })).toThrow();
  });
  it('rejects an unknown kind', () => {
    expect(() => TaskInput.parse({ kind: 'audio', lessonNo: 1, slot: 'new', tags: [] })).toThrow();
  });
});
