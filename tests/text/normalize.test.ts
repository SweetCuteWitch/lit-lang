import { describe, expect, it } from 'vitest';
import { fold, normalizeAnswer, stripStress, tokenize } from '../../src/text/normalize';

describe('stripStress', () => {
  it('removes stress marks but keeps letters', () => {
    expect(stripStress('knỹgą')).toBe('knygą');
    expect(stripStress('danti̇̀s')).toBe('dantis');
    expect(stripStress('duktė̃')).toBe('duktė');
    expect(stripStress('bū́ti')).toBe('būti');
    expect(stripStress('ei̇̃ti')).toBe('eiti');
    expect(stripStress('žmogùs')).toBe('žmogus');
    expect(stripStress('kal̃ba')).toBe('kalba');
  });
});

describe('fold', () => {
  it('removes all Lithuanian diacritics', () => {
    expect(fold('šiandien')).toBe('siandien');
    expect(fold('ąčęėįšųūž')).toBe('aceeisuuz');
    expect(fold('Mėnesis')).toBe('menesis');
  });
});

describe('normalizeAnswer', () => {
  it('lowercases, trims and drops trailing punctuation', () => {
    expect(normalizeAnswer('  Aš  gyvenu. ')).toBe('aš gyvenu');
    expect(normalizeAnswer('Labas!!')).toBe('labas');
    expect(normalizeAnswer('„Labas“')).toBe('"labas"');
    expect(normalizeAnswer('Kas — tai?')).toBe('kas - tai');
  });
});

describe('tokenize', () => {
  it('extracts lowercase word tokens', () => {
    expect(tokenize('„Labas“, Jonai!')).toEqual(['labas', 'jonai']);
    expect(tokenize('Aš gyvenu Vilniuje 5 metus.')).toEqual(['aš', 'gyvenu', 'vilniuje', 'metus']);
  });
});
