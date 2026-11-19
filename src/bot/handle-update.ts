import { bankStatus, getProgress } from '../learn/progress';
import { BTN_MORE_NEW, BTN_PROGRESS, BTN_START, formatProgress, mainKeyboard, progressButtons, TEXT } from '../telegram/format';
import { localDate } from '../time';
import { getTopics, send, type BotCtx } from './context';
import { showLessons, showVocab, tryLessonNumber } from './library';
import { answerButton, answerTyped, dispute, startSession, submitWriting, type PendingWriting, type SessionCallback } from './session';

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  message_thread_id?: number;
  reply_to_message?: { message_id: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

function parseCallback(data: string): SessionCallback | null {
  const [k, v] = data.split(':');
  const n = Number(v);
  switch (k) {
    case 'c': return Number.isInteger(n) ? { type: 'choice', index: n } : null;
    case 'r': return Number.isInteger(n) ? { type: 'reading', index: n } : null;
    case 'o': return Number.isInteger(n) ? { type: 'order-pick', index: n } : null;
    case 'or': return { type: 'order-reset' };
    case 'od': return { type: 'order-done' };
    case 'idk': return { type: 'idk' };
    case 'w': return v === 'show' ? { type: 'word-show' } : v === 'y' || v === 'n' ? { type: 'word-answer', remembered: v === 'y' } : null;
    default: return null;
  }
}

async function showProgress(ctx: BotCtx) {
  const { lessonNo } = await getProgress(ctx.store);
  const lessons = await ctx.store.listLessons();
  const words = await ctx.store.listWords();
  const since = new Date(ctx.now().getTime() - 120 * 86_400_000).toISOString();
  const days = new Set((await ctx.store.listSessions(since)).filter((s) => s.finishedAt && s.total > 0).map((s) => localDate(new Date(s.startedAt))));
  let streak = 0;
  let d = ctx.now();
  // Today without a session yet does not break the streak.
  if (!days.has(localDate(d))) d = new Date(d.getTime() - 86_400_000);
  while (days.has(localDate(d))) {
    streak++;
    d = new Date(d.getTime() - 86_400_000);
  }
  await send(ctx, 'training', formatProgress({
    lesson: lessons.find((l) => l.no === lessonNo) ?? null, lessonNo, lessonsTotal: lessons.length, words: words.length,
    learned: words.filter((w) => w.box >= 3).length, streak, bank: await bankStatus(ctx.store, ctx.now()),
  }), { markup: progressButtons() });
}

async function onText(ctx: BotCtx, m: TgMessage) {
  const text = (m.text ?? '').trim();
  if (!text) return;
  if (text === '/start' || text === '/menu' || text === '/help') {
    await send(ctx, 'training', TEXT.welcome, { markup: mainKeyboard() });
    return;
  }
  if (text === BTN_START || text === '/session') return startSession(ctx);
  if (text === BTN_MORE_NEW || text === '/more') return startSession(ctx, { preferNew: true });
  if (text === BTN_PROGRESS || text === '/progress') return showProgress(ctx);
  if (text === '/vocab') return showVocab(ctx);
  if (text === '/lessons') return showLessons(ctx);
  if (await tryLessonNumber(ctx, text)) return;

  const topics = await getTopics(ctx);
  const pending = await ctx.store.getSetting<PendingWriting | null>('pendingWriting');
  const inWritingTopic = topics.writing != null && m.message_thread_id === topics.writing;
  const replyToPrompt = pending != null && m.reply_to_message?.message_id === pending.messageId;
  if (inWritingTopic || replyToPrompt) return submitWriting(ctx, text);

  const s = await ctx.store.activeSession();
  if (s && (await answerTyped(ctx, s, text, m.message_id))) return;
  // Without a writing topic, a plain message is the writing while its prompt is pending.
  if (topics.writing == null && pending != null) return submitWriting(ctx, text);
  await ctx.api.sendMessage(ctx.chatId, s ? TEXT.useButtons : TEXT.noTask, { threadId: m.message_thread_id ?? null });
}

async function onCallback(ctx: BotCtx, cq: NonNullable<TgUpdate['callback_query']>) {
  const data = cq.data ?? '';
  const messageId = cq.message?.message_id ?? 0;
  let toast: string | null = null;
  let answered = false;
  try {
    if (data === 'start' || data === 'more') {
      await ctx.api.answerCallbackQuery(cq.id);
      answered = true;
      return await startSession(ctx, { preferNew: data === 'more' });
    }
    if (data === 'vocab' || data === 'lessons') {
      await ctx.api.answerCallbackQuery(cq.id);
      answered = true;
      return await (data === 'vocab' ? showVocab(ctx) : showLessons(ctx));
    }
    if (data.startsWith('d:')) {
      toast = await dispute(ctx, data.slice(2), messageId);
    } else {
      const cb = parseCallback(data);
      const s = await ctx.store.activeSession();
      toast = cb && s ? await answerButton(ctx, s, cb, messageId) : TEXT.stale;
    }
  } finally {
    // Without an answer the button keeps spinning, even when handling failed.
    if (!answered) {
      await ctx.api.answerCallbackQuery(cq.id, toast ?? undefined).catch((err) => ctx.log?.('answerCallbackQuery failed', err));
    }
  }
}

export async function handleUpdate(update: TgUpdate, ctx: BotCtx): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (chatId !== ctx.chatId) return;
  // Telegram retries a webhook that failed or timed out: handle each update once. Ids are not
  // monotonic (they restart randomly after a week without updates), so each one is recorded.
  if (!(await ctx.store.markUpdate(update.update_id))) return;
  if (update.callback_query) return onCallback(ctx, update.callback_query);
  if (update.message) return onText(ctx, update.message);
}
