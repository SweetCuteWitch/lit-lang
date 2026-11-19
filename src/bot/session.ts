import { bankStatus } from '../learn/progress';
import { planSession, type PlanOptions } from '../learn/plan-session';
import { taskAfterAnswer, taskDueAt } from '../learn/mastery';
import { nextBox } from '../learn/srs';
import type { Session, Task } from '../store/types';
import { checkText, type CheckResult } from '../tasks/check';
import type { TaskOf } from '../tasks/schema';
import {
  afterSessionButtons, esc, formatChoice, formatFeedback, formatOrder, formatReading, formatSummary, formatTyped,
  formatWordBack, formatWordFront, formatWritingPrompt, TEXT, wordCardBody,
} from '../telegram/format';
import { dayStart } from '../time';
import type { SendOptions } from '../telegram/api';
import { deleteAll, send, type BotCtx } from './context';

/** A session left unfinished for this long is closed when a new one starts. */
export const ABANDON_AFTER_MS = 3 * 3600_000;

export interface PendingWriting {
  taskId: string;
  messageId: number;
}

async function save(ctx: BotCtx, s: Session) {
  const { id, ...rest } = s;
  await ctx.store.updateSession(id, rest);
}

/** Sends an interactive message to the training topic; it is deleted when the session ends. */
async function sendTracked(ctx: BotCtx, s: Session, text: string, markup?: SendOptions['markup']) {
  const m = await send(ctx, 'training', text, { markup });
  s.messageIds.push(m.message_id);
  return m.message_id;
}

export async function closeSession(ctx: BotCtx, s: Session, keep: number[] = []) {
  await deleteAll(ctx, s.messageIds.filter((id) => !keep.includes(id)));
  s.finishedAt = ctx.now().toISOString();
  s.messageIds = [];
  await save(ctx, s);
}

async function finish(ctx: BotCtx, s: Session) {
  await closeSession(ctx, s, s.state.lastFeedbackId ? [s.state.lastFeedbackId] : []);
  const weak = [...new Set(s.state.mistakes ?? [])].slice(0, 5);
  const bank = await bankStatus(ctx.store, ctx.now());
  await send(ctx, 'training', formatSummary(s.correct, s.total, weak, bank), { markup: afterSessionButtons() });
}

async function postPortion(ctx: BotCtx, s: Session) {
  if (!s.portionId) return;
  const portion = await ctx.store.getPortion(s.portionId);
  if (!portion) return;
  const lesson = await ctx.store.getLesson(portion.lessonNo);
  const title = lesson ? `Урок ${lesson.no}: ${esc(lesson.title)}` : `Урок ${portion.lessonNo}`;
  await send(ctx, 'lessons', `📚 <b>${title}</b> · часть ${portion.seq}\n\n${portion.theory}`);
  const now = ctx.now().toISOString();
  for (const w of portion.words) {
    await ctx.store.upsertWord(w, portion.lessonNo, now);
    await send(ctx, 'vocab', `🆕 ${wordCardBody(w)}`);
  }
  await ctx.store.markPortionServed(portion.id, now);
}

export async function startSession(ctx: BotCtx, opts: PlanOptions = {}) {
  const now = ctx.now();
  const active = await ctx.store.activeSession();
  if (active) {
    if (now.getTime() - new Date(active.startedAt).getTime() < ABANDON_AFTER_MS) return sendCurrent(ctx, active);
    await closeSession(ctx, active);
  }
  const plan = await planSession(ctx.store, now, dayStart(now), opts);
  if ('empty' in plan) {
    await send(ctx, 'training', `😴 ${esc(plan.empty)}`);
    return;
  }
  const s = await ctx.store.createSession({
    slot: plan.slot, portionId: plan.portion?.id ?? null, startedAt: now.toISOString(), finishedAt: null, items: plan.items,
    cursor: 0, messageIds: [], lastUpdateId: null, state: {}, correct: 0, total: 0,
  });
  await ctx.store.setTaskStatus(plan.items.flatMap((i) => (i.type === 'task' ? [i.taskId] : [])), 'served');
  await postPortion(ctx, s);
  await sendTracked(ctx, s, TEXT.sessionIntro(plan.slot, plan.revision, plan.items.length));
  await sendCurrent(ctx, s);
}

export async function currentTask(ctx: BotCtx, s: Session): Promise<Task | null> {
  const item = s.items[s.cursor];
  return item?.type === 'task' ? ctx.store.getTask(item.taskId) : null;
}

