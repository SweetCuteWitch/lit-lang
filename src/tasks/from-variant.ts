import type { TaskInput } from './schema';

export type Present = 'input' | 'choice' | 'order';
export interface Variant {
  key: string;
  frame: number;
  lemma: string;
  question: string;
  answer: string;
  accept: string[];
  reject: string[];
  distractors: string[];
  orderWords: string[] | null;
  present: Present[];
  note: string;
  target: { lemma: string; key: string } | null;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Turns one recipe variant into an ordinary review task payload. */
export function taskFromVariant(
  r: { lessonNo: number; tags: string[]; explanation: string },
  v: Variant,
  present: Present,
  rand: () => number = Math.random,
): TaskInput {
  const base = {
    lessonNo: r.lessonNo,
    slot: 'review' as const,
    tags: r.tags,
    unverified: [] as string[],
    explanation: [r.explanation, v.note].filter(Boolean).join(' '),
  };
  if (present === 'input') {
    return { kind: 'input', question: v.question, accept: v.accept, reject: v.reject, target: v.target ?? undefined, ...base };
  }
  if (present === 'choice') {
    const options = shuffle([v.answer, ...v.distractors], rand);
    return { kind: 'choice', question: v.question, options, correct: options.indexOf(v.answer), ...base };
  }
  if (!v.orderWords) throw new Error(`variant ${v.key} has no orderWords`);
  let words = shuffle(v.orderWords, rand);
  if (words.every((w, i) => w === v.orderWords![i])) words = [...words.slice(1), words[0]!];
  const hint = v.target ? v.question.match(/\([^()]*\)\s*$/)?.[0] : undefined;
  return {
    kind: 'order',
    question: hint ? `Соберите фразу ${hint.trim()}` : 'Соберите фразу',
    words,
    accept: [v.orderWords.join(' ')],
    ...base,
  };
}
