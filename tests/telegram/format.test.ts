import { describe, expect, it } from 'vitest';
import type { Lesson, Portion, Word } from '../../src/store/types';
import { formatLessonsList, formatPortion, formatVocabList, progressButtons } from '../../src/telegram/format';

const lesson = (no: number, title: string): Lesson => ({ no, title, grammar: '', topic: '', skill: '', words: [] });
const w = (lemma: string, lessonNo: number, over: Partial<Word> = {}): Word => ({
  id: lemma, lemma, translation: lemma.toUpperCase(), pos: 'noun', gender: null, keyForms: [lemma], example: 'ex',
  verified: true, lessonNo, box: 0, dueAt: '', addedAt: '', ...over,
});

describe('progressButtons', () => {
  it('offers vocab and lessons', () => {
    expect(progressButtons().inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['vocab', 'lessons']);
  });
});

describe('formatVocabList', () => {
  it('groups words by lesson with translation, gender and forms', () => {
    const [text] = formatVocabList(
      [w('stalas', 3, { translation: 'стол', gender: 'm' }), w('labas', 1, { translation: 'привет' }),
        w('knyga', 3, { translation: 'книга', gender: 'f', keyForms: ['knyga', 'knygos', 'knygą'] })],
      [lesson(1, 'Labas!'), lesson(3, 'Kas tai?')],
    );
    expect(text.indexOf('📖 <b>Урок 1: Labas!</b>')).toBeLessThan(text.indexOf('📖 <b>Урок 3: Kas tai?</b>'));
    expect(text).toContain('<b>knyga</b> — книга <i>(ж. р.)</i> · knyga, knygos, knygą');
    expect(text).toContain('<b>labas</b> — привет');
    expect(text).not.toContain('ex');
  });
  it('splits long lists between lines, each message at most 4000 chars', () => {
    const words = Array.from({ length: 300 }, (_, i) => w(`žodis${i}`, 1 + (i % 3), { translation: 'перевод '.repeat(3) }));
    const chunks = formatVocabList(words, []);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    const all = chunks.join('\n');
    for (const x of words) expect(all).toContain(`<b>${x.lemma}</b> — ${x.translation}\n`.trimEnd());
    expect(chunks.every((c) => !c.startsWith('\n') && !c.endsWith('\n'))).toBe(true);
  });
  it('escapes html', () => {
    expect(formatVocabList([w('a', 1, { translation: 'a < b & c' })], [lesson(1, 'x<y')])[0]).toContain('a &lt; b &amp; c');
  });
  it('says the dictionary is empty', () => {
    expect(formatVocabList([], [])).toEqual(['Словарь пока пуст.']);
  });
});

describe('formatLessonsList', () => {
  it('lists lessons and asks for a number', () => {
    const t = formatLessonsList([{ no: 1, title: 'Labas!' }, { no: 2, title: 'Aš <esu>' }]);
    expect(t).toContain('1. Labas!');
    expect(t).toContain('2. Aš &lt;esu&gt;');
    expect(t.endsWith('Напишите номер урока, чтобы прочитать его ещё раз.')).toBe(true);
  });
  it('says there are none yet', () => {
    expect(formatLessonsList([])).toBe('Пройденных уроков пока нет.');
  });
});

describe('formatPortion', () => {
  it('keeps the original lesson message format', () => {
    const p = { lessonNo: 3, seq: 2, theory: '<b>T</b>' } as Portion;
    expect(formatPortion(lesson(3, 'Kas tai?'), p)).toBe('📚 <b>Урок 3: Kas tai?</b> · часть 2\n\n<b>T</b>');
    expect(formatPortion(null, p)).toBe('📚 <b>Урок 3</b> · часть 2\n\n<b>T</b>');
  });
});
