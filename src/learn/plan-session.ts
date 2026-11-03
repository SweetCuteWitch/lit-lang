import type { Portion, SessionItem, Store, Task } from '../store/types';
import { decideAdvance, getProgress, lessonAccuracy, REVIEW_TASKS_PER_SESSION, setProgress, weakTags } from './progress';

export const NEW_TASKS_PER_SESSION = 8;
export const REVIEW_IN_NEW_SESSION = 2;
export const WORDS_PER_SESSION = 5;
export const MAX_NEW_PER_DAY = 2;
export const WEAK_TASKS_PER_SESSION = 3;
export const WRITING_EVERY_DAYS = 3;
const WEAK_TAG_DAYS = 14;

export type SessionPlan =
  | { empty: string }
  | { slot: 'new' | 'review'; portion: Portion | null; revision: boolean; items: SessionItem[] };

export interface PlanOptions {
  /** «Ещё новый материал»: a second new portion today (max MAX_NEW_PER_DAY). */
  preferNew?: boolean;
  /** Always build a review session. */
  forceReview?: boolean;
}

const taskItem = (t: Task): SessionItem => ({ type: 'task', taskId: t.id });

/** Review tasks of lessons up to `lessonNo`: up to WEAK_TASKS_PER_SESSION with weak tags first, then oldest. */
async function pickReview(store: Store, now: Date, lessonNo: number, limit: number, onlyLesson?: number): Promise<Task[]> {
  const pool = (await store.listTasks({ status: 'ready', slot: 'review' })).filter(
    (t) => t.kind !== 'writing' && (onlyLesson === undefined ? t.lessonNo <= lessonNo : t.lessonNo === onlyLesson),
  );
  const weak = new Set((await weakTags(store, now, WEAK_TAG_DAYS)).slice(0, 5).map((w) => w.tag));
  const weakFirst = pool.filter((t) => t.tags.some((tag) => weak.has(tag))).slice(0, Math.min(WEAK_TASKS_PER_SESSION, limit));
  const rest = pool.filter((t) => !weakFirst.includes(t));
  return [...weakFirst, ...rest].slice(0, limit);
}

async function planNew(store: Store, now: Date): Promise<SessionPlan> {
  // At most two passes: the second one runs after advancing to the next lesson.
  for (let pass = 0; pass < 2; pass++) {
    const progress = await getProgress(store);
    const portion = await store.nextPortion(progress.lessonNo);
    if (portion) {
      const own = await store.listTasks({ portionId: portion.id, status: 'ready', limit: NEW_TASKS_PER_SESSION });
      const review = await pickReview(store, now, progress.lessonNo, REVIEW_IN_NEW_SESSION);
      return { slot: 'new', portion, revision: false, items: [...own, ...review].map(taskItem) };
    }
    const served = (await store.listPortions(progress.lessonNo)).length;
    if (!served) return { empty: `Для урока ${progress.lessonNo} ещё нет материала. Он появится после следующей генерации.` };
    const decision = decideAdvance({ portionsReady: 0, accuracy: await lessonAccuracy(store, progress.lessonNo), revisions: progress.revisions });
    if (decision === 'advance') {
      await setProgress(store, { lessonNo: progress.lessonNo + 1, revisions: 0 });
      continue;
    }
    const tasks = await pickReview(store, now, progress.lessonNo, NEW_TASKS_PER_SESSION + REVIEW_IN_NEW_SESSION, progress.lessonNo);
    const fill = tasks.length ? tasks : await pickReview(store, now, progress.lessonNo, NEW_TASKS_PER_SESSION + REVIEW_IN_NEW_SESSION);
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

async function planReview(store: Store, now: Date): Promise<SessionPlan> {
  const { lessonNo } = await getProgress(store);
  const words = await store.dueWords(now.toISOString(), WORDS_PER_SESSION);
  const tasks = await pickReview(store, now, lessonNo, REVIEW_TASKS_PER_SESSION);
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
  const newToday = (await store.listSessions(dayStart.toISOString())).filter((s) => s.slot === 'new').length;
  const wantNew = !opts.forceReview && (newToday === 0 || (opts.preferNew && newToday < MAX_NEW_PER_DAY));
  if (wantNew) {
    const plan = await planNew(store, now);
    if (!('empty' in plan) || newToday > 0) return 'empty' in plan ? planReview(store, now) : plan;
    const review = await planReview(store, now);
    return 'empty' in review ? plan : review;
  }
  return planReview(store, now);
}
