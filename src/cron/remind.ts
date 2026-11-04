import { send, type BotCtx } from '../bot/context';
import { ABANDON_AFTER_MS, closeSession } from '../bot/session';
import { bankStatus } from '../learn/progress';
import { startButton } from '../telegram/format';
import { dayStart, TZ } from '../time';
import { isAuthorizedCron } from './auth';

function localHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/**
 * Morning: reminds about new material unless a new session already happened today.
 * Evening: reminds about consolidation unless two sessions are already done today.
 * Also closes an abandoned session. Reminders are never deleted: each one keeps a working start button.
 */
export async function remind(ctx: BotCtx): Promise<'sent' | 'skipped'> {
  const now = ctx.now();
  const active = await ctx.store.activeSession();
  if (active && now.getTime() - new Date(active.startedAt).getTime() >= ABANDON_AFTER_MS) await closeSession(ctx, active);

  const today = (await ctx.store.listSessions(dayStart(now).toISOString())).filter((s) => s.total > 0 || s.finishedAt === null);
  const morning = localHour(now) < 13;
  if (morning ? today.some((s) => s.slot === 'new') : today.length >= 2) return 'skipped';

  const bank = await bankStatus(ctx.store);
  const lines = [morning ? '☀️ <b>Labas rytas!</b> Время нового материала, ~15 минут.' : '🌙 <b>Labas vakaras!</b> Время закрепления, ~15 минут.'];
  if (bank.low) lines.push(`⚠️ Заданий осталось примерно на ${bank.days} дн.`);
  const m = await send(ctx, 'training', lines.join('\n'), { markup: startButton() });
  await ctx.store.setSetting('lastReminderId', m.message_id);
  return 'sent';
}

export async function handleRemindRequest(req: Request, secret: string, ctx: BotCtx): Promise<Response> {
  if (!isAuthorizedCron(req.headers, secret)) return new Response('forbidden', { status: 403 });
  const result = await remind(ctx);
  return Response.json({ result });
}
