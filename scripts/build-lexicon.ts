/**
 * Builds data/lexicon.json.gz from the kaikki.org Lithuanian Wiktionary extract.
 * Download: https://kaikki.org/dictionary/Lithuanian/kaikki.org-dictionary-Lithuanian.jsonl
 * Usage: npm run lexicon:build -- <path-to-jsonl>
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { LEXICON_PATH } from '../src/lexicon/lexicon';
import { parseEntry } from '../src/lexicon/parse';
import type { LexEntry } from '../src/lexicon/types';

async function main(path: string | undefined): Promise<number> {
  if (!path) {
    console.error('Usage: npm run lexicon:build -- <kaikki-Lithuanian.jsonl>');
    return 2;
  }
  const entries: LexEntry[] = [];
  const counts: Record<string, number> = {};
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const e = parseEntry(JSON.parse(line));
    if (!e) continue;
    entries.push(e);
    counts[e.pos] = (counts[e.pos] ?? 0) + 1;
  }
  const gz = gzipSync(JSON.stringify(entries), { level: 9 });
  writeFileSync(LEXICON_PATH, gz);
  console.log(`${entries.length} entries → ${LEXICON_PATH} (${(gz.length / 1e6).toFixed(1)} MB)`, counts);
  return 0;
}

main(process.argv[2]).then((code) => process.exit(code));
