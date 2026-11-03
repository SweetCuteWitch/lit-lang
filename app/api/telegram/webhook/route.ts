import { handleWebhookRequest } from '../../../../src/bot/webhook';
import { loadConfig } from '../../../../src/config';
import { createSupabaseStore } from '../../../../src/store/supabase';
import { createTelegramApi } from '../../../../src/telegram/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();
  return handleWebhookRequest(req, config.webhookSecret, {
    store: createSupabaseStore(config),
    api: createTelegramApi(config.botToken),
    chatId: config.chatId,
    now: () => new Date(),
    log: (msg, err) => console.error(msg, err),
  });
}
