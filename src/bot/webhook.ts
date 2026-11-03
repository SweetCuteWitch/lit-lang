import { isAuthorizedWebhook } from '../telegram/webhook-auth';
import type { BotCtx } from './context';
import { handleUpdate, type TgUpdate } from './handle-update';

export async function handleWebhookRequest(req: Request, secret: string, ctx: BotCtx): Promise<Response> {
  if (!isAuthorizedWebhook(req.headers, secret)) return new Response('forbidden', { status: 403 });
  try {
    await handleUpdate((await req.json()) as TgUpdate, ctx);
  } catch (err) {
    // Always 200 so Telegram does not retry forever; the error is visible in logs.
    (ctx.log ?? console.error)('telegram update failed', err);
  }
  return new Response('ok');
}
