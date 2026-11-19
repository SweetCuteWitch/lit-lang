import type { Portion } from '../store/types';
import { esc, formatLessonsList, formatPortion, formatVocabList } from '../telegram/format';
import { send, type BotCtx } from './context';

/** After «Уроки» the bot treats a bare number as a lesson choice for this long. */
export const AWAIT_LESSON_MS = 10 * 60_000;
const AWAIT_KEY = 'awaitingLesson';
const NUMBER = /^\d{1,3}$/;

interface AwaitingLesson {
  until: string;
}

export async function showVocab(ctx: BotCtx): Promise<void> {
  const chunks = formatVocabList(await ctx.store.listWords(), await ctx.store.listLessons());
  for (const text of chunks) await send(ctx, 'vocab', text);
}

/** Served portions grouped by lesson, in seq order. */
async function passedLessons(ctx: BotCtx): Promise<Map<number, Portion[]>> {
  const byLesson = new Map<number, Portion[]>();
  for (const p of await ctx.store.listPortions()) {
    if (p.status !== 'served') continue;
    byLesson.set(p.lessonNo, [...(byLesson.get(p.lessonNo) ?? []), p]);
  }
  for (const list of byLesson.values()) list.sort((a, b) => a.seq - b.seq);
  return new Map([...byLesson.entries()].sort(([a], [b]) => a - b));
}

export async function showLessons(ctx: BotCtx): Promise<void> {
  const passed = await passedLessons(ctx);
  const lessons = await ctx.store.listLessons();
  const list = [...passed.keys()].map((no) => ({ no, title: lessons.find((l) => l.no === no)?.title ?? '' }));
  await send(ctx, 'lessons', formatLessonsList(list));
  if (list.length) {
    const awaiting: AwaitingLesson = { until: new Date(ctx.now().getTime() + AWAIT_LESSON_MS).toISOString() };
    await ctx.store.setSetting(AWAIT_KEY, awaiting);
  }
}

/** Handles a bare number typed while a lesson choice is awaited. Returns false when the text is not that. */
export async function tryLessonNumber(ctx: BotCtx, text: string): Promise<boolean> {
  if (!NUMBER.test(text)) return false;
  const awaiting = await ctx.store.getSetting<AwaitingLesson | null>(AWAIT_KEY);
  if (!awaiting || new Date(awaiting.until).getTime() < ctx.now().getTime()) return false;
  const passed = await passedLessons(ctx);
  const portions = passed.get(Number(text));
  if (!portions) {
    await send(ctx, 'lessons', esc(`Такого урока пока нет. Доступны: ${[...passed.keys()].join(', ')}.`));
    return true;
  }
  const lesson = await ctx.store.getLesson(Number(text));
  for (const p of portions) await send(ctx, 'lessons', formatPortion(lesson, p));
  await ctx.store.setSetting(AWAIT_KEY, null);
  return true;
}
