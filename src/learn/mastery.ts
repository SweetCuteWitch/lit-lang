import type { Store, Task } from '../store/types';
import { dayStart } from '../time';

export const TASK_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];
export const MAX_SCORE = 5;

const DAY_MS = 86_400_000;

export function nextTaskScore(score: number, r: { correct: boolean; exact: boolean }): number {
  if (!r.correct) return 0;
  return r.exact ? Math.min(MAX_SCORE, score + 1) : score;
}

/** Local Vilnius midnight after the interval for the score, as ISO. */
export function taskDueAt(score: number, now: Date): string {
  const days = TASK_INTERVAL_DAYS[Math.max(0, Math.min(MAX_SCORE, score))];
  return dayStart(new Date(dayStart(now).getTime() + days * DAY_MS + 12 * 3_600_000)).toISOString();
}

/**
 * New score and due date after an answer. A correct answer never brings the task back the next day:
 * an inexact one at score 0 keeps the score but is due after the score-1 interval.
 */
export function taskAfterAnswer(score: number, r: { correct: boolean; exact: boolean }, now: Date): { score: number; dueAt: string } {
  const next = nextTaskScore(score, r);
  return { score: next, dueAt: taskDueAt(r.correct ? Math.max(next, 1) : next, now) };
}

export interface TagStat {
  tag: string;
  answers: number;
  wrong: number;
  wrong7: number;
  accuracy: number;
}

export async function tagStats(store: Store, now: Date, days = 14): Promise<Map<string, TagStat>> {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const since7 = now.getTime() - 7 * DAY_MS;
  const stats = new Map<string, TagStat>();
  for (const a of await store.listAnswers({ kind: 'task', since })) {
    if (a.correct === null) continue;
    for (const tag of a.tags) {
      const s = stats.get(tag) ?? { tag, answers: 0, wrong: 0, wrong7: 0, accuracy: 1 };
      s.answers++;
      if (!a.correct) {
        s.wrong++;
        if (new Date(a.createdAt).getTime() >= since7) s.wrong7++;
      }
      s.accuracy = (s.answers - s.wrong) / s.answers;
      stats.set(tag, s);
    }
  }
  return stats;
}

export function tagClass(s: TagStat | undefined): 'weak' | 'mastered' | 'normal' {
  if (!s) return 'normal';
  if (s.wrong >= 3 || (s.answers >= 3 && s.wrong >= 1 && s.accuracy < 0.7)) return 'weak';
  if (s.answers >= 5 && s.wrong7 === 0 && s.accuracy >= 0.9) return 'mastered';
  return 'normal';
}

export function taskWeight(task: Pick<Task, 'score' | 'tags'>, stats: Map<string, TagStat>): number {
  const classes = task.tags.map((t) => tagClass(stats.get(t)));
  const base = MAX_SCORE + 1 - task.score;
  if (classes.includes('weak')) return base * 3;
  if (classes.length && classes.every((c) => c === 'mastered')) return base * 0.3;
  return base;
}
