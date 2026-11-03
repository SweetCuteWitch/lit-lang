import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { stripStress } from '../text/normalize';
import type { FormRef, LexEntry } from './types';

export interface Lexicon {
  /** Entries of a lemma; prefixed verbs missing from Wiktionary are derived from their base verb. */
  lookup(lemma: string): LexEntry[];
  /** Main form of a lemma by key, from the first entry that has it. */
  form(lemma: string, key: string): string | undefined;
  lemmasOf(form: string): FormRef[];
  has(form: string): boolean;
  size: number;
}

const norm = (s: string) => stripStress(s).toLowerCase();

/** Verb prefixes, longest first. `ne`/`nebe` negate any verb form. */
export const VERB_PREFIXES = ['nebe', 'per', 'pra', 'pri', 'par', 'ap', 'at', 'iš', 'nu', 'pa', 'su', 'už', 'ne', 'be', 'te', 'į'];

function withPrefix(e: LexEntry, prefix: string, reflexive: boolean): LexEntry {
  const add = (f: string) => prefix + (reflexive ? 'si' : '') + f;
  return {
    lemma: add(e.lemma),
    pos: 'verb',
    gloss: `${prefix}- + ${e.lemma} (${e.gloss})`,
    derived: true,
    // 3rd person imperative is te- + present (tegyvena): the prefix goes after te-, so it is not derived.
    forms: Object.fromEntries(Object.entries(e.forms).filter(([k]) => k !== 'imp.3').map(([k, v]) => [k, v.map(add)])),
    other: [],
  };
}

/** Irregular verbs whose prefixed/negated forms are not regular (ne + esu = nesu, ne + yra = nėra). */
const NO_DERIVATION = new Set(['būti']);
/** te- forms only the 3rd person imperative from the present: tegyvena. */
const prefixAllows = (p: string, key: string) => p !== 'te' || key.startsWith('pres.');

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

  const ownLookup = (lemma: string) => byLemma.get(norm(lemma)) ?? [];

  /** atsikelti → at + si + kelti; paskambinti → pa + skambinti (only when the base is a known, non-reflexive-marked verb). */
  function derive(lemma: string): LexEntry[] {
    const l = norm(lemma);
    for (const p of VERB_PREFIXES) {
      if (p === 'te' || !l.startsWith(p) || l.length - p.length < 3) continue;
      const rest = l.slice(p.length);
      for (const reflexive of rest.startsWith('si') ? [true, false] : [false]) {
        const base = ownLookup(reflexive ? rest.slice(2) : rest).filter(
          (e) => e.pos === 'verb' && Object.keys(e.forms).length > 1 && !NO_DERIVATION.has(e.lemma),
        );
        if (base.length) return base.map((e) => withPrefix(e, p, reflexive));
      }
    }
    return [];
  }

  function deriveForm(form: string): FormRef[] {
    const f = norm(form);
    for (const p of VERB_PREFIXES) {
      if (!f.startsWith(p) || f.length - p.length < 2) continue;
      for (const reflexive of [true, false]) {
        const rest = f.slice(p.length);
        if (reflexive && !rest.startsWith('si')) continue;
        const refs = (byForm.get(reflexive ? rest.slice(2) : rest) ?? []).filter(
          (r) => r.pos === 'verb' && r.key !== 'other' && !NO_DERIVATION.has(r.lemma) && prefixAllows(p, r.key),
        );
        if (refs.length) return refs.map((r) => ({ lemma: p + (reflexive ? 'si' : '') + r.lemma, pos: 'verb', key: r.key }));
      }
    }
    return [];
  }

  const lookup = (lemma: string) => {
    const own = ownLookup(lemma).filter((e) => e.pos !== 'formof');
    return own.length ? own : derive(lemma);
  };
  const lemmasOf = (form: string) => {
    const own = byForm.get(norm(form)) ?? [];
    return own.length ? own : deriveForm(form);
  };

  return {
    lookup,
    form(lemma, key) {
      for (const e of lookup(lemma)) if (e.forms[key]?.[0]) return e.forms[key][0];
      return undefined;
    },
    lemmasOf,
    has: (form) => lemmasOf(form).length > 0,
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
