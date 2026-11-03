import type { Lexicon } from '../lexicon/lexicon';
import { normalizeAnswer, tokenize } from '../text/normalize';
import type { TaskInput } from './schema';

/** Lexicon parts of speech that are vocabulary: such words must be taught before a task uses them. */
const CONTENT_POS = new Set(['noun', 'verb', 'adj']);
export const MAX_RU_LT_WORDS = 6;
const LT_TOKEN = /^[a-ząčęėįšųūž]+(?:-[a-ząčęėįšųūž]+)*$/;
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'blockquote']);

export interface ValidationEnv {
  lex: Lexicon;
  /** Lemmas the user has met by the task's lesson (dictionary + lesson word lists + portions). */
  known: (lessonNo: number) => Set<string>;
}

/** Lithuanian (Latin-script) word tokens of a text; Russian words are ignored. */
export function ltTokens(text: string): string[] {
  return tokenize(text.replace(/_+/g, ' ')).filter((t) => LT_TOKEN.test(t));
}

function texts(t: TaskInput): string[] {
  switch (t.kind) {
    case 'choice': return [t.question, ...t.options];
    case 'input': return [t.question, ...t.accept];
    case 'translate': return t.direction === 'ru-lt' ? t.accept : [t.source];
    case 'order': return [...t.words, ...t.accept];
    case 'reading': return [t.title, t.text, ...t.questions.flatMap((q) => [q.q, ...q.options])];
    case 'writing': return [t.prompt];
  }
}

export function validateTask(t: TaskInput, env: ValidationEnv): string[] {
  const errors: string[] = [];
  const exempt = new Set([...t.unverified, ...(t.kind === 'reading' ? Object.keys(t.glossary) : [])].flatMap(ltTokens));
  const known = env.known(t.lessonNo);
  const unknownForms = new Set<string>();
  const unlearned = new Set<string>();
  for (const token of texts(t).flatMap(ltTokens)) {
    if (exempt.has(token)) continue;
    const refs = env.lex.lemmasOf(token);
    if (!refs.length) {
      unknownForms.add(token);
      continue;
    }
    const content = refs.filter((r) => CONTENT_POS.has(r.pos));
    // A token that is also a pronoun/numeral/name/function word is fine; otherwise one of its lemmas must be known.
    if (content.length === refs.length && !content.some((r) => known.has(r.lemma.toLowerCase()))) {
      unlearned.add(`${token} (${[...new Set(content.map((r) => r.lemma))].join('/')})`);
    }
  }
  if (unknownForms.size) errors.push(`нет в лексиконе: ${[...unknownForms].join(', ')} (исправьте или добавьте в unverified)`);
  if (unlearned.size) errors.push(`слова ещё не изучены к уроку ${t.lessonNo}: ${[...unlearned].join(', ')}`);

  if (t.kind === 'input' && t.target) {
    const form = env.lex.form(t.target.lemma, t.target.key);
    if (!form) errors.push(`target: в лексиконе нет формы ${t.target.lemma} ${t.target.key}`);
    else if (!t.accept.some((a) => normalizeAnswer(a) === normalizeAnswer(form))) {
      errors.push(`target: форма ${t.target.lemma} ${t.target.key} = «${form}», её нет в accept`);
    }
  }
  if (t.kind === 'translate' && t.direction === 'ru-lt' && t.source.trim().split(/\s+/).length > MAX_RU_LT_WORDS) {
    errors.push(`перевод RU→LT длиннее ${MAX_RU_LT_WORDS} слов: используйте order`);
  }
  if (t.slot === 'new' && !t.portionKey) errors.push('задание slot=new должно иметь portionKey');
  return errors;
}

/** Checks theory HTML: only Telegram tags, balanced. */
export function validateTheory(html: string): string[] {
  const errors: string[] = [];
  const stack: string[] = [];
  for (const m of html.matchAll(/<\/?([a-z]+)[^>]*>/gi)) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      errors.push(`тег <${tag}> не поддерживается Telegram`);
      continue;
    }
    if (m[0].startsWith('</')) {
      if (stack.pop() !== tag) errors.push(`незакрытый или лишний тег </${tag}>`);
    } else stack.push(tag);
  }
  if (stack.length) errors.push(`незакрытые теги: ${stack.join(', ')}`);
  if (/&(?!amp;|lt;|gt;|quot;)/.test(html) || /<(?![a-z/])/i.test(html)) errors.push('экранируйте &, < и > как &amp; &lt; &gt;');
  return errors;
}
