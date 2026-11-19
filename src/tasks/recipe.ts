import { z } from 'zod';
import type { LexEntry } from '../lexicon/types';
import { normalizeAnswer, stripStress } from '../text/normalize';
import { taskFromVariant, type Variant } from './from-variant';
import { TaskInput } from './schema';
import { diacriticClashes, validateTask, type ValidationEnv } from './validate';

export type { Present, Variant } from './from-variant';

const nonEmpty = z.string().trim().min(1);
const oneBlank = (lt: string) => (lt.match(/___/g)?.length ?? 0) === 1 && !/____/.test(lt);
const wordSlots = (lt: string) => lt.split('{word}').length - 1;

export const RecipeInput = z.object({
  /** Unique key of the recipe: latin letters, digits, dashes (buti-pres). */
  name: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.literal('form'),
  lessonNo: z.number().int().min(1),
  tags: z.array(nonEmpty).min(1),
  explanation: z.string(),
  /** A Lithuanian phrase with one `___` and the lexicon form key that fills it. */
  frames: z.array(z.object({
    lt: nonEmpty
      .refine(oneBlank, { message: 'в рамке должен быть ровно один ___' })
      .refine((lt) => wordSlots(lt) <= 1, { message: 'в рамке может быть только один {word}' }),
    key: nonEmpty,
    note: z.string().optional(),
  })).min(1),
  words: z.array(nonEmpty).min(1),
  /** The blank is filled by the noun's gender (Koks/Kokia); `{word}` takes the noun's form. */
  byGender: z.object({ m: nonEmpty, f: nonEmpty }).optional(),
  present: z.array(z.enum(['input', 'choice', 'order'])).min(1),
}).refine((r) => !r.byGender || r.frames.every((f) => f.lt.includes('{word}')), {
  message: 'при byGender в каждой рамке нужен {word}', path: ['frames'],
}).refine((r) => !!r.byGender || r.frames.every((f) => !wordSlots(f.lt)), {
  // In form mode {word} would be the form for key, i.e. the answer itself.
  message: '{word} разрешён только с byGender: иначе в вопросе виден ответ', path: ['frames'],
});
export type RecipeInput = z.infer<typeof RecipeInput>;

const MAX_DISTRACTORS = 3;

const uniq = (forms: string[]) => [...new Set(forms.map((f) => stripStress(f)))];

const tense = (k: string) => k.split('.')[0];
const number = (k: string) => k.split('.').find((s) => s === 'sg' || s === 'pl') ?? null;

/**
 * Up to 3 other real forms of the entry for buttons, unique and never an accepted answer.
 * Verbs take only forms of the same tense/mood (pres.*); other words take forms of the same number first,
 * then of the other number (`otherNumber` is then true, the caller warns).
 */
function formDistractors(e: LexEntry, key: string, accept: string[]): { distractors: string[]; otherNumber: boolean } {
  const seen = new Set(accept.map(normalizeAnswer));
  const keys = Object.keys(e.forms).filter((k) => k !== key);
  const groups = e.pos === 'verb'
    ? [keys.filter((k) => tense(k) === tense(key))]
    : [keys.filter((k) => number(k) === number(key)), keys.filter((k) => number(k) !== number(key))];
  const out: string[] = [];
  let otherNumber = false;
  for (const [g, list] of groups.entries()) {
    for (const k of list) {
      for (const f of uniq(e.forms[k] ?? [])) {
        const n = normalizeAnswer(f);
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(f);
        if (g > 0) otherNumber = true;
        if (out.length === MAX_DISTRACTORS) return { distractors: out, otherNumber };
      }
    }
  }
  return { distractors: out, otherNumber };
}

/**
 * The first real entry of the lemma that has the form key. `ambiguous` is set when several entries have
 * the key with different forms or genders (homographs): the first one is still used, the caller warns.
 */
