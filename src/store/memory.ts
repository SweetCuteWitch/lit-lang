import { randomUUID } from 'node:crypto';
import type { Answer, Lesson, Portion, Session, Store, Task, Word } from './types';

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Store for tests and local experiments. */
export function createMemoryStore(): Store {
  const settings = new Map<string, unknown>();
  const lessons = new Map<number, Lesson>();
  const portions: Portion[] = [];
  const words: Word[] = [];
  const tasks: Task[] = [];
  const sessions: Session[] = [];
  const answers: Answer[] = [];

  return {
    async getSetting<T>(key: string) {
      return settings.has(key) ? clone(settings.get(key) as T) : null;
    },
    async setSetting(key, value) {
      settings.set(key, clone(value));
    },

    async upsertLessons(list) {
      for (const l of list) lessons.set(l.no, clone(l));
    },
    async listLessons() {
      return [...lessons.values()].sort((a, b) => a.no - b.no).map(clone);
    },
    async getLesson(no) {
      return lessons.has(no) ? clone(lessons.get(no)!) : null;
    },

    async addPortion(p) {
      if (portions.some((x) => x.lessonNo === p.lessonNo && x.seq === p.seq)) {
        throw new Error(`portion ${p.lessonNo}.${p.seq} already exists`);
      }
      const row: Portion = { ...clone(p), id: randomUUID(), status: 'ready', servedAt: null };
      portions.push(row);
      return clone(row);
    },
    async getPortion(id) {
      const p = portions.find((x) => x.id === id);
      return p ? clone(p) : null;
    },
    async nextPortion(lessonNo) {
      const p = portions.filter((x) => x.lessonNo === lessonNo && x.status === 'ready').sort((a, b) => a.seq - b.seq)[0];
      return p ? clone(p) : null;
    },
    async markPortionServed(id, at) {
      const p = portions.find((x) => x.id === id);
      if (p) Object.assign(p, { status: 'served', servedAt: at });
    },
    async listPortions(lessonNo) {
      return portions
        .filter((p) => lessonNo === undefined || p.lessonNo === lessonNo)
        .sort((a, b) => a.lessonNo - b.lessonNo || a.seq - b.seq)
        .map(clone);
    },

    async upsertWord(w, lessonNo, now) {
      const existing = words.find((x) => x.lemma === w.lemma);
      if (existing) {
        Object.assign(existing, { ...clone(w), id: existing.id, box: existing.box, dueAt: existing.dueAt, lessonNo: existing.lessonNo });
        return clone(existing);
      }
      const row: Word = { ...clone(w), id: randomUUID(), lessonNo, box: 0, dueAt: now, addedAt: now };
      words.push(row);
      return clone(row);
    },
    async getWord(id) {
      const w = words.find((x) => x.id === id);
      return w ? clone(w) : null;
    },
    async dueWords(now, limit) {
      return words
        .filter((w) => w.dueAt <= now)
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, limit)
        .map(clone);
    },
    async updateWordBox(id, box, dueAt) {
      const w = words.find((x) => x.id === id);
      if (w) Object.assign(w, { box, dueAt });
    },
    async listWords() {
      return words.map(clone);
    },

    async addTasks(list, now) {
      const rows = list.map(({ payload, portionId }) => ({
        id: randomUUID(),
        kind: payload.kind,
        lessonNo: payload.lessonNo,
        portionId,
        slot: payload.slot,
        payload: clone(payload),
        tags: [...payload.tags],
        status: 'ready' as const,
        createdAt: now,
      }));
      tasks.push(...rows);
      return rows.map(clone);
    },
    async getTask(id) {
      const t = tasks.find((x) => x.id === id);
      return t ? clone(t) : null;
    },
    async listTasks(f) {
      const list = tasks.filter(
        (t) =>
          (f.status === undefined || t.status === f.status) &&
          (f.slot === undefined || t.slot === f.slot) &&
          (f.lessonNo === undefined || t.lessonNo === f.lessonNo) &&
          (f.portionId === undefined || t.portionId === f.portionId) &&
          (f.kind === undefined || t.kind === f.kind),
      );
      return list.slice(0, f.limit ?? list.length).map(clone);
    },
    async setTaskStatus(ids, status) {
      for (const t of tasks) if (ids.includes(t.id)) t.status = status;
    },
    async updateTaskPayload(id, payload) {
      const t = tasks.find((x) => x.id === id);
      if (t) Object.assign(t, { payload: clone(payload), tags: [...payload.tags] });
    },

    async createSession(s) {
      const row: Session = { ...clone(s), id: randomUUID() };
      sessions.push(row);
      return clone(row);
    },
    async getSession(id) {
      const s = sessions.find((x) => x.id === id);
      return s ? clone(s) : null;
    },
    async activeSession() {
      const s = sessions.filter((x) => !x.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      return s ? clone(s) : null;
    },
    async updateSession(id, patch) {
      const s = sessions.find((x) => x.id === id);
      if (s) Object.assign(s, clone(patch));
    },
    async listSessions(since) {
      return sessions.filter((s) => s.startedAt >= since).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(clone);
    },

    async addAnswer(a) {
      const row: Answer = {
        ...clone(a),
        id: randomUUID(),
        createdAt: a.createdAt ?? new Date().toISOString(),
        disputed: false,
        disputeNote: null,
        review: null,
        reviewedAt: null,
      };
      answers.push(row);
      return clone(row);
    },
    async getAnswer(id) {
      const a = answers.find((x) => x.id === id);
      return a ? clone(a) : null;
    },
    async updateAnswer(id, patch) {
      const a = answers.find((x) => x.id === id);
      if (a) Object.assign(a, clone(patch));
    },
    async listAnswers(f) {
      const list = answers
        .filter(
          (a) =>
            (f.kind === undefined || a.kind === f.kind) &&
            (f.lessonNo === undefined || a.lessonNo === f.lessonNo) &&
            (f.since === undefined || a.createdAt >= f.since) &&
            (!f.pendingReview || (a.kind === 'writing' && a.review === null)) &&
            (!f.pendingDispute || (a.disputed && a.disputeNote === null)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return list.slice(0, f.limit ?? list.length).map(clone);
    },
  };
}
