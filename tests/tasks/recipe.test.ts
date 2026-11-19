import { describe, expect, it } from 'vitest';
import { fixtureLexicon } from '../helpers/fixture-lexicon';
import { expandRecipe, RecipeInput } from '../../src/tasks/recipe';
import { diacriticClashes } from '../../src/tasks/validate';
import { normalizeAnswer } from '../../src/text/normalize';

const env = { lex: fixtureLexicon, known: () => new Set(['būti', 'studentas', 'draugė', 'vardas', 'pavardė']) };

const recipe = (over: object) => RecipeInput.parse({
  name: 'test', kind: 'form', lessonNo: 3, tags: ['t'], explanation: 'Объяснение.',
  frames: [{ lt: 'Aš ___ studentas.', key: 'pres.1sg' }], words: ['būti'], present: ['input', 'choice', 'order'], ...over,
});

describe('expandRecipe', () => {
  it('expands a conjugation recipe', () => {
    const { variants, warnings } = expandRecipe(recipe({
      name: 'buti',
      frames: [{ lt: 'Aš ___ studentas.', key: 'pres.1sg', note: '1 л.' }, { lt: 'Jos ___ mano draugės.', key: 'pres.3' }],
    }), env);
    expect(warnings).toEqual([]);
    expect(variants).toHaveLength(2);
    const [a, b] = variants;
    expect(a).toMatchObject({
      key: '0#būti', frame: 0, lemma: 'būti', answer: 'esu', accept: ['esu'], question: 'Aš ___ studentas. (būti)',
      target: { lemma: 'būti', key: 'pres.1sg' }, orderWords: ['Aš', 'esu', 'studentas.'], present: ['input', 'choice', 'order'], note: '1 л.',
    });
    expect(a!.distractors.length).toBeGreaterThan(0);
    expect(a!.distractors.length).toBeLessThanOrEqual(3);
    const pres = Object.entries(fixtureLexicon.lookup('būti')[0]!.forms).filter(([k]) => k.startsWith('pres.')).flatMap(([, v]) => v);
    for (const d of a!.distractors) expect(pres).toContain(d);
    expect(a!.distractors).not.toContain('esu');
    expect(new Set(a!.distractors).size).toBe(a!.distractors.length);
    expect(b).toMatchObject({ key: '1#būti', answer: 'yra', question: 'Jos ___ mano draugės. (būti)', note: '' });
  });

  it('expands iš + gen', () => {
    const { variants } = expandRecipe(recipe({ frames: [{ lt: 'Aš esu iš ___.', key: 'gen.sg' }], words: ['Rusija'] }), env);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ answer: 'Rusijos', orderWords: ['Aš', 'esu', 'iš', 'Rusijos.'], target: { lemma: 'Rusija', key: 'gen.sg' } });
    const accept = variants[0]!.accept.map(normalizeAnswer);
    for (const d of variants[0]!.distractors) expect(accept).not.toContain(normalizeAnswer(d));
    expect(new Set(variants[0]!.distractors.map(normalizeAnswer)).size).toBe(variants[0]!.distractors.length);
  });

  it('byGender picks koks/kokia', () => {
    const { variants, warnings } = expandRecipe(recipe({
      frames: [{ lt: '___ jūsų {word}?', key: 'nom.sg' }], words: ['vardas', 'pavardė'],
      byGender: { m: 'Koks', f: 'Kokia' }, present: ['choice'],
    }), env);
    expect(warnings).toEqual([]);
    expect(variants.map((v) => v.answer)).toEqual(['Koks', 'Kokia']);
    expect(variants.map((v) => v.question)).toEqual(['___ jūsų vardas?', '___ jūsų pavardė?']);
    expect(variants.map((v) => v.distractors)).toEqual([['Kokia'], ['Koks']]);
    expect(variants[0]).toMatchObject({ accept: ['Koks'], target: null, present: ['choice'], orderWords: null });
  });

  it('drops order for short phrases', () => {
    const { variants } = expandRecipe(recipe({ frames: [{ lt: 'Aš ___.', key: 'pres.1sg' }] }), env);
    expect(variants[0]).toMatchObject({ orderWords: null, present: ['input', 'choice'] });
  });

  it('skips unknown words with a warning', () => {
    const { variants, warnings } = expandRecipe(recipe({ words: ['būti', 'rašiklis'] }), env);
    expect(variants.map((v) => v.lemma)).toEqual(['būti']);
    expect(warnings.join('\n')).toContain('rašiklis');
  });

  it('skips a word without the form key and a byGender word without gender', () => {
    const r1 = expandRecipe(recipe({ frames: [{ lt: 'Aš esu iš ___.', key: 'gen.sg' }], words: ['būti'] }), env);
    expect(r1.variants).toEqual([]);
    expect(r1.warnings.join('\n')).toContain('gen.sg');
    const r2 = expandRecipe(recipe({ frames: [{ lt: '___ {word}', key: 'nom.sg' }], words: ['ji'], byGender: { m: 'Koks', f: 'Kokia' } }), env);
    expect(r2.variants).toEqual([]);
    expect(r2.warnings.join('\n')).toContain('ji');
  });

  it('drops views that fail validation, with warnings', () => {
    const { variants, warnings } = expandRecipe(recipe({}), { lex: fixtureLexicon, known: () => new Set() });
    expect(variants).toEqual([]);
    expect(warnings.join('\n')).toContain('не изучены');
  });

  it('refuses a frame without ___', () => {
    expect(RecipeInput.safeParse({
      name: 'x', kind: 'form', lessonNo: 1, tags: ['t'], explanation: '', frames: [{ lt: 'Aš esu.', key: 'pres.1sg' }], words: ['būti'], present: ['input'],
    }).success).toBe(false);
    expect(RecipeInput.safeParse({
      name: 'x', kind: 'form', lessonNo: 1, tags: ['t'], explanation: '', frames: [{ lt: '___ ___', key: 'pres.1sg' }], words: ['būti'], present: ['input'],
    }).success).toBe(false);
    expect(RecipeInput.safeParse({
      name: 'x', kind: 'form', lessonNo: 1, tags: ['t'], explanation: '', frames: [{ lt: '___ jūsų?', key: 'nom.sg' }], words: ['vardas'],
      byGender: { m: 'Koks', f: 'Kokia' }, present: ['choice'],
    }).success).toBe(false);
  });
});

describe('RecipeInput {word}', () => {
  const base = { name: 'x', kind: 'form', lessonNo: 1, tags: ['t'], explanation: '' };
  const parse = (lt: string, byGender?: object) => RecipeInput.safeParse({
    ...base, frames: [{ lt, key: 'nom.sg' }], words: ['vardas'], present: ['choice'], ...(byGender ? { byGender } : {}),
  }).success;
  it('forbids {word} without byGender: it would show the answer', () => {
    expect(parse('Tai ___ {word}.')).toBe(false);
    expect(parse('Tai ___.')).toBe(true);
  });
  it('allows only one {word} per frame', () => {
    expect(parse('___ {word} {word}?', { m: 'Koks', f: 'Kokia' })).toBe(false);
    expect(parse('___ jūsų {word}?', { m: 'Koks', f: 'Kokia' })).toBe(true);
  });
});

describe('diacriticClashes', () => {
  it('lists forms of the same word that fold to the answer', () => {
    expect(diacriticClashes(fixtureLexicon, 'Rusija', new Set(['rusija']))).toEqual(['rusiją']);
    expect(diacriticClashes(fixtureLexicon, 'Rusija', new Set(['rusija', 'rusiją']))).toEqual([]);
  });
});
