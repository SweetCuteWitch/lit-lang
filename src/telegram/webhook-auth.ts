import { timingSafeEqual } from 'node:crypto';

export function isAuthorizedWebhook(headers: Headers, secret: string): boolean {
  const got = headers.get('x-telegram-bot-api-secret-token');
  if (got === null) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
