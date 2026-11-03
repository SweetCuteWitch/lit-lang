/** formof = an inflected form listed by Wiktionary as its own entry (e.g. nėra): valid, but not a lemma. */
export type Pos = 'noun' | 'name' | 'verb' | 'adj' | 'num' | 'pron' | 'other' | 'formof';

export interface LexEntry {
  lemma: string;
  pos: Pos;
  gender?: 'm' | 'f';
  /** English gloss from Wiktionary (Claude writes the Russian translation itself). */
  gloss: string;
  /** Form key → variants, first is the main one. Keys: nouns `gen.sg`; adjectives `f.acc.sg`;
   *  numerals `m.nom`; verbs `inf`, `pres.1sg|2sg|3|1pl|2pl`, `past.*`, `freq.*`, `fut.*`, `cond.*`, `imp.*`. */
  forms: Record<string, string[]>;
  /** Built by adding a prefix to a known verb, not taken from Wiktionary as is. */
  derived?: boolean;
  /** Other valid forms without a key (participles, definite adjectives, comparatives…). */
  other: string[];
}

export interface FormRef {
  lemma: string;
  pos: Pos;
  key: string;
}
