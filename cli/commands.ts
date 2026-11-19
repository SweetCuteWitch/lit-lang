import { parseArgs } from 'node:util';
import { z } from 'zod';
import { send, TOPIC_NAMES, type BotCtx, type Topics } from '../src/bot/context';
import { MAX_SCORE, tagClass, tagStats, taskDueAt } from '../src/learn/mastery';
import { isRotating } from '../src/learn/pick';
import { bankStatus, getProgress, setProgress, weakTags } from '../src/learn/progress';
import type { Lexicon } from '../src/lexicon/lexicon';
import type { LexEntry } from '../src/lexicon/types';
import type { WordInput } from '../src/store/types';
import { taskFromVariant } from '../src/tasks/from-variant';
import { expandRecipe, RecipeInput } from '../src/tasks/recipe';
import { TaskInput } from '../src/tasks/schema';
import type { ValidationEnv } from '../src/tasks/validate';
import { validateTask, validateTheory } from '../src/tasks/validate';
import { esc } from '../src/telegram/format';
import { localDate } from '../src/time';

export interface CliDeps extends BotCtx {
  lex: () => Lexicon;
  out: (line: string) => void;
  readFile: (path: string) => string;
}

const LessonFile = z.array(z.object({
  no: z.number().int().min(1), title: z.string().min(1), grammar: z.string(), topic: z.string(), skill: z.string(), words: z.array(z.string()).default([]),
}));

const WordSpec = z.object({
  lemma: z.string().trim().min(1),
  translation: z.string().trim().min(1),
  example: z.string().optional(),
  /** Needed only for words missing from the lexicon. */
  pos: z.string().optional(),
  keyForms: z.array(z.string()).optional(),
});

const BankFile = z.object({
  portions: z.array(z.object({
    lessonNo: z.number().int().min(1), seq: z.number().int().min(1), theory: z.string().min(1), words: z.array(WordSpec).default([]),
  })).default([]),
  tasks: z.array(z.unknown()).default([]),
  recipes: z.array(z.unknown()).default([]),
});

const WritingReviewFile = z.array(z.object({ answerId: z.string().uuid(), review: z.string().min(1), tags: z.array(z.string()).default([]) }));
const DisputeFile = z.array(z.object({
  answerId: z.string().uuid(),
  verdict: z.enum(['correct', 'wrong']),
  note: z.string().min(1),
  /** verdict=correct: add the user's answer to the task's accepted answers. */
  addAccept: z.boolean().default(true),
  /** Take the task out of rotation (it is broken or ambiguous). */
  retireTask: z.boolean().default(false),
}));

const KEY_FORMS: Record<string, string[]> = {
  noun: ['nom.sg', 'gen.sg', 'acc.sg'], name: ['nom.sg', 'gen.sg', 'loc.sg'], verb: ['inf', 'pres.3', 'past.3'],
  adj: ['m.nom.sg', 'f.nom.sg'], num: ['m.nom', 'f.nom'], pron: ['nom.sg', 'gen.sg', 'dat.sg'],
};

function pickEntry(lex: Lexicon, lemma: string): LexEntry | undefined {
  const entries = lex.lookup(lemma);
  return entries.find((e) => e.pos !== 'other' && Object.keys(e.forms).length) ?? entries[0];
}

/** Fills pos, gender and key forms from the lexicon; words missing from it must bring their own. */
export function resolveWord(lex: Lexicon, spec: z.infer<typeof WordSpec>): { word?: WordInput; error?: string } {
  const e = pickEntry(lex, spec.lemma);
  if (e) {
    const keyForms = [...new Set((KEY_FORMS[e.pos] ?? []).map((k) => e.forms[k]?.[0]).filter((f): f is string => !!f))];
    return {
      word: {
        lemma: e.lemma, translation: spec.translation, pos: e.pos, gender: e.gender ?? null,
        keyForms: keyForms.length ? keyForms : [e.lemma], example: spec.example ?? null, verified: !e.derived,
      },
    };
  }
  if (!spec.pos || !spec.keyForms?.length) return { error: `слова «${spec.lemma}» нет в лексиконе: укажите pos и keyForms` };
  return { word: { lemma: spec.lemma, translation: spec.translation, pos: spec.pos, gender: null, keyForms: spec.keyForms, example: spec.example ?? null, verified: false } };
}

