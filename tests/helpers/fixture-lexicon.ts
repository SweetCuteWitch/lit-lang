import { readFileSync } from 'node:fs';
import { createLexicon } from '../../src/lexicon/lexicon';
import { parseEntry } from '../../src/lexicon/parse';
import type { LexEntry } from '../../src/lexicon/types';

const entries = readFileSync('tests/fixtures/kaikki-sample.jsonl', 'utf8').split('\n').filter(Boolean)
  .map((l) => parseEntry(JSON.parse(l))).filter((e): e is LexEntry => e !== null);

const sg = (forms: string[]) => ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'].map((c, i) => [`${c}.sg`, [forms[i]!]] as [string, string[]]);
const pl = (forms: string[]) => ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'].map((c, i) => [`${c}.pl`, [forms[i]!]] as [string, string[]]);
const noun = (lemma: string, gender: 'm' | 'f', s: string[], p: string[], pos: 'noun' | 'name' = 'noun'): LexEntry => ({
  lemma, pos, gender, gloss: lemma, forms: Object.fromEntries([...sg(s), ...pl(p)].filter(([, v]) => v[0])), other: [],
});

/** Words for recipe tests, forms copied from the real lexicon (`npm run lit -- inflect <lemma>`). */
const extra: LexEntry[] = [
  noun('Rusija', 'f', ['Rusija', 'Rusijos', 'Rusijai', 'Rusiją', 'Rusija', 'Rusijoje', 'Rusija'], [], 'name'),
  noun('vardas', 'm', ['vardas', 'vardo', 'vardui', 'vardą', 'vardu', 'varde', 'varde'],
    ['vardai', 'vardų', 'vardams', 'vardus', 'vardais', 'varduose', 'vardai']),
  noun('pavardė', 'f', ['pavardė', 'pavardės', 'pavardei', 'pavardę', 'pavarde', 'pavardėje', 'pavarde'],
    ['pavardės', 'pavardžių', 'pavardėms', 'pavardes', 'pavardėmis', 'pavardėse', 'pavardės']),
  noun('studentas', 'm', ['studentas', 'studento', 'studentui', 'studentą', 'studentu', 'studente', 'studente'],
    ['studentai', 'studentų', 'studentams', 'studentus', 'studentais', 'studentuose', 'studentai']),
  noun('draugė', 'f', ['draugė', 'draugės', 'draugei', 'draugę', 'drauge', 'draugėje', 'drauge'],
    ['draugės', 'draugių', 'draugėms', 'drauges', 'draugėmis', 'draugėse', 'draugės']),
  { lemma: 'ji', pos: 'pron', gloss: 'she', forms: { 'nom.sg': ['ji'], 'nom.pl': ['jos'], 'gen.sg': ['jos'], 'acc.sg': ['ją'] }, other: [] },
  { lemma: 'mano', pos: 'pron', gloss: 'my', forms: {}, other: [] },
  { lemma: 'jūsų', pos: 'pron', gloss: 'your', forms: {}, other: [] },
  { lemma: 'iš', pos: 'other', gloss: 'from', forms: {}, other: [] },
  {
    lemma: 'koks', pos: 'pron', gloss: 'what, which',
    forms: { 'nom.sg': ['koks', 'kokia'], 'nom.pl': ['kokie', 'kokios'], 'gen.sg': ['kokio', 'kokios'], 'acc.sg': ['kokį', 'kokią'] }, other: [],
  },
];

export const fixtureLexicon = createLexicon([...entries, ...extra]);
