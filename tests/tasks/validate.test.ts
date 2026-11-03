import { describe, expect, it } from 'vitest';
import { fixtureLexicon } from '../helpers/fixture-lexicon';
import { TaskInput } from '../../src/tasks/schema';
import { ltTokens, validateTask, validateTheory } from '../../src/tasks/validate';

const env = (known: string[]) => ({ lex: fixtureLexicon, known: () => new Set(known) });

const input = (over: object = {}) => TaskInput.parse({
  kind: 'input', lessonNo: 2, slot: 'review', tags: ['verb:pres'],
  question: 'Aš ___ (gyventi) Vilniuje.', accept: ['gyvenu'], explanation: '', ...over,
});

describe('validateTask', () => {
  it('accepts a task made of lexicon forms of known words', () => {
    expect(validateTask(input({ target: { lemma: 'gyventi', key: 'pres.1sg' } }), env(['gyventi']))).toEqual([]);
  });
  it('rejects an invented form', () => {
    expect(validateTask(input({ accept: ['gyvenuo'] }), env(['gyventi']))[0]).toContain('нет в лексиконе: gyvenuo');
  });
  it('allows an unknown word listed in unverified', () => {
    expect(validateTask(input({ accept: ['gyvenuo'], unverified: ['gyvenuo'] }), env(['gyventi']))).toEqual([]);
  });
  it('rejects a target that does not match the accepted answer', () => {
    const errors = validateTask(input({ accept: ['gyveni'], target: { lemma: 'gyventi', key: 'pres.1sg' } }), env(['gyventi']));
    expect(errors).toContain('target: форма gyventi pres.1sg = «gyvenu», её нет в accept');
  });
  it('rejects content words the user has not learned yet', () => {
    expect(validateTask(input({ question: 'Aš ___ (gyventi) name.', accept: ['gyvenu'] }), env(['gyventi']))).toEqual([
      'слова ещё не изучены к уроку 2: name (namas)',
    ]);
  });
  it('ignores Russian text and pronouns', () => {
    const t = TaskInput.parse({ kind: 'translate', direction: 'lt-ru', lessonNo: 1, slot: 'review', source: 'Aš esu', accept: ['Я есть'] });
    expect(validateTask(t, env(['būti']))).toEqual([]);
  });
  it('rejects long RU→LT translations', () => {
    const t = TaskInput.parse({ kind: 'translate', direction: 'ru-lt', lessonNo: 1, slot: 'review', source: 'Я живу в большом доме в Вильнюсе давно', accept: ['Aš gyvenu'] });
    expect(validateTask(t, env(['gyventi']))).toContain('перевод RU→LT длиннее 6 слов: используйте order');
  });
  it('requires a portion key for new tasks', () => {
    expect(validateTask(input({ slot: 'new' }), env(['gyventi']))).toContain('задание slot=new должно иметь portionKey');
  });
});

describe('ltTokens', () => {
  it('keeps Latin-script tokens and drops Cyrillic', () => {
    expect(ltTokens('Как сказать «Aš gyvenu»? ___')).toEqual(['aš', 'gyvenu']);
  });
});

describe('validateTheory', () => {
  it('accepts Telegram tags', () => {
    expect(validateTheory('<b>Aš</b> — я, <i>tu</i> — ты')).toEqual([]);
  });
  it('rejects unsupported or unbalanced tags and raw <', () => {
    expect(validateTheory('<br><b>x')).toEqual(['тег <br> не поддерживается Telegram', 'незакрытые теги: b']);
    expect(validateTheory('a < b')).toEqual(['экранируйте &, < и > как &amp; &lt; &gt;']);
  });
});

describe('multi-word known words', () => {
  it('accepts a token that is known as part of a phrase', () => {
    const t = TaskInput.parse({ kind: 'choice', lessonNo: 1, slot: 'review', question: 'Kaip?', options: ['name', 'gyvenu'], correct: 0 });
    expect(validateTask(t, env(['name', 'gyventi']))).toEqual([]);
  });
});
