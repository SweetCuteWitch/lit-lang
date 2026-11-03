import { timingSafeEqual } from 'node:crypto';

export function isAuthorizedCron(headers: Headers, secret: string): boolean {
  const got = Buffer.from(headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