function fmtForms(e: LexEntry): string {
  const lines = [`${e.lemma} [${e.pos}${e.gender ? `, ${e.gender}` : ''}] — ${e.gloss}`];
  const keys = Object.keys(e.forms);
  for (let i = 0; i < keys.length; i += 6) {
    lines.push('  ' + keys.slice(i, i + 6).map((k) => `${k}=${e.forms[k].join('/')}`).join('  '));
  }
  return lines.join('\n');
}

async function knownLemmas(deps: CliDeps, extra: Map<number, string[]>) {
  const words = await deps.store.listWords();
  const lessons = await deps.store.listLessons();
  const portions = await deps.store.listPortions();
  return (lessonNo: number) => {
    const set = new Set<string>();
    const addAll = () => {
      for (const w of [...set]) if (w.includes(' ')) for (const part of w.split(/\s+/)) set.add(part);
    };
    for (const w of words) set.add(w.lemma.toLowerCase());
    for (const l of lessons) if (l.no <= lessonNo) for (const w of l.words) set.add(w.toLowerCase());
    for (const p of portions) if (p.lessonNo <= lessonNo) for (const w of p.words) set.add(w.lemma.toLowerCase());
    for (const [no, list] of extra) if (no <= lessonNo) for (const w of list) set.add(w.toLowerCase());
    addAll();
    return set;
  };
}

async function bankAdd(deps: CliDeps, file: string): Promise<number> {
  const parsed = BankFile.safeParse(JSON.parse(deps.readFile(file)));
  if (!parsed.success) {
    deps.out(`Ошибка формата файла: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return 1;
  }
  const lex = deps.lex();
  const now = deps.now().toISOString();
  let errors = 0;

  // Portions first: tasks refer to them by portionKey, and their words count as known.
  const portionIds = new Map<string, string>();
  for (const p of await deps.store.listPortions()) portionIds.set(`${p.lessonNo}.${p.seq}`, p.id);
  const extra = new Map<number, string[]>();
  for (const p of parsed.data.portions) {
    const key = `${p.lessonNo}.${p.seq}`;
    const problems = validateTheory(p.theory);
    const words: WordInput[] = [];
    for (const spec of p.words) {
      const r = resolveWord(lex, spec);
      if (r.error) problems.push(r.error);
      else words.push(r.word!);
    }
    if (portionIds.has(key)) problems.push('такая порция уже есть');
    if (problems.length) {
      errors++;
      deps.out(`✗ порция ${key}: ${problems.join('; ')}`);
      continue;
    }
    const saved = await deps.store.addPortion({ lessonNo: p.lessonNo, seq: p.seq, theory: p.theory, words });
    portionIds.set(key, saved.id);
    extra.set(p.lessonNo, [...(extra.get(p.lessonNo) ?? []), ...words.map((w) => w.lemma)]);
    deps.out(`✓ порция ${key}: ${words.length} слов${words.some((w) => !w.verified) ? ` (непроверенных: ${words.filter((w) => !w.verified).length})` : ''}`);
  }

  const known = await knownLemmas(deps, extra);
  const valid: { payload: TaskInput; portionId: string | null }[] = [];
  parsed.data.tasks.forEach((raw, i) => {
    const t = TaskInput.safeParse(raw);
    if (!t.success) {
      errors++;
      deps.out(`✗ задание #${i}: ${t.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
      return;
    }
    const problems = validateTask(t.data, { lex, known });
    const portionId = t.data.portionKey ? portionIds.get(t.data.portionKey) ?? null : null;
    if (t.data.portionKey && !portionId) problems.push(`порции ${t.data.portionKey} нет`);
    if (problems.length) {
      errors++;
      deps.out(`✗ задание #${i} (${t.data.kind}): ${problems.join('; ')}`);
      return;
    }
    valid.push({ payload: t.data, portionId });
  });
  await deps.store.addTasks(valid, now);
  deps.out(`Сохранено заданий: ${valid.length}, отклонено: ${errors ? `${errors} (исправьте и отправьте только их)` : 0}`);

  for (const [i, raw] of parsed.data.recipes.entries()) {
    if (!(await addRecipe(deps, { lex, known }, raw, i))) errors++;
  }
  return errors ? 1 : 0;
}

