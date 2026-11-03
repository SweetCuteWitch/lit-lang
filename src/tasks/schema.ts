import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const answers = z.array(nonEmpty).min(1);

const common = {
  lessonNo: z.number().int().min(1),
  /** new = belongs to a lesson portion (morning); review = consolidation pool (evening). */
  slot: z.enum(['new', 'review']),
  tags: z.array(nonEmpty).default([]),
  /** Links a "new" task to its portion: `<lessonNo>.<seq>`. */
  portionKey: z.string().regex(/^\d+\.\d+$/).optional(),
  /** Lithuanian words used on purpose that the lexicon does not know (shown in status). */
  unverified: z.array(nonEmpty).default([]),
};

const choice = z.object({
  kind: z.literal('choice'),
  question: nonEmpty,
  options: z.array(nonEmpty).min(2).max(6),
  correct: z.number().int().min(0),
  explanation: z.string().default(''),
  ...common,
}).refine((t) => t.correct < t.options.length, { message: 'correct is out of range', path: ['correct'] });

const input = z.object({
  kind: z.literal('input'),
  question: nonEmpty,
  accept: answers,
  reject: z.array(nonEmpty).default([]),
  /** The lexicon form the answer must be: lemma + form key (e.g. pres.1sg, gen.sg, f.acc.sg). */
  target: z.object({ lemma: nonEmpty, key: nonEmpty }).optional(),
  explanation: z.string().default(''),
  ...common,
});

const translate = z.object({
  kind: z.literal('translate'),
  direction: z.enum(['ru-lt', 'lt-ru']),
  source: nonEmpty,
  accept: answers,
  reject: z.array(nonEmpty).default([]),
  explanation: z.string().default(''),
  ...common,
});

const order = z.object({
  kind: z.literal('order'),
  question: nonEmpty,
  words: z.array(nonEmpty).min(2).max(12),
  accept: answers,
  explanation: z.string().default(''),
  ...common,
});

const reading = z.object({
  kind: z.literal('reading'),
  title: z.string().default(''),
  text: nonEmpty,
  questions: z.array(z.object({
    q: nonEmpty,
    options: z.array(nonEmpty).min(2).max(4),
    correct: z.number().int().min(0),
  }).refine((q) => q.correct < q.options.length, { message: 'correct is out of range' })).min(1).max(6),
  glossary: z.record(z.string(), z.string()).default({}),
  ...common,
});

const writing = z.object({
  kind: z.literal('writing'),
  prompt: nonEmpty,
  minWords: z.number().int().min(5).default(30),
  maxWords: z.number().int().min(10).default(50),
  ...common,
});

export const TaskInput = z.union([choice, input, translate, order, reading, writing]);
export type TaskInput = z.infer<typeof TaskInput>;
export type TaskKind = TaskInput['kind'];
export type TaskOf<K extends TaskKind> = Extract<TaskInput, { kind: K }>;

/** Tasks the bot checks immediately (everything except writing). */
export function isInstant(t: TaskInput): boolean {
  return t.kind !== 'writing';
}
