export type Present = 'input' | 'choice' | 'order';
export interface Variant { key: string; frame: number; lemma: string; question: string; answer: string; accept: string[]; reject: string[]; distractors: string[]; orderWords: string[] | null; present: Present[]; note: string; target: { lemma: string; key: string } | null }
