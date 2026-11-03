import type { InlineMarkup, SendOptions, TelegramApi } from '../../src/telegram/api';

export interface SentMessage {
  id: number;
  chatId: number;
  text: string;
  threadId: number | null;
  markup?: SendOptions['markup'];
  deleted: boolean;
}

export function createFakeTelegram() {
  const messages: SentMessage[] = [];
  const callbacks: { id: string; text?: string }[] = [];
  const topics: string[] = [];
  /** Message ids whose deletion fails, like messages older than 48 hours. */
  const undeletable = new Set<number>();
  let nextId = 100;
  const byId = (id: number) => {
    const m = messages.find((x) => x.id === id);
    if (!m) throw new Error(`no message ${id}`);
    return m;
  };
  const api: TelegramApi = {
    async sendMessage(chatId, text, opts = {}) {
      const id = nextId++;
      messages.push({ id, chatId, text, threadId: opts.threadId ?? null, markup: opts.markup, deleted: false });
      return { message_id: id };
    },
    async editMessageText(_chatId, messageId, text, markup) {
      Object.assign(byId(messageId), { text, markup });
    },
    async editMessageReplyMarkup(_chatId, messageId, markup) {
      byId(messageId).markup = markup;
    },
    async deleteMessage(_chatId, messageId) {
      if (undeletable.has(messageId)) throw new Error("Telegram deleteMessage failed: Bad Request: message can't be deleted");
      byId(messageId).deleted = true;
    },
    async answerCallbackQuery(id, text) {
      callbacks.push({ id, text });
    },
    async createForumTopic(_chatId, name) {
      topics.push(name);
      return { message_thread_id: 10 + topics.length };
    },
  };
  const visible = () => messages.filter((m) => !m.deleted);
  const last = () => visible().at(-1)!;
  const buttons = (m: SentMessage) => ((m.markup as InlineMarkup | undefined)?.inline_keyboard ?? []).flat();
  return { api, messages, callbacks, topics, undeletable, visible, last, buttons };
}
