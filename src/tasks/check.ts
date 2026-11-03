import { fold, normalizeAnswer } from '../text/normalize';

export interface CheckResult {
  correct: boolean;
  /** true when the answer matched with all diacritics; false = accepted without them, or wrong. */
  exact: boolean;
  /** The accepted answer to show the user. */
  expected: string;
}

export function checkText(answer: string, accept: string[], reject: string[] = []): CheckResult {
  const a = normalizeAnswer(answer);
  if (!a) return { correct: false, exact: false, expected: accept[0] };
  for (const ok of accept) {
    if (normalizeAnswer(ok) === a) return { correct: true, exact: true, expected: ok };
  }
  const folded = fold(a);
  if (reject.some((r) => fold(normalizeAnswer(r)) === folded)) {
    return { correct: false, exact: false, expected: accept[0] };
  }
  for (const ok of accept) {
    if (fold(normalizeAnswer(ok)) === folded) return { correct: true, exact: false, expected: ok };
  }
  return { correct: false, exact: false, expected: accept[0] };
}

export function checkChoice(chosen: number, correct: number): boolean {
  return chosen === correct;
}
