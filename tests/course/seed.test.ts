import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runCommand } from '../../cli/commands';
import { loadLexicon } from '../../src/lexicon/lexicon';
import { createMemoryStore } from '../../src/store/memory';
import { createFakeTelegram } from '../helpers/fake-telegram';

it('course and seed content pass the same validation as generated content', async () => {
  const store = createMemoryStore();
  const out: string[] = [];
  const deps = {
    store, api: createFakeTelegram().api, chatId: 1, now: () => new Date('2026-11-03T10:00:00Z'), lex: () => loadLexicon(),
    out: (l: string) => { out.push(l); }, readFile: (p: string) => readFileSync(p, 'utf8'),
  };
  expect(await runCommand(['course', 'load'], deps)).toBe(0);
  for (const f of readdirSync('course/seed').sort()) {
    const code = await runCommand(['bank', 'add', '--file', `course/seed/${f}`], deps);
    expect(code, out.filter((l) => l.startsWith('✗')).join('\n')).toBe(0);
  }
  expect((await store.listPortions()).length).toBeGreaterThanOrEqual(4);
}, 30_000);
