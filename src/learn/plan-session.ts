import type { Portion, SessionItem, Store, Task } from '../store/types';
import { tagClass, tagStats, taskWeight } from './mastery';
import { fillFromRecipes, MAX_PER_RECIPE, rotatingCandidates, spreadByRecipe, weightedSample } from './pick';
import { decideAdvance, getProgress, lessonAccuracy, REVIEW_TASKS_PER_SESSION, setProgress } from './progress';

export const NEW_TASKS_PER_SESSION = 8;
export const REVIEW_IN_NEW_SESSION = 2;
export const WORDS_PER_SESSION = 3;
export const MAX_NEW_PER_DAY = 2;
/** Review slots given to weak-tag tasks when there are enough of them (own or from recipes). */
export const WEAK_TASKS_PER_SESSION = 6;
export const WRITING_EVERY_DAYS = 3;
export { MAX_PER_RECIPE };
const WEAK_TAG_DAYS = 14;

export type SessionPlan =
  | { empty: string }
  | { slot: 'new' | 'review'; portion: Portion | null; revision: boolean; items: SessionItem[] };

export interface PlanOptions {
  /** «Ещё новый материал»: a second new portion today (max MAX_NEW_PER_DAY). */
  preferNew?: boolean;
  /** Always build a review session. */
  forceReview?: boolean;
  /** Random generator for weighted choice (tests pass a seeded one). */
  rand?: () => number;
}

const taskItem = (t: Task): SessionItem => ({ type: 'task', taskId: t.id });

/**
 * Review tasks of lessons up to `lessonNo` (or only `onlyLesson`), due now: up to `weakMin` weak-tag tasks
 * (topped up from weak-tag recipes), the rest by weight (topped up from any recipes); shorter when nothing is left.
 * At most MAX_PER_RECIPE tasks per recipe, no more than 2 of one recipe in a row.
 */
async function pickReview(
  store: Store,
  now: Date,
  lessonNo: number,
  limit: number,
  opts: { onlyLesson?: number; weakMin: number; rand: () => number },
): Promise<Task[]> {
  const stats = await tagStats(store, now, WEAK_TAG_DAYS);
  const candidates = rotatingCandidates(await store.listTasks({}), now, lessonNo, opts.onlyLesson);
  const weight = (t: Task) => taskWeight(t, stats);
  const isWeak = (t: Task) => t.tags.some((tag) => tagClass(stats.get(tag)) === 'weak');
  const perRecipe = new Map<string, number>();
  const chosen: Task[] = [];
  const takeUpTo = (ordered: Task[], upTo: number) => {
    for (const t of ordered) {
      if (chosen.length >= upTo) return;
      if (t.recipeId) {
        const n = perRecipe.get(t.recipeId) ?? 0;
        if (n >= MAX_PER_RECIPE) continue;
        perRecipe.set(t.recipeId, n + 1);
      }
      chosen.push(t);
    }
  };
  const fill = async (upTo: number, weakOnly: boolean) =>
    chosen.push(
      ...(await fillFromRecipes(store, {
        now, maxLesson: lessonNo, onlyLesson: opts.onlyLesson, need: upTo - chosen.length, weakOnly, stats, perRecipe, rand: opts.rand,
      })),
    );

  const weakMin = Math.min(opts.weakMin, limit);
  if (weakMin > 0) {
    const weak = candidates.filter(isWeak);
    takeUpTo(weightedSample(weak, weight, weak.length, opts.rand), weakMin);
    if (chosen.length < weakMin) await fill(weakMin, true);
  }
  const rest = candidates.filter((t) => !chosen.includes(t));
  takeUpTo(weightedSample(rest, weight, rest.length, opts.rand), limit);
  if (chosen.length < limit) await fill(limit, false);
  return spreadByRecipe(chosen);
}

