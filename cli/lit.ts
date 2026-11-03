import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { loadLexicon } from '../src/lexicon/lexicon';
import { createSupabaseStore } from '../src/store/supabase';
import { createTelegramAdmin, createTelegramApi } from '../src/telegram/api';
import { runCommand } from './commands';

async function telegramCommand(argv: string[]): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set (.env.local)');
    return 2;
  }
  const admin = createTelegramAdmin(token);
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { url: { type: 'string' } } });
  if (positionals[0] === 'chat-id') {
    const chats = new Map<number, string>();
    for (const u of await admin.getUpdates()) {
      const c = u.message?.chat;
      if (c) chats.set(c.id, `${c.type} ${c.title ?? c.username ?? c.first_name ?? ''}`);
    }
    if (!chats.size) {
      console.log('No messages yet. Send /start to the bot (or a message in the group), then run again.');
      return 1;
    }
    for (const [id, name] of chats) console.log(`${id}  ${name}`);
    return 0;
  }
  if (positionals[0] === 'set-webhook') {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!values.url || !secret) {
      console.error('Usage: lit telegram set-webhook --url https://<app>.vercel.app/api/telegram/webhook (needs TELEGRAM_WEBHOOK_SECRET)');
      return 2;
    }
    await admin.setWebhook(values.url, secret);
    console.log('Webhook set');
    return 0;
  }
  if (positionals[0] === 'me') {
    console.log(JSON.stringify(await admin.getMe(), null, 2));
    return 0;
  }
  console.error('Usage: lit telegram <chat-id | set-webhook --url URL | me>');
  return 2;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'telegram') return telegramCommand(argv.slice(1));
  const config = loadConfig();
  return runCommand(argv, {
    store: createSupabaseStore(config),
    api: createTelegramApi(config.botToken),
    chatId: config.chatId,
    now: () => new Date(),
    lex: () => loadLexicon(),
    out: (line) => console.log(line),
    readFile: (path) => readFileSync(path, 'utf8'),
    log: (msg, err) => console.error(msg, err),
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