/** Sends the item at the cursor (skipping missing ones), or finishes the session. */
export async function sendCurrent(ctx: BotCtx, s: Session): Promise<void> {
  while (s.cursor < s.items.length) {
    const item = s.items[s.cursor];
    const n = s.cursor + 1;
    const total = s.items.length;
    if (item.type === 'word') {
      const w = await ctx.store.getWord(item.wordId);
      if (w) {
        const f = formatWordFront(w, n, total);
        s.state = { mistakes: s.state.mistakes, promptId: await sendTracked(ctx, s, f.text, f.markup) };
        return save(ctx, s);
      }
    } else {
      const task = await ctx.store.getTask(item.taskId);
      if (task) {
        const p = task.payload;
        if (p.kind === 'writing') {
          const m = await send(ctx, 'writing', formatWritingPrompt(p));
          const pending: PendingWriting = { taskId: task.id, messageId: m.message_id };
          await ctx.store.setSetting('pendingWriting', pending);
          await sendTracked(ctx, s, '📝 Письменное задание отправлено в тему «Письмо». Ответить можно в любое время.');
        } else {
          const f =
            p.kind === 'choice' ? formatChoice(p, n, total)
            : p.kind === 'order' ? formatOrder(p, [], n, total)
            : p.kind === 'reading' ? formatReading(p, 0, n, total)
            : formatTyped(p, n, total);
          s.state = { mistakes: s.state.mistakes, promptId: await sendTracked(ctx, s, f.text, f.markup), picked: [], question: 0 };
          return save(ctx, s);
        }
      }
    }
    s.cursor++;
  }
  await finish(ctx, s);
}

async function feedback(ctx: BotCtx, s: Session, task: Task, answer: string, r: CheckResult, explanation: string, tags = task.tags) {
  const a = await ctx.store.addAnswer({
    kind: 'task', taskId: task.id, wordId: null, sessionId: s.id, answer, correct: r.correct, exact: r.exact, tags, lessonNo: task.lessonNo,
    createdAt: ctx.now().toISOString(),
  });
  s.total++;
  if (r.correct) s.correct++;
  else s.state.mistakes = [...(s.state.mistakes ?? []), ...tags];
  const f = formatFeedback(r, explanation, !r.correct && answer !== '', a.id);
  s.state.lastFeedbackId = await sendTracked(ctx, s, f.text, f.markup);
}

/** Moves the task's mastery counter after an answer; the task is the one fetched at the start of the item. */
async function applyScore(ctx: BotCtx, task: Task, r: { correct: boolean; exact: boolean }) {
  const { score, dueAt } = taskAfterAnswer(task.score, r, ctx.now());
  await ctx.store.updateTaskScore(task.id, score, dueAt);
}

async function advance(ctx: BotCtx, s: Session) {
  s.cursor++;
  s.state = { mistakes: s.state.mistakes, lastFeedbackId: s.state.lastFeedbackId };
  await sendCurrent(ctx, s);
}

async function clearKeyboard(ctx: BotCtx, messageId: number | undefined) {
  if (!messageId) return;
  try {
    await ctx.api.editMessageReplyMarkup(ctx.chatId, messageId, { inline_keyboard: [] });
  } catch (err) {
    ctx.log?.('clear keyboard failed', err);
  }
}

/** Typed answer for input/translate tasks. Returns false when no typed answer is expected. */
export async function answerTyped(ctx: BotCtx, s: Session, text: string, userMessageId: number): Promise<boolean> {
  const task = await currentTask(ctx, s);
  if (!task || (task.payload.kind !== 'input' && task.payload.kind !== 'translate')) return false;
  s.messageIds.push(userMessageId);
  const p = task.payload;
  await clearKeyboard(ctx, s.state.promptId);
  const r = checkText(text, p.accept, p.reject);
  await feedback(ctx, s, task, text, r, p.explanation);
  await applyScore(ctx, task, r);
  await advance(ctx, s);
  return true;
}

export type SessionCallback =
  | { type: 'choice'; index: number }
  | { type: 'reading'; index: number }
  | { type: 'order-pick'; index: number }
  | { type: 'order-reset' }
  | { type: 'order-done' }
  | { type: 'idk' }
  | { type: 'word-show' }
  | { type: 'word-answer'; remembered: boolean };

