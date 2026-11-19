import type { Recipe, Store, Task } from '../store/types';
import { taskFromVariant, type Variant } from '../tasks/from-variant';
import { tagClass, type TagStat } from './mastery';

/** At most this many tasks of one recipe per session. */
export const MAX_PER_RECIPE = 4;
/** Accuracy assumed for a tag without answers when ordering recipes. */
const UNKNOWN_TAG_ACCURACY = 0.8;

/** Weighted random sample without repeats (Efraimidis–Spirakis): key `rand() ** (1 / w)`, k largest; w ≤ 0 never chosen. */
export function weightedSample<T>(items: T[], weight: (t: T) => number, k: number, rand: () => number): T[] {
  return items
    .map((t) => ({ t, w: weight(t) }))
    .filter((x) => x.w > 0)
    .map((x) => ({ t: x.t, key: rand() ** (1 / x.w) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, Math.max(0, k))
    .map((x) => x.t);
}

/** A task that takes part in review rotation, regardless of its due date. */
export function isRotating(t: Task): boolean {
  return t.status !== 'retired' && t.kind !== 'writing' && (t.slot === 'review' || t.status === 'served');
}

/** Rotating tasks due by `now`, of lessons up to `maxLesson` (or exactly `onlyLesson`). */
export function rotatingCandidates(tasks: Task[], now: Date, maxLesson: number, onlyLesson?: number): Task[] {
  const at = now.getTime();
  return tasks.filter(
    (t) =>
      isRotating(t) &&
      new Date(t.dueAt ?? t.createdAt).getTime() <= at &&
      (onlyLesson === undefined ? t.lessonNo <= maxLesson : t.lessonNo === onlyLesson),
  );
}

const isWeakTag = (stats: Map<string, TagStat>) => (tag: string) => tagClass(stats.get(tag)) === 'weak';

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Materializes recipe variants that have no task yet, round-robin between recipes (weak-tag recipes first, then by
 * the lowest accuracy of their tags), keeping `perRecipe` under MAX_PER_RECIPE. Updates `perRecipe`.
 */
export async function fillFromRecipes(
  store: Store,
  opts: {
    now: Date;
    maxLesson: number;
    need: number;
    weakOnly: boolean;
    stats: Map<string, TagStat>;
    perRecipe: Map<string, number>;
    rand: () => number;
    onlyLesson?: number;
  },
): Promise<Task[]> {
  if (opts.need <= 0) return [];
  const weak = isWeakTag(opts.stats);
  const tagAccuracy = (tag: string) => {
    const s = opts.stats.get(tag);
    return s && s.answers ? s.accuracy : UNKNOWN_TAG_ACCURACY;
  };
  const accuracy = (r: Recipe) => (r.tags.length ? Math.min(...r.tags.map(tagAccuracy)) : UNKNOWN_TAG_ACCURACY);
  const recipes = (await store.listRecipes())
    .filter((r) => (opts.onlyLesson === undefined ? r.lessonNo <= opts.maxLesson : r.lessonNo === opts.onlyLesson))
    .filter((r) => !opts.weakOnly || r.tags.some(weak))
    .map((r) => ({ r, weak: r.tags.some(weak), acc: accuracy(r) }))
    .sort((a, b) => Number(b.weak) - Number(a.weak) || a.acc - b.acc)
    .map((x) => x.r);

  const queues: { r: Recipe; free: Variant[] }[] = [];
  for (const r of recipes) {
    if ((opts.perRecipe.get(r.id) ?? 0) >= MAX_PER_RECIPE) continue;
    const used = new Set((await store.listTasks({ recipeId: r.id })).map((t) => t.variantKey));
    const free = shuffle(r.variants.filter((v) => !used.has(v.key)), opts.rand);
    if (free.length) queues.push({ r, free });
  }

  const inputs: Parameters<Store['addTasks']>[0] = [];
  let progress = true;
  while (inputs.length < opts.need && progress) {
    progress = false;
    for (const q of queues) {
      if (inputs.length >= opts.need) break;
      const count = opts.perRecipe.get(q.r.id) ?? 0;
      const v = count < MAX_PER_RECIPE ? q.free.pop() : undefined;
      if (!v) continue;
      const present = v.present[Math.min(v.present.length - 1, Math.floor(opts.rand() * v.present.length))]!;
      const explanation = (q.r.payload as { explanation?: string } | null)?.explanation ?? '';
      inputs.push({
        payload: taskFromVariant({ lessonNo: q.r.lessonNo, tags: q.r.tags, explanation }, v, present, opts.rand),
        portionId: null,
        recipeId: q.r.id,
        variantKey: v.key,
      });
      opts.perRecipe.set(q.r.id, count + 1);
      progress = true;
    }
  }
  return inputs.length ? store.addTasks(inputs, opts.now.toISOString()) : [];
}

/** Reorders so that no more than 2 tasks of one recipe follow each other, when possible. */
export function spreadByRecipe(tasks: Task[]): Task[] {
  const rest = [...tasks];
  const out: Task[] = [];
  const left = new Map<string, number>();
  for (const t of tasks) if (t.recipeId) left.set(t.recipeId, (left.get(t.recipeId) ?? 0) + 1);
  while (rest.length) {
    const [a, b] = [out.at(-1)?.recipeId, out.at(-2)?.recipeId];
    const blocked = a && a === b ? a : null;
    // Non-blocked task of the recipe with the most tasks left (no recipe counts as 0; first wins ties); any if all blocked.
    let best = -1;
    rest.forEach((t, i) => {
      if (blocked && t.recipeId === blocked) return;
      const n = t.recipeId ? left.get(t.recipeId)! : 0;
      if (best < 0 || n > (rest[best]!.recipeId ? left.get(rest[best]!.recipeId!)! : 0)) best = i;
    });
    const [t] = rest.splice(Math.max(0, best), 1);
    if (t!.recipeId) left.set(t!.recipeId, left.get(t!.recipeId)! - 1);
    out.push(t!);
  }
  return out;
}
