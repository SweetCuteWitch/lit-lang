import type { Store } from '../store/types';

export interface Progress {
  lessonNo: number;
  /** Revision sessions spent on the current lesson after its portions ran out. */
  revisions: number;
}

export const ADVANCE_ACCURACY = 0.7;
export const MAX_REVISIONS = 3;
/** Answers of the lesson that count for its accuracy. */
export const ACCURACY_WINDOW = 20;
export const REVIEW_TASKS_PER_SESSION = 8;
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
  reviewReady: number;
  writingReady: number;
  /** Days of material left: each day needs one portion and one review session. */
  days: number;
  low: boolean;
}

export async function bankStatus(store: Store): Promise<BankStatus> {
  const { lessonNo } = await getProgress(store);
  const portionsReady = (await store.listPortions()).filter((p) => p.status === 'ready' && p.lessonNo >= lessonNo).length;
  const ready = await store.listTasks({ status: 'ready', slot: 'review' });
  const reviewReady = ready.filter((t) => t.kind !== 'writing').length;
  const writingReady = ready.length - reviewReady;
  const days = Math.min(portionsReady, Math.floor(reviewReady / REVIEW_TASKS_PER_SESSION));
  return { lessonNo, portionsReady, reviewReady, writingReady, days, low: days < BANK_WARNING_DAYS };
}