/** Handles a button on the current prompt. Returns a callback toast text, or null on success. */
export async function answerButton(ctx: BotCtx, s: Session, cb: SessionCallback, messageId: number): Promise<string | null> {
  if (s.state.promptId !== messageId) return TEXT.stale;
  const item = s.items[s.cursor];
  if (!item) return TEXT.stale;

  if (item.type === 'word') {
    const w = await ctx.store.getWord(item.wordId);
    if (!w) return TEXT.stale;
    if (cb.type === 'word-show') {
      const f = formatWordBack(w, s.cursor + 1, s.items.length);
      await ctx.api.editMessageText(ctx.chatId, messageId, f.text, f.markup);
      s.state.revealed = true;
      await save(ctx, s);
      return null;
    }
    if (cb.type !== 'word-answer' || !s.state.revealed) return TEXT.stale;
    const next = nextBox(w.box, cb.remembered, ctx.now());
    await ctx.store.updateWordBox(w.id, next.box, next.dueAt);
    await ctx.store.addAnswer({
      kind: 'word', taskId: null, wordId: w.id, sessionId: s.id, answer: cb.remembered ? 'remembered' : 'forgot', correct: cb.remembered,
      exact: cb.remembered, tags: ['vocab'], lessonNo: w.lessonNo, createdAt: ctx.now().toISOString(),
    });
    s.total++;
    if (cb.remembered) s.correct++;
    await clearKeyboard(ctx, messageId);
    await advance(ctx, s);
    return null;
  }

  const task = await ctx.store.getTask(item.taskId);
  if (!task) return TEXT.stale;
  const p = task.payload;

  if (cb.type === 'idk' && (p.kind === 'input' || p.kind === 'translate')) {
    await clearKeyboard(ctx, messageId);
    const r = { correct: false, exact: false, expected: p.accept[0] };
    await feedback(ctx, s, task, '', r, p.explanation);
    await applyScore(ctx, task, r);
    await advance(ctx, s);
    return null;
  }
  if (cb.type === 'choice' && p.kind === 'choice') {
    if (cb.index < 0 || cb.index >= p.options.length) return TEXT.stale;
    await clearKeyboard(ctx, messageId);
    const ok = cb.index === p.correct;
    await feedback(ctx, s, task, p.options[cb.index], { correct: ok, exact: ok, expected: p.options[p.correct] }, p.explanation);
    await applyScore(ctx, task, { correct: ok, exact: ok });
    await advance(ctx, s);
    return null;
  }
  if (cb.type === 'reading' && p.kind === 'reading') {
    const qi = s.state.question ?? 0;
    const q = p.questions[qi];
    if (!q || cb.index < 0 || cb.index >= q.options.length) return TEXT.stale;
    await clearKeyboard(ctx, messageId);
    const ok = cb.index === q.correct;
    await feedback(ctx, s, task, q.options[cb.index], { correct: ok, exact: ok, expected: q.options[q.correct] }, '');
    const wrong = (s.state.readingWrong ?? false) || !ok;
    if (qi + 1 < p.questions.length) {
      const f = formatReading(p, qi + 1, s.cursor + 1, s.items.length);
      s.state = { mistakes: s.state.mistakes, question: qi + 1, readingWrong: wrong, promptId: await sendTracked(ctx, s, f.text, f.markup) };
      await save(ctx, s);
    } else {
      await applyScore(ctx, task, { correct: !wrong, exact: !wrong });
      await advance(ctx, s);
    }
    return null;
  }
  if (p.kind === 'order' && (cb.type === 'order-pick' || cb.type === 'order-reset')) {
    const picked = s.state.picked ?? [];
    if (cb.type === 'order-reset') s.state.picked = [];
    else if (cb.index >= 0 && cb.index < p.words.length && !picked.includes(cb.index)) s.state.picked = [...picked, cb.index];
    else return TEXT.stale;
    const f = formatOrder(p, s.state.picked, s.cursor + 1, s.items.length);
    await ctx.api.editMessageText(ctx.chatId, messageId, f.text, f.markup);
    await save(ctx, s);
    return null;
  }
  if (p.kind === 'order' && cb.type === 'order-done') {
    const built = (s.state.picked ?? []).map((i) => (p as TaskOf<'order'>).words[i]).join(' ');
    if (!built) return 'Сначала выберите слова';
    await clearKeyboard(ctx, messageId);
    const r = checkText(built, p.accept);
    await feedback(ctx, s, task, built, r, p.explanation);
    await applyScore(ctx, task, r);
    await advance(ctx, s);
    return null;
  }
  return TEXT.stale;
}

/** «Я ответил правильно»: the mistake is dropped and the answer goes to Claude for review. */
export async function dispute(ctx: BotCtx, answerId: string, messageId: number): Promise<string> {
  const a = await ctx.store.getAnswer(answerId);
  if (!a || a.disputed || a.correct !== false) return TEXT.stale;
  await ctx.store.updateAnswer(a.id, { disputed: true, correct: true });
  const s = await ctx.store.activeSession();
  if (s && s.id === a.sessionId) {
    s.correct++;
    const drop = new Set(a.tags);
    s.state.mistakes = (s.state.mistakes ?? []).filter((t) => !drop.has(t));
    await save(ctx, s);
  }
  if (a.taskId) await ctx.store.updateTaskScore(a.taskId, 2, taskDueAt(2, ctx.now()));
  await clearKeyboard(ctx, messageId);
  return TEXT.disputed;
}

export async function submitWriting(ctx: BotCtx, text: string) {
  const pending = await ctx.store.getSetting<PendingWriting | null>('pendingWriting');
  const task = pending ? await ctx.store.getTask(pending.taskId) : null;
  await ctx.store.addAnswer({
    kind: 'writing', taskId: task?.id ?? null, wordId: null, sessionId: null, answer: text, correct: null, exact: false,
    tags: task?.tags ?? ['writing'], lessonNo: task?.lessonNo ?? null, createdAt: ctx.now().toISOString(),
  });
  await ctx.store.setSetting('pendingWriting', null);
  await send(ctx, 'writing', TEXT.writingSaved);
}
