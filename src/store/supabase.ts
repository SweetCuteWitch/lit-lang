import { createClient } from '@supabase/supabase-js';
import type { TaskInput } from '../tasks/schema';
import type { Answer, Lesson, Portion, Session, Store, Task, Word } from './types';

interface Cfg {
  supabaseUrl: string;
  supabaseKey: string;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const portionRow = (r: any): Portion => ({
  id: r.id, lessonNo: r.lesson_no, seq: r.seq, theory: r.theory, words: r.words ?? [], status: r.status, servedAt: r.served_at,
});
const wordRow = (r: any): Word => ({
  id: r.id, lemma: r.lemma, translation: r.translation, pos: r.pos, gender: r.gender, keyForms: r.key_forms ?? [],
  example: r.example, verified: r.verified, lessonNo: r.lesson_no, box: r.box,
  dueAt: new Date(r.due_at).toISOString(), addedAt: new Date(r.added_at).toISOString(),
});
const taskRow = (r: any): Task => ({
  id: r.id, kind: r.kind, lessonNo: r.lesson_no, portionId: r.portion_id, slot: r.slot, payload: r.payload as TaskInput,
  tags: r.tags ?? [], status: r.status, createdAt: new Date(r.created_at).toISOString(),
});
const sessionRow = (r: any): Session => ({
  id: r.id, slot: r.slot, portionId: r.portion_id, startedAt: new Date(r.started_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, items: r.items ?? [], cursor: r.cursor,
  messageIds: (r.message_ids ?? []).map(Number), lastUpdateId: r.last_update_id === null ? null : Number(r.last_update_id),
  state: r.state ?? {}, correct: r.correct, total: r.total,
});
const answerRow = (r: any): Answer => ({
  id: r.id, kind: r.kind, taskId: r.task_id, wordId: r.word_id, sessionId: r.session_id, answer: r.answer, correct: r.correct,
  exact: r.exact, tags: r.tags ?? [], lessonNo: r.lesson_no, disputed: r.disputed, disputeNote: r.dispute_note,
  review: r.review, reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  createdAt: new Date(r.created_at).toISOString(),
});

const SESSION_COLUMNS: Record<string, string> = {
  slot: 'slot', portionId: 'portion_id', startedAt: 'started_at', finishedAt: 'finished_at', items: 'items', cursor: 'cursor',
  messageIds: 'message_ids', lastUpdateId: 'last_update_id', state: 'state', correct: 'correct', total: 'total',
};
const ANSWER_COLUMNS: Record<string, string> = {
  correct: 'correct', disputed: 'disputed', disputeNote: 'dispute_note', review: 'review', reviewedAt: 'reviewed_at', tags: 'tags',
};
const toColumns = (patch: Record<string, unknown>, map: Record<string, string>) =>
  Object.fromEntries(Object.entries(patch).filter(([k]) => k in map).map(([k, v]) => [map[k], v]));

export function createSupabaseStore(cfg: Cfg): Store {
  const db = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });

