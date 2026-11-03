export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineMarkup {
  inline_keyboard: InlineButton[][];
}

export interface ReplyKeyboardMarkup {
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
}

export type AnyMarkup = InlineMarkup | ReplyKeyboardMarkup;

export interface SendOptions {
  markup?: AnyMarkup;
  /** Forum topic; undefined/null = main chat. */
  threadId?: number | null;
}

export interface TelegramApi {
  sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, markup?: InlineMarkup): Promise<void>;
  editMessageReplyMarkup(chatId: number, messageId: number, markup: InlineMarkup): Promise<void>;
  /** Bots may delete messages only within 48 hours; older ones throw. */
  deleteMessage(chatId: number, messageId: number): Promise<void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  createForumTopic(chatId: number, name: string): Promise<{ message_thread_id: number }>;
}

export interface TelegramAdmin {
  getUpdates(): Promise<{ message?: { chat: { id: number; type: string; title?: string; username?: string; first_name?: string } } }[]>;
  setWebhook(url: string, secret: string): Promise<void>;
  getMe(): Promise<{ id: number; username: string; has_topics_enabled?: boolean }>;
}

function makeCaller(token: string, fetchImpl: typeof fetch) {
  return async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: { ok: boolean; result?: T; description?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(`Telegram ${method} failed: HTTP ${res.status}`);
    }
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result as T;
  };
}

export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const call = makeCaller(token, fetchImpl);
  return {
    sendMessage: (chatId, text, opts = {}) =>
      call<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(opts.threadId ? { message_thread_id: opts.threadId } : {}),
        ...(opts.markup ? { reply_markup: opts.markup } : {}),
      }),
    async editMessageText(chatId, messageId, text, markup) {
      await call('editMessageText', {
        chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        ...(markup ? { reply_markup: markup } : {}),
      });
    },
    async editMessageReplyMarkup(chatId, messageId, markup) {
      await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup });
    },
    async deleteMessage(chatId, messageId) {
      await call('deleteMessage', { chat_id: chatId, message_id: messageId });
    },
    async answerCallbackQuery(id, text) {
      await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
    },
    createForumTopic: (chatId, name) => call<{ message_thread_id: number }>('createForumTopic', { chat_id: chatId, name }),
  };
}

export function createTelegramAdmin(token: string, fetchImpl: typeof fetch = fetch): TelegramAdmin {
  const call = makeCaller(token, fetchImpl);
  return {
    getUpdates: () => call('getUpdates', {}),
    async setWebhook(url, secret) {
      await call('setWebhook', {
        url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
        // One request at a time: session state is read-modify-write.
        max_connections: 1,
      });
    },
    getMe: () => call('getMe', {}),
  };
}