/**
 * Saves one recipe. Replacing a recipe of the same name retires tasks of variants that are gone and rebuilds
 * tasks whose answer changed (mastery reset, due now); tasks of unchanged variants keep their counters.
 */
async function addRecipe(deps: CliDeps, env: ValidationEnv, raw: unknown, i: number): Promise<boolean> {
  const r = RecipeInput.safeParse(raw);
  if (!r.success) {
    deps.out(`✗ рецепт #${i}: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    return false;
  }
  const { variants, warnings } = expandRecipe(r.data, env);
  if (!variants.length) {
    deps.out(`✗ рецепт #${i} (${r.data.name}): нет ни одного варианта${warnings.length ? `; ${warnings.join('; ')}` : ''}`);
    return false;
  }
  const now = deps.now();
  const old = await deps.store.getRecipe(r.data.name);
  const saved = await deps.store.upsertRecipe(
    { name: r.data.name, kind: r.data.kind, lessonNo: r.data.lessonNo, tags: r.data.tags, payload: r.data, variants },
    now.toISOString(),
  );
  deps.out(`✓ рецепт ${saved.name} (урок ${saved.lessonNo}): ${variants.length} вариантов`);
  for (const w of warnings) deps.out(`  ⚠ ${w}`);
  if (!old) return true;

  const oldByKey = new Map(old.variants.map((v) => [v.key, v]));
  const newByKey = new Map(variants.map((v) => [v.key, v]));
  const gone: string[] = [];
  let rebuilt = 0;
  for (const t of await deps.store.listTasks({ recipeId: saved.id })) {
    if (t.status === 'retired' || !t.variantKey) continue;
    const v = newByKey.get(t.variantKey);
    if (!v) {
      gone.push(t.id);
      continue;
    }
    const before = oldByKey.get(t.variantKey);
    if (before && before.answer === v.answer) continue;
    const present = v.present.find((p) => p === t.kind) ?? v.present[0]!;
    await deps.store.updateTaskPayload(t.id, taskFromVariant(r.data, v, present));
    await deps.store.updateTaskScore(t.id, 0, now.toISOString());
    rebuilt++;
  }
  if (gone.length) await deps.store.setTaskStatus(gone, 'retired');
  if (gone.length || rebuilt) deps.out(`  замена: снято заданий ${gone.length}, обновлено ${rebuilt}`);
  return true;
}

async function recipesRetire(deps: CliDeps, name: string): Promise<number> {
  const r = await deps.store.getRecipe(name);
  if (!r) {
    deps.out(`✗ рецепта ${name} нет`);
    return 1;
  }
  const ids = (await deps.store.listTasks({ recipeId: r.id })).filter((t) => t.status !== 'retired').map((t) => t.id);
  if (ids.length) await deps.store.setTaskStatus(ids, 'retired');
  await deps.store.upsertRecipe({ name: r.name, kind: r.kind, lessonNo: r.lessonNo, tags: r.tags, payload: r.payload, variants: [] }, deps.now().toISOString());
  deps.out(`✓ рецепт ${name} снят: заданий ${ids.length}`);
  return 0;
}

async function recipesList(deps: CliDeps) {
  const recipes = await deps.store.listRecipes();
  if (!recipes.length) return deps.out('Рецептов нет');
  for (const r of recipes) {
    const live = new Set((await deps.store.listTasks({ recipeId: r.id })).filter((t) => t.status !== 'retired').map((t) => t.variantKey));
    const used = r.variants.filter((v) => live.has(v.key)).length;
    deps.out(`${r.name}\tурок ${r.lessonNo}\t${r.tags.join(',')}\tиспользовано ${used} из ${r.variants.length} вариантов`);
  }
}

async function status(deps: CliDeps) {
  const progress = await getProgress(deps.store);
  const lesson = await deps.store.getLesson(progress.lessonNo);
  const now = deps.now();
  const bank = await bankStatus(deps.store, now);
  const lessons = await deps.store.listLessons();
  deps.out(`Урок: ${progress.lessonNo}/${lessons.length}${lesson ? ` «${lesson.title}» — ${lesson.grammar}; тема: ${lesson.topic}` : ' (нет в программе)'}`);
  deps.out(`Повторений урока: ${progress.revisions}`);
  const portions = await deps.store.listPortions(progress.lessonNo);
  deps.out(`Порции урока: ${portions.map((p) => `${p.seq}${p.status === 'served' ? '✓' : ''}`).join(' ') || 'нет'}`);
  deps.out(`Запас: ~${bank.days} дн. нового материала (порций: ${bank.portionsReady}, письмо: ${bank.writingReady})${bank.low ? ' — МАЛО' : ''}`);
  const all = await deps.store.listTasks({});
  const byScore = Array.from({ length: MAX_SCORE + 1 }, () => 0);
  for (const t of all) if (isRotating(t) && t.lessonNo <= progress.lessonNo) byScore[Math.max(0, Math.min(MAX_SCORE, t.score))]!++;
  deps.out(`В обороте: ${bank.reviewReady} заданий, к показу сейчас: ${bank.dueNow}; по score 0–${MAX_SCORE}: ${byScore.join('/')}`);
  const recipes = await deps.store.listRecipes();
  const usedKeys = new Set(all.filter((t) => t.recipeId).map((t) => `${t.recipeId}|${t.variantKey}`));
  const unused = recipes.reduce((n, r) => n + r.variants.filter((v) => !usedKeys.has(`${r.id}|${v.key}`)).length, 0);
  deps.out(`Рецепты: ${recipes.length} (неиспользованных вариантов: ${unused})`);
  const stats = [...(await tagStats(deps.store, now)).values()];
  const listTags = (cls: 'weak' | 'mastered') =>
    stats.filter((s) => tagClass(s) === cls).sort((a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag))
      .map((s) => `${s.tag} ${Math.round(s.accuracy * 100)}%`).join(', ') || 'нет';
  deps.out(`Слабые темы: ${listTags('weak')}`);
  deps.out(`Освоенные темы: ${listTags('mastered')}`);
  const ready = all.filter((t) => t.status === 'ready');
  const byKind = ready.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] ?? 0) + 1 }), {});
  deps.out(`Готовые задания по типам: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'нет'}`);
  const unverified = ready.filter((t) => t.payload.unverified.length).length;
  const words = await deps.store.listWords();
  deps.out(`Словарь: ${words.length} слов (непроверенных: ${words.filter((w) => !w.verified).length}); заданий с unverified: ${unverified}`);
  deps.out(`Ждут разбора: письма ${(await deps.store.listAnswers({ pendingReview: true })).length}, спорные ответы ${(await deps.store.listAnswers({ pendingDispute: true })).length}`);
  const since = new Date(deps.now().getTime() - 7 * 86_400_000).toISOString();
  const sessions = (await deps.store.listSessions(since)).filter((s) => s.total > 0);
  deps.out(`Занятия за 7 дней: ${sessions.map((s) => `${localDate(new Date(s.startedAt))} ${s.slot} ${s.correct}/${s.total}`).join('; ') || 'нет'}`);
}

