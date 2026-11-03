import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLexicon } from '../../src/lexicon/lexicon';
import { parseEntry } from '../../src/lexicon/parse';
import type { LexEntry } from '../../src/lexicon/types';

const raw = readFileSync('tests/fixtures/kaikki-sample.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const entries = raw.map(parseEntry).filter((e): e is LexEntry => e !== null);
const get = (lemma: string, pos: string) => {
  const e = entries.find((x) => x.lemma === lemma && x.pos === pos);
  if (!e) throw new Error(`missing ${lemma} ${pos}`);
  return e;
};
const f = (lemma: string, pos: string, key: string) => get(lemma, pos).forms[key]?.[0];

describe('parseEntry', () => {
  it('skips form-of entries', () => {
    expect(entries.filter((e) => e.lemma === 'knyga')).toHaveLength(1);
  });
  it('parses noun tables without stress marks', () => {
    expect(get('knyga', 'noun').gender).toBe('f');
    expect(f('knyga', 'noun', 'gen.sg')).toBe('knygos');
    expect(f('knyga', 'noun', 'acc.sg')).toBe('knygą');
    expect(f('brolis', 'noun', 'gen.pl')).toBe('brolių');
    expect(f('dantis', 'noun', 'gen.pl')).toBe('dantų');
    expect(f('namas', 'noun', 'loc.pl')).toBe('namuose');
    expect(f('žmogus', 'noun', 'nom.pl')).toBe('žmonės');
    expect(f('Vilnius', 'name', 'loc.sg')).toBe('Vilniuje');
    expect(get('knyga', 'noun').gloss).toContain('book');
  });
  it('parses verb tables', () => {
    expect(f('gyventi', 'verb', 'inf')).toBe('gyventi');
    expect(f('gyventi', 'verb', 'pres.1sg')).toBe('gyvenu');
    expect(f('gyventi', 'verb', 'pres.2sg')).toBe('gyveni');
    expect(f('gyventi', 'verb', 'pres.3')).toBe('gyvena');
    expect(f('gyventi', 'verb', 'pres.1pl')).toBe('gyvename');
    expect(f('gyventi', 'verb', 'pres.2pl')).toBe('gyvenate');
    expect(f('gyventi', 'verb', 'past.1sg')).toBe('gyvenau');
    expect(f('gyventi', 'verb', 'fut.3')).toBe('gyvens');
    expect(f('gyventi', 'verb', 'cond.3')).toBe('gyventų');
    expect(f('mokytis', 'verb', 'pres.1sg')).toBe('mokausi');
    expect(f('mokytis', 'verb', 'past.1pl')).toBe('mokėmės');
    expect(f('mokytis', 'verb', 'imp.2sg')).toBe('mokykis');
    expect(f('būti', 'verb', 'pres.1sg')).toBe('esu');
    expect(f('būti', 'verb', 'pres.3')).toBe('yra');
    expect(f('būti', 'verb', 'fut.3')).toBe('bus');
    expect(f('eiti', 'verb', 'past.3')).toBe('ėjo');
    expect(f('eiti', 'verb', 'imp.2pl')).toBe('eikite');
  });
  it('parses adjectives, numerals and pronouns', () => {
    expect(f('geras', 'adj', 'f.acc.sg')).toBe('gerą');
    expect(f('geras', 'adj', 'm.nom.pl')).toBe('geri');
    expect(f('didelis', 'adj', 'f.nom.sg')).toBe('didelė');
    expect(f('du', 'num', 'f.nom')).toBe('dvi');
    expect(f('aš', 'pron', 'gen.sg')).toBe('manęs');
    expect(f('aš', 'pron', 'nom.pl')).toBe('mes');
  });
});

describe('lexicon', () => {
  const lex = createLexicon(entries);
  it('finds lemmas of a form', () => {
    expect(lex.lemmasOf('namuose')).toContainEqual({ lemma: 'namas', pos: 'noun', key: 'loc.pl' });
    expect(lex.lemmasOf('Gyvenu')).toContainEqual({ lemma: 'gyventi', pos: 'verb', key: 'pres.1sg' });
    expect(lex.has('knygą')).toBe(true);
    expect(lex.has('knygaa')).toBe(false);
  });
  it('looks up an entry by lemma', () => {
    expect(lex.lookup('knyga').map((e) => e.pos)).toEqual(['noun']);
    expect(lex.form('gyventi', 'pres.1sg')).toBe('gyvenu');
    expect(lex.form('gyventi', 'pres.9sg')).toBeUndefined();
  });
});
