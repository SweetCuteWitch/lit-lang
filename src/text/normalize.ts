/** Combining marks used by Wiktionary for Lithuanian stress: grave, acute, tilde. */
const STRESS = /[̀́̃]/g;

/**
 * Removes stress marks (kirčiai) and keeps the letters ą č ę ė į š ų ū ž.
 * Wiktionary writes stressed i as i + U+0307 (dot above) + accent; ė is e + U+0307 in NFD,
 * so the dot is dropped only after i.
 */
export function stripStress(s: string): string {
  return s.normalize('NFD').replace(STRESS, '').replace(/([iI])̇/g, '$1').normalize('NFC');
}

const FOLD: Record<string, string> = { ą: 'a', č: 'c', ę: 'e', ė: 'e', į: 'i', š: 's', ų: 'u', ū: 'u', ž: 'z' };

/** Lowercase text without any Lithuanian diacritics: used to accept answers typed without them. */
export function fold(s: string): string {
  return stripStress(s)
    .toLowerCase()
    .replace(/[ąčęėįšųūž]/g, (c) => FOLD[c]);
}

export function normalizeAnswer(s: string): string {
  return stripStress(s)
    .toLowerCase()
    .replace(/[„“”«»]/g, '"')
    .replace(/[‚‘’`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?…]+$/u, '')
    .trim();
}

/** Lowercase Lithuanian word tokens (letters only; digits and punctuation dropped). */
export function tokenize(s: string): string[] {
  return stripStress(s).toLowerCase().match(/\p{L}+(?:-\p{L}+)*/gu) ?? [];
}