async function weakSpots(deps: CliDeps, days: number) {
  const tags = await weakTags(deps.store, deps.now(), days);
  if (!tags.length) return deps.out(`Ошибок за ${days} дн. нет`);
  for (const t of tags.slice(0, 15)) deps.out(`${t.count}\t${t.tag}`);
  const since = new Date(deps.now().getTime() - days * 86_400_000).toISOString();
  const wrong = (await deps.store.listAnswers({ kind: 'task', since, limit: 200 })).filter((a) => a.correct === false).slice(0, 15);
  deps.out('Последние ошибки:');
  for (const a of wrong) {
    const t = a.taskId ? await deps.store.getTask(a.taskId) : null;
    const p = t?.payload as { question?: string; source?: string; accept?: string[] } | undefined;
    deps.out(`  [${a.tags.join(',')}] ${p?.question ?? p?.source ?? t?.kind ?? '?'} → ответ «${a.answer || '—'}», верно «${p?.accept?.[0] ?? '?'}»`);
  }
}

async function writingPending(deps: CliDeps) {
  const list = await deps.store.listAnswers({ pendingReview: true });
  if (!list.length) return deps.out('Нет писем без разбора');
  for (const a of list) {
    const t = a.taskId ? await deps.store.getTask(a.taskId) : null;
    deps.out(`answerId=${a.id} урок=${a.lessonNo ?? '?'}\nЗадание: ${t?.payload.kind === 'writing' ? t.payload.prompt : '(без задания)'}\nТекст: ${a.answer}\n`);
  }
}