  return {
    async getSetting<T>(key: string) {
      const data = must(await db.from('settings').select('value').eq('key', key).maybeSingle(), 'getSetting') as { value: unknown } | null;
      return data ? (data.value as T) : null;
    },
    async setSetting(key, value) {
      must(await db.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'setSetting');
    },

    async upsertLessons(list) {
      if (list.length) must(await db.from('lessons').upsert(list), 'upsertLessons');
    },
    async listLessons() {
      return must(await db.from('lessons').select('*').order('no'), 'listLessons') as Lesson[];
    },
    async getLesson(no) {
      return must(await db.from('lessons').select('*').eq('no', no).maybeSingle(), 'getLesson') as Lesson | null;
    },

    async addPortion(p) {
      const r = must(
        await db.from('portions').insert({ lesson_no: p.lessonNo, seq: p.seq, theory: p.theory, words: p.words }).select().single(),
        'addPortion',
      );
      return portionRow(r);
    },
    async getPortion(id) {
      const r = must(await db.from('portions').select('*').eq('id', id).maybeSingle(), 'getPortion');
      return r ? portionRow(r) : null;
    },
    async nextPortion(lessonNo) {
      const r = must(
        await db.from('portions').select('*').eq('lesson_no', lessonNo).eq('status', 'ready').order('seq').limit(1).maybeSingle(),
        'nextPortion',
      );
      return r ? portionRow(r) : null;
    },
    async markPortionServed(id, at) {
      must(await db.from('portions').update({ status: 'served', served_at: at }).eq('id', id), 'markPortionServed');
    },
    async listPortions(lessonNo) {
      let q = db.from('portions').select('*');
      if (lessonNo !== undefined) q = q.eq('lesson_no', lessonNo);
      return (must(await q.order('lesson_no').order('seq'), 'listPortions') as any[]).map(portionRow);
    },

    async upsertWord(w, lessonNo, now) {
      const existing = must(await db.from('words').select('id').eq('lemma', w.lemma).maybeSingle(), 'upsertWord') as { id: string } | null;
      const fields = {
        translation: w.translation, pos: w.pos, gender: w.gender ?? null, key_forms: w.keyForms, example: w.example ?? null, verified: w.verified,
      };
      const r = existing
        ? must(await db.from('words').update(fields).eq('id', existing.id).select().single(), 'upsertWord')
        : must(
            await db.from('words').insert({ ...fields, lemma: w.lemma, lesson_no: lessonNo, box: 0, due_at: now, added_at: now }).select().single(),
            'upsertWord',
          );
      return wordRow(r);
    },
    async getWord(id) {
      const r = must(await db.from('words').select('*').eq('id', id).maybeSingle(), 'getWord');
      return r ? wordRow(r) : null;
    },
    async dueWords(now, limit) {
      return (must(await db.from('words').select('*').lte('due_at', now).order('due_at').limit(limit), 'dueWords') as any[]).map(wordRow);
    },
    async updateWordBox(id, box, dueAt) {
      must(await db.from('words').update({ box, due_at: dueAt }).eq('id', id), 'updateWordBox');
    },
    async listWords() {
      return (must(await db.from('words').select('*').order('added_at'), 'listWords') as any[]).map(wordRow);
    },

    async addTasks(list, now) {
      if (!list.length) return [];
      const rows = list.map(({ payload, portionId }) => ({
        kind: payload.kind, lesson_no: payload.lessonNo, portion_id: portionId, slot: payload.slot, payload, tags: payload.tags, created_at: now,
      }));
      return (must(await db.from('tasks').insert(rows).select().order('seq'), 'addTasks') as any[]).map(taskRow);
    },
    async getTask(id) {
      const r = must(await db.from('tasks').select('*').eq('id', id).maybeSingle(), 'getTask');
      return r ? taskRow(r) : null;
    },
    async listTasks(f) {
      let q = db.from('tasks').select('*');
      if (f.status) q = q.eq('status', f.status);
      if (f.slot) q = q.eq('slot', f.slot);
      if (f.lessonNo !== undefined) q = q.eq('lesson_no', f.lessonNo);
      if (f.portionId) q = q.eq('portion_id', f.portionId);
      if (f.kind) q = q.eq('kind', f.kind);
      q = q.order('seq');
      if (f.limit !== undefined) q = q.limit(f.limit);
      return (must(await q, 'listTasks') as any[]).map(taskRow);
    },
    async setTaskStatus(ids, status) {
      if (ids.length) must(await db.from('tasks').update({ status }).in('id', ids), 'setTaskStatus');
    },
    async updateTaskPayload(id, payload) {
      must(await db.from('tasks').update({ payload, tags: payload.tags }).eq('id', id), 'updateTaskPayload');
    },

    async createSession(s) {
      const r = must(await db.from('sessions').insert(toColumns(s, SESSION_COLUMNS)).select().single(), 'createSession');
      return sessionRow(r);
    },
    async getSession(id) {
      const r = must(await db.from('sessions').select('*').eq('id', id).maybeSingle(), 'getSession');
      return r ? sessionRow(r) : null;
    },
    async activeSession() {
      const r = must(
        await db.from('sessions').select('*').is('finished_at', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        'activeSession',
      );
      return r ? sessionRow(r) : null;
    },
    async updateSession(id, patch) {
      must(await db.from('sessions').update(toColumns(patch, SESSION_COLUMNS)).eq('id', id), 'updateSession');
    },
    async listSessions(since) {
      return (must(await db.from('sessions').select('*').gte('started_at', since).order('started_at'), 'listSessions') as any[]).map(sessionRow);
    },

    async addAnswer(a) {
      const r = must(
        await db
          .from('answers')
          .insert({
            kind: a.kind, task_id: a.taskId, word_id: a.wordId, session_id: a.sessionId, answer: a.answer, correct: a.correct,
            exact: a.exact, tags: a.tags, lesson_no: a.lessonNo, ...(a.createdAt ? { created_at: a.createdAt } : {}),
          })
          .select()
          .single(),
        'addAnswer',
      );
      return answerRow(r);
    },
    async getAnswer(id) {
      const r = must(await db.from('answers').select('*').eq('id', id).maybeSingle(), 'getAnswer');
      return r ? answerRow(r) : null;
    },
    async updateAnswer(id, patch) {
      must(await db.from('answers').update(toColumns(patch, ANSWER_COLUMNS)).eq('id', id), 'updateAnswer');
    },
    async listAnswers(f) {
      let q = db.from('answers').select('*');
      if (f.kind) q = q.eq('kind', f.kind);
      if (f.lessonNo !== undefined) q = q.eq('lesson_no', f.lessonNo);
      if (f.since) q = q.gte('created_at', f.since);
      if (f.pendingReview) q = q.eq('kind', 'writing').is('review', null);
      if (f.pendingDispute) q = q.eq('disputed', true).is('dispute_note', null);
      q = q.order('created_at', { ascending: false });
      if (f.limit !== undefined) q = q.limit(f.limit);
      return (must(await q, 'listAnswers') as any[]).map(answerRow);
    },
  };
}
