/** Days until the next review for a word that has just reached this box. */
export const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16, 32];
export const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;
const FORGOT_MINUTES = 10;

/** Leitner step: remembered → next box, forgotten → box 1, shown again in 10 minutes. */
export function nextBox(box: number, remembered: boolean, now: Date): { box: number; dueAt: string } {
  if (!remembered) return { box: 1, dueAt: new Date(now.getTime() + FORGOT_MINUTES * 60_000).toISOString() };
  const next = Math.min(box + 1, MAX_BOX);
  return { box: next, dueAt: new Date(now.getTime() + BOX_INTERVAL_DAYS[next] * 86_400_000).toISOString() };
}
