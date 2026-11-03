import type { Store } from '../store/types';
import type { SendOptions, TelegramApi } from '../telegram/api';

export interface BotCtx {
  store: Store;
  api: TelegramApi;
  chatId: number;
  now: () => Date;
  log?: (msg: string, err?: unknown) => void;
}

export interface Topics {
  lessons?: number | null;
  training?: number | null;
  vocab?: number | null;
  writing?: number | null;
}

export const TOPIC_NAMES: Record<keyof Topics, string> = {
  lessons: '📚 Уроки',
  training: '✏️ Тренировка',
  vocab: '📖 Словарь',
  writing: '📝 Письмо',
};

export async function getTopics(ctx: BotCtx): Promise<Topics> {
  return (await ctx.store.getSetting<Topics>('topics')) ?? {};
}

export async function send(ctx: BotCtx, topic: keyof Topics, text: string, opts: Omit<SendOptions, 'threadId'> = {}) {
  const topics = await getTopics(ctx);
  return ctx.api.sendMessage(ctx.chatId, text, { ...opts, threadId: topics[topic] ?? null });
}

/** Deletes messages, ignoring failures (older than 48 hours, already deleted). */
export async function deleteAll(ctx: BotCtx, ids: number[]) {
  for (const id of ids) {
    try {
      await ctx.api.deleteMessage(ctx.chatId, id);
    } catch (err) {
      ctx.log?.(`deleteMessage ${id} failed`, err);
    }
  }
}
