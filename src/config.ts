import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/).transform(Number),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
});

export interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  botToken: string;
  chatId: number;
  webhookSecret: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid or missing env: ${keys}`);
  }
  const e = parsed.data;
  return {
    supabaseUrl: e.SUPABASE_URL,
    supabaseKey: e.SUPABASE_SERVICE_ROLE_KEY,
    botToken: e.TELEGRAM_BOT_TOKEN,
    chatId: e.TELEGRAM_CHAT_ID,
    webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
  };
}

const CronSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{16,256}$/);

export function loadCronSecret(env: Record<string, string | undefined> = process.env): string {
  const parsed = CronSecretSchema.safeParse(env.CRON_SECRET);
  if (!parsed.success) throw new Error('Invalid or missing env: CRON_SECRET');
  return parsed.data;
}
