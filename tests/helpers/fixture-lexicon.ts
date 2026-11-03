import { readFileSync } from 'node:fs';
import { createLexicon } from '../../src/lexicon/lexicon';
import { parseEntry } from '../../src/lexicon/parse';
import type { LexEntry } from '../../src/lexicon/types';

const entries = readFileSync('tests/fixtures/kaikki-sample.jsonl', 'utf8').split('\n').filter(Boolean)
  .map((l) => parseEntry(JSON.parse(l))).filter((e): e is LexEntry => e !== null);

export const fixtureLexicon = createLexicon(entries);
