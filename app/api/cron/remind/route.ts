import { loadConfig, loadCronSecret } from '../../../../src/config';
import { handleRemindRequest } from '../../../../src/cron/remind';
import { createSupabaseStore } from '../../../../src/store/supabase';
import { createTelegramApi } from '../../../../src/telegram/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const config = loadConfig();
  return handleRemindRequest(req, loadCronSecret(), {
    store: createSupabaseStore(config),
    api: createTelegramApi(config.botToken),
    chatId: config.chatId,
    now: () => new Date(),
    log: (msg, err) => console.error(msg, err),
  });
}