async function writingReview(deps: CliDeps, file: string): Promise<number> {
  const list = WritingReviewFile.parse(JSON.parse(deps.readFile(file)));
  let errors = 0;
  for (const r of list) {
    const a = await deps.store.getAnswer(r.answerId);
    if (!a || a.kind !== 'writing') {
      errors++;
      deps.out(`✗ ${r.answerId}: письмо не найдено`);
      continue;
    }
    const problems = validateTheory(r.review);
    if (problems.length) {
      errors++;
      deps.out(`✗ ${r.answerId}: ${problems.join('; ')}`);
      continue;
    }
    await deps.store.updateAnswer(a.id, { review: r.review, reviewedAt: deps.now().toISOString(), ...(r.tags.length ? { tags: r.tags } : {}) });
    await send(deps, 'writing', `🧑‍🏫 <b>Разбор письма</b>\n\n<i>${esc(a.answer.slice(0, 300))}${a.answer.length > 300 ? '…' : ''}</i>\n\n${r.review}`);
    deps.out(`✓ ${r.answerId}: разбор отправлен`);
  }
  return errors ? 1 : 0;
}

async function disputesPending(deps: CliDeps) {
  const list = await deps.store.listAnswers({ pendingDispute: true });
  if (!list.length) return deps.out('Нет спорных ответов');
  for (const a of list) {
    const t = a.taskId ? await deps.store.getTask(a.taskId) : null;
    deps.out(`answerId=${a.id}\nЗадание: ${JSON.stringify(t?.payload)}\nОтвет пользователя: ${a.answer}\n`);
  }
}

async function disputesResolve(deps: CliDeps, file: string): Promise<number> {
  const list = DisputeFile.parse(JSON.parse(deps.readFile(file)));
  let errors = 0;
  for (const r of list) {
    const a = await deps.store.getAnswer(r.answerId);
    if (!a || !a.disputed) {
      errors++;
      deps.out(`✗ ${r.answerId}: спорный ответ не найден`);
      continue;
    }
    const task = a.taskId ? await deps.store.getTask(a.taskId) : null;
    if (r.verdict === 'correct' && r.addAccept && task && 'accept' in task.payload && !task.payload.accept.includes(a.answer)) {
      await deps.store.updateTaskPayload(task.id, { ...task.payload, accept: [...task.payload.accept, a.answer] } as TaskInput);
    }
    if (task && r.verdict === 'wrong') await deps.store.updateTaskScore(task.id, 0, taskDueAt(0, deps.now()));
    if (task && r.retireTask) await deps.store.setTaskStatus([task.id], 'retired');
    await deps.store.updateAnswer(a.id, { disputeNote: r.note, correct: r.verdict === 'correct' });
    const head = r.verdict === 'correct' ? '✅ Спорный ответ засчитан' : '❌ Спорный ответ всё-таки неверный';
    await send(deps, 'training', `${head}: «${esc(a.answer)}»\n<i>${esc(r.note)}</i>`);
    deps.out(`✓ ${r.answerId}: ${r.verdict}${task && r.retireTask ? ', задание снято' : ''}`);
  }
  return errors ? 1 : 0;
}

async function setupTopics(deps: CliDeps) {
  const topics: Topics = {};
  for (const [key, name] of Object.entries(TOPIC_NAMES) as [keyof Topics, string][]) {
    const t = await deps.api.createForumTopic(deps.chatId, name);
    topics[key] = t.message_thread_id;
    deps.out(`✓ ${name}: ${t.message_thread_id}`);
  }
  await deps.store.setSetting('topics', topics);
}

export const USAGE = `Команды:
  status                         прогресс, запас заданий, что ждёт разбора
  weak-spots [--days 14]         частые ошибки по тегам и последние ошибки
  course load [--file course/lessons.json] | course show [N]
  vocab [--due]                  словарь пользователя
  inflect <лемма>                все формы слова из лексикона
  lookup <форма>                 чьей формой является слово
  bank add --file <json>         добавить порции, задания и рецепты (проверяются лексиконом);
                                 рецепт с тем же name заменяется: исчезнувшие варианты сняты, изменённые обновлены
  recipes list                   рецепты: урок, теги, сколько вариантов использовано
  recipes retire <name>          снять все задания рецепта и опустошить его
  writing pending | writing review --file <json>
  disputes pending | disputes resolve --file <json>   (verdict wrong сбрасывает score; retireTask снимает задание)
  progress set --lesson N        вручную сменить текущий урок
  topics setup | topics set --lessons N --training N --vocab N --writing N | topics clear`;