async function planNew(store: Store, now: Date, rand: () => number): Promise<SessionPlan> {
  // At most two passes: the second one runs after advancing to the next lesson.
  for (let pass = 0; pass < 2; pass++) {
    const progress = await getProgress(store);
    const portion = await store.nextPortion(progress.lessonNo);
    if (portion) {
      const own = await store.listTasks({ portionId: portion.id, status: 'ready', limit: NEW_TASKS_PER_SESSION });
      const review = await pickReview(store, now, progress.lessonNo, REVIEW_IN_NEW_SESSION, { weakMin: 0, rand });
      return { slot: 'new', portion, revision: false, items: [...own, ...review].map(taskItem) };
    }
    const served = (await store.listPortions(progress.lessonNo)).length;
    if (!served) return { empty: `Для урока ${progress.lessonNo} ещё нет материала. Он появится после следующей генерации.` };
    const decision = decideAdvance({ portionsReady: 0, accuracy: await lessonAccuracy(store, progress.lessonNo), revisions: progress.revisions });
    if (decision === 'advance') {
      await setProgress(store, { lessonNo: progress.lessonNo + 1, revisions: 0 });
      continue;
    }
    const revise = { weakMin: WEAK_TASKS_PER_SESSION, rand };
    const size = NEW_TASKS_PER_SESSION + REVIEW_IN_NEW_SESSION;
    const tasks = await pickReview(store, now, progress.lessonNo, size, { ...revise, onlyLesson: progress.lessonNo });
    const fill = tasks.length ? tasks : await pickReview(store, now, progress.lessonNo, size, revise);
    if (!fill.length) {
      await setProgress(store, { lessonNo: progress.lessonNo + 1, revisions: 0 });
      continue;
    }
    await setProgress(store, { lessonNo: progress.lessonNo, revisions: progress.revisions + 1 });
    return { slot: 'new', portion: null, revision: true, items: fill.map(taskItem) };
  }
  const { lessonNo } = await getProgress(store);
  return { empty: `Урок ${lessonNo} ещё не подготовлен. Материал появится после следующей генерации.` };
}

async function planReview(store: Store, now: Date, rand: () => number): Promise<SessionPlan> {
  const { lessonNo } = await getProgress(store);
  const words = await store.dueWords(now.toISOString(), WORDS_PER_SESSION);
  const tasks = await pickReview(store, now, lessonNo, REVIEW_TASKS_PER_SESSION, { weakMin: WEAK_TASKS_PER_SESSION, rand });
  const items: SessionItem[] = [...words.map((w): SessionItem => ({ type: 'word', wordId: w.id })), ...tasks.map(taskItem)];

  const lastWriting = (await store.listAnswers({ kind: 'writing', limit: 1 }))[0];
  const writingDue = !lastWriting || now.getTime() - new Date(lastWriting.createdAt).getTime() >= WRITING_EVERY_DAYS * 86_400_000;
  if (writingDue) {
    const writing = (await store.listTasks({ status: 'ready', kind: 'writing' })).find((t) => t.lessonNo <= lessonNo);
    if (writing) items.push(taskItem(writing));
  }
  if (!items.length) return { empty: 'Для закрепления пока нет заданий. Они появятся после следующей генерации.' };
  return { slot: 'review', portion: null, revision: false, items };
}

/**
 * Chooses the next session: new material when none was given today (or a second portion on
 * request), otherwise consolidation. `dayStart` is the start of the user's local day.
 */
export async function planSession(store: Store, now: Date, dayStart: Date, opts: PlanOptions = {}): Promise<SessionPlan> {
  const rand = opts.rand ?? Math.random;
  const newToday = (await store.listSessions(dayStart.toISOString())).filter((s) => s.slot === 'new').length;
  const wantNew = !opts.forceReview && (newToday === 0 || (opts.preferNew && newToday < MAX_NEW_PER_DAY));
  if (wantNew) {
    const plan = await planNew(store, now, rand);
    if (!('empty' in plan) || newToday > 0) return 'empty' in plan ? planReview(store, now, rand) : plan;
    const review = await planReview(store, now, rand);
    return 'empty' in review ? plan : review;
  }
  return planReview(store, now, rand);
}
