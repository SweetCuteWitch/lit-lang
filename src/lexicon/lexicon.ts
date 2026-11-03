import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { stripStress } from '../text/normalize';
import type { FormRef, LexEntry } from './types';

export interface Lexicon {
  lookup(lemma: string): LexEntry[];
  /** Main form of a lemma by key, from the first entry that has it. */
  form(lemma: string, key: string): string | undefined;
  lemmasOf(form: string): FormRef[];
  has(form: string): boolean;
  size: number;
}

const norm = (s: string) => stripStress(s).toLowerCase();

export function createLexicon(entries: LexEntry[]): Lexicon {
  const byLemma = new Map<string, LexEntry[]>();
  const byForm = new Map<string, FormRef[]>();
  const index = (form: string, ref: FormRef) => {
    const k = norm(form);
    const list = byForm.get(k);
    if (!list) byForm.set(k, [ref]);
    else if (!list.some((r) => r.lemma === ref.lemma && r.pos === ref.pos && r.key === ref.key)) list.push(ref);
  };
  for (const e of entries) {
    const k = norm(e.lemma);
    byLemma.set(k, [...(byLemma.get(k) ?? []), e]);
    index(e.lemma, { lemma: e.lemma, pos: e.pos, key: 'lemma' });
    for (const [key, variants] of Object.entries(e.forms)) for (const v of variants) index(v, { lemma: e.lemma, pos: e.pos, key });
    for (const v of e.other) index(v, { lemma: e.lemma, pos: e.pos, key: 'other' });
  }
  return {
    lookup: (lemma) => byLemma.get(norm(lemma)) ?? [],
    form(lemma, key) {
      for (const e of byLemma.get(norm(lemma)) ?? []) if (e.forms[key]?.[0]) return e.forms[key][0];
      return undefined;
    },
    lemmasOf: (form) => byForm.get(norm(form)) ?? [],
    has: (form) => byForm.has(norm(form)),
    size: entries.length,
  };
}

export const LEXICON_PATH = 'data/lexicon.json.gz';

let cached: Lexicon | null = null;

export function loadLexicon(path = LEXICON_PATH): Lexicon {
  if (cached && path === LEXICON_PATH) return cached;
  const entries = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as LexEntry[];
  const lex = createLexicon(entries);
  if (path === LEXICON_PATH) cached = lex;
  return lex;
}
