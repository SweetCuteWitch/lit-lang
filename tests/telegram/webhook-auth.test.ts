import { describe, expect, it } from 'vitest';
import { isAuthorizedWebhook } from '../../src/telegram/webhook-auth';

describe('isAuthorizedWebhook', () => {
  const secret = 'secret_secret_1234';
  it('accepts the matching header', () => {
    expect(isAuthorizedWebhook(new Headers({ 'x-telegram-bot-api-secret-token': secret }), secret)).toBe(true);
  });
  it('rejects a missing or different header', () => {
    expect(isAuthorizedWebhook(new Headers(), secret)).toBe(false);
    expect(isAuthorizedWebhook(new Headers({ 'x-telegram-bot-api-secret-token': 'wrong' }), secret)).toBe(false);
  });
  it('rejects a header with the same char length but different byte length, without throwing', () => {
    const header = 'é'.repeat(secret.length);
    expect(() => isAuthorizedWebhook(new Headers({ 'x-telegram-bot-api-secret-token': header }), secret)).not.toThrow();
    expect(isAuthorizedWebhook(new Headers({ 'x-telegram-bot-api-secret-token': header }), secret)).toBe(false);
  });
});