function pickEntry(entries: LexEntry[], key: string): { entry?: LexEntry; ambiguous: boolean } {
  const entry = entries.find((e) => e.pos !== 'other' && e.pos !== 'formof' && e.forms[key]?.length)
    ?? entries.find((e) => e.forms[key]?.length);
  const sig = (e: LexEntry) => `${e.gender ?? ''}|${uniq(e.forms[key]!).sort().join('|')}`;
  const sigs = new Set(entries.filter((e) => e.forms[key]?.length).map(sig));
  return { entry, ambiguous: sigs.size > 1 };
}

/**
 * Turns a recipe into ready variants (frame × word) with every form taken from the lexicon, so the
 * bot can build tasks without it. Words or views that cannot be built are dropped with a warning.
 */
export function expandRecipe(r: RecipeInput, env: ValidationEnv): { variants: Variant[]; warnings: string[] } {
  const variants: Variant[] = [];
  const warnings: string[] = [];
  const words = r.words.filter((w) => {
    if (env.lex.lookup(w).length) return true;
    warnings.push(`«${w}»: нет в лексиконе — слово пропущено`);
    return false;
  });

  r.frames.forEach((frame, i) => {
    for (const word of words) {
      const { entry: e, ambiguous } = pickEntry(env.lex.lookup(word), frame.key);
      if (!e) {
        warnings.push(`рамка ${i}, «${word}»: в лексиконе нет формы ${frame.key} — вариант пропущен`);
        continue;
      }
      const key = `${i}#${e.lemma}`;
      if (ambiguous) {
        warnings.push(`${key}: у «${word}» в лексиконе несколько статей с разными формами ${frame.key} или родом — взята первая (${e.pos}${e.gender ? `, ${e.gender}` : ''})`);
      }
      const forms = uniq(e.forms[frame.key]!);
      const withWord = frame.lt.replace('{word}', forms[0]!);

      let answer: string;
      let accept: string[];
      let distractors: string[];
      let question: string;
      let target: Variant['target'];
      if (r.byGender) {
        if (!e.gender) {
          warnings.push(`${key}: у слова «${e.lemma}» в лексиконе нет рода — вариант пропущен`);
          continue;
        }
        answer = r.byGender[e.gender];
        accept = [answer];
        const seen = new Set([normalizeAnswer(answer)]);
        distractors = Object.values(r.byGender).filter((o) => !seen.has(normalizeAnswer(o)) && seen.add(normalizeAnswer(o)));
        question = withWord;
        target = null;
      } else {
        answer = forms[0]!;
        accept = forms;
        const d = formDistractors(e, frame.key, accept);
        distractors = d.distractors;
        if (d.otherNumber && r.present.includes('choice')) {
          warnings.push(`${key} choice: среди дистракторов есть формы другого числа — проверь, что кнопки не путают`);
        }
        question = `${withWord} (${e.lemma})`;
        target = { lemma: e.lemma, key: frame.key };
      }

      const listed = new Set(accept.map(normalizeAnswer));
      const reject = [...new Set(accept.flatMap((a) => diacriticClashes(env.lex, a, listed)))];
      const phrase = withWord.replace('___', answer).trim();
      const phraseWords = phrase.split(/\s+/);
      const orderWords = r.present.includes('order') && phraseWords.length >= 3 ? phraseWords : null;

      const v: Variant = {
        key, frame: i, lemma: e.lemma, question, answer, accept, reject, distractors, orderWords,
        present: [], note: frame.note ?? '', target,
      };
      const candidates = r.present.filter((p) => (p !== 'order' || orderWords) && (p !== 'choice' || distractors.length));
      v.present = candidates.filter((p) => {
        const parsed = TaskInput.safeParse(taskFromVariant(r, v, p, () => 0));
        const errors = parsed.success
          ? validateTask(parsed.data, env)
          : parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`);
        for (const err of errors) warnings.push(`${key} ${p}: ${err}`);
        return errors.length === 0;
      });
      if (!v.present.length) {
        warnings.push(`${key}: ни один вид показа не прошёл проверку — вариант пропущен`);
        continue;
      }
      variants.push(v);
    }
  });
  return { variants, warnings };
}
