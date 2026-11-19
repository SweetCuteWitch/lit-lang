import type { Variant } from '../tasks/from-variant';
import type { TaskInput, TaskKind } from '../tasks/schema';

export interface Lesson {
  no: number;
  title: string;
  grammar: string;
  topic: string;
  skill: string;
  /** Suggested new words (lemmas) for the lesson. */
  words: string[];
}

export interface WordInput {
  lemma: string;
  translation: string;
  pos: string;
  gender?: 'm' | 'f' | null;
  /** Key forms to show on the card, e.g. ["knyga", "knygos", "knygą"]. */
  keyForms: string[];
  example?: string | null;
  /** true when the lemma and key forms were found in the lexicon. */
  verified: boolean;
}

export interface Word extends WordInput {
  id: string;
  lessonNo: number;
  /** Leitner box: 0 = new, 1..6 = learned more and more. */
  box: number;
  dueAt: string;
  addedAt: string;
}

export interface PortionInput {
  lessonNo: number;
  seq: number;
  /** Theory in Telegram HTML (b, i, code), Russian with Lithuanian examples. */
  theory: string;
  words: WordInput[];
}

export interface Portion extends PortionInput {
  id: string;
  status: 'ready' | 'served';
  servedAt: string | null;
}

export type TaskStatus = 'ready' | 'served' | 'retired';

export interface Task {
  id: string;
  kind: TaskKind;
  lessonNo: number;
  portionId: string | null;
  slot: 'new' | 'review';
  payload: TaskInput;
  tags: string[];
  status: TaskStatus;
  createdAt: string;
  /** Mastery score of the task. */
  score: number;
  dueAt: string | null;
  recipeId: string | null;
  variantKey: string | null;
}

export interface RecipeRecord {
  name: string;
  kind: 'form';
  lessonNo: number;
  tags: string[];
  payload: unknown;
  variants: Variant[];
}

export type Recipe = RecipeRecord & { id: string; createdAt: string };

export type SessionItem = { type: 'task'; taskId: string } | { type: 'word'; wordId: string };

export interface SessionState {
  /** Order task: indexes of words picked so far. */
  picked?: number[];
  /** Word review: card was revealed. */
  revealed?: boolean;
  /** Reading task: index of the current question. */
  question?: number;
  /** Reading task: some question of the current item was answered wrong. */
  readingWrong?: boolean;
  /** Feedback message of the latest answer: kept when the session ends, so the last result stays visible. */
  lastFeedbackId?: number;
  /** Tags of wrong answers in this session (kept across items). */
  mistakes?: string[];
  /** Message id of the current interactive prompt (to edit it). */
  promptId?: number;
}

export interface Session {
  id: string;
  slot: 'new' | 'review';
  portionId: string | null;
  startedAt: string;
  finishedAt: string | null;
  items: SessionItem[];
  cursor: number;
  messageIds: number[];
  lastUpdateId: number | null;
  state: SessionState;
  correct: number;
  total: number;
}

export type AnswerKind = 'task' | 'word' | 'writing';

export interface Answer {
  id: string;
  kind: AnswerKind;
  taskId: string | null;
  wordId: string | null;
  sessionId: string | null;
  answer: string;
  /** null for writing until reviewed. */
  correct: boolean | null;
  exact: boolean;
  tags: string[];
  lessonNo: number | null;
  disputed: boolean;
  disputeNote: string | null;
  review: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type AnswerInput = Omit<Answer, 'id' | 'createdAt' | 'disputed' | 'disputeNote' | 'review' | 'reviewedAt'> &
  Partial<Pick<Answer, 'createdAt'>>;

export interface TaskFilter {
  status?: TaskStatus;
  slot?: 'new' | 'review';
  lessonNo?: number;
  portionId?: string;
  kind?: TaskKind;
  recipeId?: string;
  limit?: number;
}

export interface AnswerFilter {
  kind?: AnswerKind;
  lessonNo?: number;
  since?: string;
  /** Writings without a review. */
  pendingReview?: boolean;
  /** Disputed answers without a resolution note. */
  pendingDispute?: boolean;
  limit?: number;
}

export interface Store {
  getSetting<T>(key: string): Promise<T | null>;
  /** null removes the setting. */
  setSetting(key: string, value: unknown): Promise<void>;
  /** Records a Telegram update id; false when it was already handled (webhook retry). */
  markUpdate(updateId: number): Promise<boolean>;

  upsertLessons(lessons: Lesson[]): Promise<void>;
  listLessons(): Promise<Lesson[]>;
  getLesson(no: number): Promise<Lesson | null>;

  /** Fails if a portion with the same lessonNo + seq exists. */
  addPortion(p: PortionInput): Promise<Portion>;
  getPortion(id: string): Promise<Portion | null>;
  /** Ready portion with the lowest seq for the lesson. */
  nextPortion(lessonNo: number): Promise<Portion | null>;
  markPortionServed(id: string, at: string): Promise<void>;
  listPortions(lessonNo?: number): Promise<Portion[]>;

  /** Inserts or updates by lemma; box and dueAt of an existing word are kept. */
  upsertWord(w: WordInput, lessonNo: number, now: string): Promise<Word>;
  getWord(id: string): Promise<Word | null>;
  dueWords(now: string, limit: number): Promise<Word[]>;
  updateWordBox(id: string, box: number, dueAt: string): Promise<void>;
  listWords(): Promise<Word[]>;

  /** A (recipeId, variantKey) pair that already exists is skipped silently; returns only created tasks. */
  addTasks(tasks: { payload: TaskInput; portionId: string | null; recipeId?: string; variantKey?: string }[], now: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  /** Oldest first. */
  listTasks(filter: TaskFilter): Promise<Task[]>;
  setTaskStatus(ids: string[], status: TaskStatus): Promise<void>;
  updateTaskPayload(id: string, payload: TaskInput): Promise<void>;
  updateTaskScore(id: string, score: number, dueAt: string): Promise<void>;

  /** By name; id and createdAt of an existing recipe are kept. */
  upsertRecipe(r: RecipeRecord, now: string): Promise<Recipe>;
  getRecipe(name: string): Promise<Recipe | null>;
  listRecipes(): Promise<Recipe[]>;

  createSession(s: Omit<Session, 'id'>): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  /** Latest unfinished session. */
  activeSession(): Promise<Session | null>;
  updateSession(id: string, patch: Partial<Omit<Session, 'id'>>): Promise<void>;
  /** Sessions started at or after `since`, oldest first. */
  listSessions(since: string): Promise<Session[]>;

  addAnswer(a: AnswerInput): Promise<Answer>;
  getAnswer(id: string): Promise<Answer | null>;
  updateAnswer(id: string, patch: Partial<Pick<Answer, 'correct' | 'disputed' | 'disputeNote' | 'review' | 'reviewedAt' | 'tags'>>): Promise<void>;
  /** Newest first. */
  listAnswers(filter: AnswerFilter): Promise<Answer[]>;
}
