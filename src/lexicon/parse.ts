import { stripStress } from '../text/normalize';
import type { LexEntry, Pos } from './types';

interface RawForm {
  form: string;
  tags?: string[];
}
interface RawEntry {
  word: string;
  pos: string;
  forms?: RawForm[];
  senses?: { glosses?: string[]; tags?: string[] }[];
  head_templates?: { expansion?: string }[];
}

const POS: Record<string, Pos> = { noun: 'noun', name: 'name', verb: 'verb', adj: 'adj', num: 'num', pron: 'pron' };
const CASES: Record<string, string> = {
  nominative: 'nom', genitive: 'gen', dative: 'dat', accusative: 'acc', instrumental: 'ins', locative: 'loc', vocative: 'voc',
};
const SKIP_KEYED = ['dual', 'comparative', 'superlative', 'definite'];
const VERB_BLOCKS = ['pres', 'past', 'freq', 'fut', 'cond', 'imp'] as const;
const FIRST_PLURAL = /(me|m|mės|mėsi)$/;

function clean(form: string): string | null {
  const f = stripStress(form).trim();
  if (!f || f === '-' || /\s/.test(f)) return null;
  return f;
}

function add(forms: Record<string, string[]>, key: string, form: string) {
  const list = (forms[key] ??= []);
  if (!list.includes(form)) list.push(form);
}

function gloss(raw: RawEntry): string {
  return (raw.senses ?? [])
    .flatMap((s) => s.glosses?.slice(0, 1) ?? [])
    .slice(0, 3)
    .join('; ');
}

function genderOf(raw: RawEntry): 'm' | 'f' | undefined {
  const canonical = raw.forms?.find((f) => f.tags?.includes('canonical'))?.tags ?? [];
  if (canonical.includes('masculine')) return 'm';
  if (canonical.includes('feminine')) return 'f';
  const head = raw.head_templates?.[0]?.expansion ?? '';
  const m = head.match(/\s(m|f)(?:\s|\(|$)/);
  return m ? (m[1] as 'm' | 'f') : undefined;
}

function nominalKey(tags: string[], pos: Pos): string | null {
  if (tags.some((t) => SKIP_KEYED.includes(t))) return null;
  const c = tags.map((t) => CASES[t]).find(Boolean);
  if (!c) return null;
  const number = tags.includes('plural') ? 'pl' : tags.includes('singular') ? 'sg' : null;
  const gender = tags.includes('masculine') ? 'm' : tags.includes('feminine') ? 'f' : null;
  if (pos === 'adj') {
    if (!gender || !number) return null;
    return `${gender}.${c}.${number}`;
  }
  if (pos === 'num') {
    if (gender) return number ? `${gender}.${c}.${number}` : `${gender}.${c}`;
    return number ? `${c}.${number}` : c;
  }
  return `${c}.${number ?? 'sg'}`;
}

/**
 * Reads the conjugation table: blocks pres, past, freq, fut, cond, imp in that order. Inside a
 * block the first item is 1sg, second-person items are 2sg, the first untagged item after them is
 * the 3rd person, later untagged items ending like 1pl are 1pl, plural second-person are 2pl, and
 * the plural third-person item closes the block.
 */
function parseVerbTable(items: RawForm[], forms: Record<string, string[]>) {
  let block = 0;
  let stage = 0; // 0 = expect 1sg, 1 = after 1sg, 2 = after 2sg, 3 = after 3rd
  for (const it of items) {
    if (block >= VERB_BLOCKS.length) break;
    const name = VERB_BLOCKS[block];
    const tags = it.tags ?? [];
    const form = clean(it.form);
    const second = tags.includes('second-person');
    const plural = tags.includes('plural');
    if (plural && tags.includes('third-person')) {
      block++;
      stage = 0;
      continue;
    }
    if (stage === 0) {
      if (form) add(forms, `${name}.1sg`, form);
      stage = 1;
      continue;
    }
    if (second && plural) {
      if (form) add(forms, `${name}.2pl`, form);
      continue;
    }
    if (second) {
      if (form) add(forms, `${name}.2sg`, form);
      stage = 2;
      continue;
    }
    if (!form) continue;
    if (stage < 3) {
      add(forms, `${name}.3`, form);
      stage = 3;
    } else if (FIRST_PLURAL.test(form)) {
      add(forms, `${name}.1pl`, form);
    } else {
      add(forms, `${name}.3`, form);
    }
  }
}

const isMarker = (tags: string[]) => tags.includes('table-tags') || tags.includes('inflection-template');

export function parseEntry(input: unknown): LexEntry | null {
  const raw = input as RawEntry;
  if (!raw?.word || !raw.pos) return null;
  const senses = raw.senses ?? [];
  if (senses.length && senses.every((s) => s.tags?.includes('form-of') || s.tags?.includes('alt-of'))) return null;
  const pos = POS[raw.pos] ?? 'other';
  const lemma = stripStress(raw.word);
  const forms: Record<string, string[]> = {};
  const other: string[] = [];
  const rawForms = raw.forms ?? [];

  if (pos === 'verb') {
    add(forms, 'inf', lemma);
    const header = (tense: string) =>
      rawForms.find((f) => f.tags?.includes(tense) && f.tags.includes('third-person') && !f.tags.includes('error-unrecognized-form'));
    const h3 = header('present') && clean(header('present')!.form);
    const hp = header('past') && clean(header('past')!.form);
    const tableForms: Record<string, string[]> = {};
    parseVerbTable(rawForms.filter((f) => f.tags?.includes('error-unrecognized-form')), tableForms);
    const consistent = (!h3 || tableForms['pres.3']?.[0] === h3) && (!hp || tableForms['past.3']?.[0] === hp);
    if (consistent) Object.assign(forms, tableForms);
    else {
      if (h3) add(forms, 'pres.3', h3);
      if (hp) add(forms, 'past.3', hp);
    }
    const known = new Set(Object.values(forms).flat());
    for (const f of rawForms) {
      const tags = f.tags ?? [];
      const c = clean(f.form);
      if (c && !tags.includes('error-unrecognized-form') && !isMarker(tags) && !known.has(c)) other.push(c);
    }
  } else {
    for (const f of rawForms) {
      const tags = f.tags ?? [];
      if (isMarker(tags)) continue;
      const c = clean(f.form);
      if (!c) continue;
      const key = pos === 'other' ? null : nominalKey(tags, pos);
      if (key && !forms[key]) forms[key] = [c];
      else if (key && !forms[key].includes(c) && (pos === 'noun' || pos === 'pron' || pos === 'name')) forms[key].push(c);
      else if (!other.includes(c)) other.push(c);
    }
  }

  return {
    lemma,
    pos,
    gender: pos === 'noun' || pos === 'name' ? genderOf(raw) : undefined,
    gloss: gloss(raw),
    forms,
    other: [...new Set(other)],
  };
}
