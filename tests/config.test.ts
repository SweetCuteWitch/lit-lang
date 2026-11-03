import { describe, expect, it } from 'vitest';
import { loadConfig, loadCronSecret } from '../src/config';

const valid = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  TELEGRAM_BOT_TOKEN: '123456:ABC-def_ghi',
  TELEGRAM_CHAT_ID: '987654321',
  TELEGRAM_WEBHOOK_SECRET: 'secret_secret_1234',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    expect(loadConfig(valid)).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseKey: 'x'.repeat(40),
      botToken: '123456:ABC-def_ghi',
      chatId: 987654321,
      webhookSecret: 'secret_secret_1234',
    });
  });

  it('lists every missing or invalid key in the error', () => {
    expect(() => loadConfig({ ...valid, TELEGRAM_CHAT_ID: undefined, SUPABASE_URL: 'nope' })).toThrow(
      /SUPABASE_URL.*TELEGRAM_CHAT_ID|TELEGRAM_CHAT_ID.*SUPABASE_URL/,
    );
  });

  it('rejects an empty TELEGRAM_CHAT_ID', () => {
    expect(() => loadConfig({ ...valid, TELEGRAM_CHAT_ID: '' })).toThrow(/TELEGRAM_CHAT_ID/);
  });
});

describe('loadCronSecret', () => {
  it('returns a valid secret and rejects a missing one', () => {
    expect(loadCronSecret({ CRON_SECRET: 'abcdefghijklmnop_1' })).toBe('abcdefghijklmnop_1');
    expect(() => loadCronSecret({})).toThrow('Invalid or missing env: CRON_SECRET');
  });
});