export async function runCommand(argv: string[], deps: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      file: { type: 'string' }, days: { type: 'string' }, due: { type: 'boolean' }, lesson: { type: 'string' },
      lessons: { type: 'string' }, training: { type: 'string' }, vocab: { type: 'string' }, writing: { type: 'string' },
    },
  });
  const [cmd, sub] = positionals;
  const needFile = () => {
    if (!values.file) throw new Error('нужен --file <path>');
    return values.file;
  };
  switch (cmd) {
    case 'status':
      await status(deps);
      return 0;
    case 'weak-spots':
      await weakSpots(deps, Number(values.days ?? 14));
      return 0;
    case 'course':
      if (sub === 'load') {
        const lessons = LessonFile.parse(JSON.parse(deps.readFile(values.file ?? 'course/lessons.json')));
        await deps.store.upsertLessons(lessons);
        deps.out(`Загружено уроков: ${lessons.length}`);
        return 0;
      }
      if (sub === 'show') {
        const no = Number(positionals[2] ?? (await getProgress(deps.store)).lessonNo);
        const l = await deps.store.getLesson(no);
        if (!l) {
          deps.out(`Урока ${no} нет`);
          return 1;
        }
        deps.out(`Урок ${l.no}: ${l.title}\nГрамматика: ${l.grammar}\nТема: ${l.topic}\nНавык: ${l.skill}\nСлова: ${l.words.join(', ')}`);
        for (const p of await deps.store.listPortions(no)) deps.out(`  порция ${p.seq} [${p.status}]: ${p.words.map((w) => w.lemma).join(', ')}`);
        return 0;
      }
      break;
    case 'vocab': {
      const list = values.due ? await deps.store.dueWords(deps.now().toISOString(), 1000) : await deps.store.listWords();
      for (const w of list) deps.out(`${w.lemma}\t${w.translation}\tурок ${w.lessonNo}\tbox ${w.box}${w.verified ? '' : '\t(непроверено)'}`);
      deps.out(`Всего: ${list.length}`);
      return 0;
    }
    case 'inflect': {
      const entries = deps.lex().lookup(sub ?? '');
      if (!entries.length) {
        deps.out(`«${sub}» нет в лексиконе`);
        return 1;
      }
      for (const e of entries) deps.out(fmtForms(e));
      return 0;
    }
    case 'lookup': {
      const refs = deps.lex().lemmasOf(sub ?? '');
      if (!refs.length) {
        deps.out(`«${sub}» нет в лексиконе`);
        return 1;
      }
      for (const r of refs) deps.out(`${r.lemma} [${r.pos}] ${r.key}`);
      return 0;
    }
    case 'bank':
      if (sub === 'add') return bankAdd(deps, needFile());
      break;
    case 'recipes':
      if (sub === 'list') return recipesList(deps).then(() => 0);
      if (sub === 'retire' && positionals[2]) return recipesRetire(deps, positionals[2]);
      break;
    case 'writing':
      if (sub === 'pending') return writingPending(deps).then(() => 0);
      if (sub === 'review') return writingReview(deps, needFile());
      break;
    case 'disputes':
      if (sub === 'pending') return disputesPending(deps).then(() => 0);
      if (sub === 'resolve') return disputesResolve(deps, needFile());
      break;
    case 'progress':
      if (sub === 'set' && values.lesson) {
        await setProgress(deps.store, { lessonNo: Number(values.lesson), revisions: 0 });
        deps.out(`Текущий урок: ${values.lesson}`);
        return 0;
      }
      break;
    case 'topics':
      if (sub === 'setup') return setupTopics(deps).then(() => 0);
      if (sub === 'clear') {
        await deps.store.setSetting('topics', null);
        deps.out('Темы отключены: всё идёт в основной чат');
        return 0;
      }
      if (sub === 'set') {
        const num = (v?: string) => (v ? Number(v) : null);
        await deps.store.setSetting('topics', { lessons: num(values.lessons), training: num(values.training), vocab: num(values.vocab), writing: num(values.writing) });
        deps.out('Темы сохранены');
        return 0;
      }
      break;
  }
  deps.out(USAGE);
  return 2;
}
