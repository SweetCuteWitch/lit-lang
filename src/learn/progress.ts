import type { Store } from '../store/types';
import { isRotating, rotatingCandidates } from './pick';

export interface Progress {
  lessonNo: number;
  /** Revision sessions spent on the current lesson after its portions ran out. */
  revisions: number;
}

export const ADVANCE_ACCURACY = 0.7;
export const MAX_REVISIONS = 3;
/** Answers of the lesson that count for its accuracy. */
export const ACCURACY_WINDOW = 20;
export const REVIEW_TASKS_PER_SESSION = 10;
export const BANK_WARNING_DAYS = 2;

export async function getProgress(store: Store): Promise<Progress> {
  return (await store.getSetting<Progress>('progress')) ?? { lessonNo: 1, revisions: 0 };
}

export async function setProgress(store: Store, p: Progress): Promise<void> {
  await store.setSetting('progress', p);
}

export type AdvanceDecision = 'continue' | 'revise' | 'advance';

export function decideAdvance(x: { portionsReady: number; accuracy: number; revisions: number }): AdvanceDecision {
  if (x.portionsReady > 0) return 'continue';
  if (x.accuracy >= ADVANCE_ACCURACY || x.revisions >= MAX_REVISIONS) return 'advance';
  return 'revise';
}

/** Share of correct answers among the last ACCURACY_WINDOW instant answers of the lesson; 1 when none. */
export async function lessonAccuracy(store: Store, lessonNo: number): Promise<number> {
  const answers = (await store.listAnswers({ kind: 'task', lessonNo, limit: ACCURACY_WINDOW })).filter((a) => a.correct !== null);
  if (!answers.length) return 1;
  return answers.filter((a) => a.correct).length / answers.length;
}

export async function weakTags(store: Store, now: Date, days: number): Promise<{ tag: string; count: number }[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const counts = new Map<string, number>();
  for (const a of await store.listAnswers({ kind: 'task', since })) {
    if (a.correct !== false) continue;
    for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export interface BankStatus {
  lessonNo: number;
  portionsReady: number;
  /** Tasks in review rotation (any due date). */
  reviewReady: number;
  /** Rotating tasks due now. */
  dueNow: number;
  writingReady: number;
  /** Days of new material left: one portion a day (review tasks rotate and do not run out). */
  days: number;
  low: boolean;
}

export async function bankStatus(store: Store, now: Date = new Date()): Promise<BankStatus> {
  const { lessonNo } = await getProgress(store);
  const portionsReady = (await store.listPortions()).filter((p) => p.status === 'ready' && p.lessonNo >= lessonNo).length;
  const all = await store.listTasks({});
  const reviewReady = all.filter((t) => isRotating(t) && t.lessonNo <= lessonNo).length;
  const dueNow = rotatingCandidates(all, now, lessonNo).length;
  const writingReady = all.filter((t) => t.kind === 'writing' && t.status === 'ready' && t.slot === 'review').length;
  return { lessonNo, portionsReady, reviewReady, dueNow, writingReady, days: portionsReady, low: portionsReady < BANK_WARNING_DAYS };
}
