# Lit-Lang Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram bot that takes a Russian speaker from zero to Lithuanian A2 with Claude-generated, lexicon-verified exercises.

**Architecture:** Next.js on Vercel serves the Telegram webhook and cron routes (no LLM). Supabase holds all state. A CLI (`npm run lit -- …`) is Claude's only data access; the `lit-generate` skill, run daily by a cloud routine, fills the task bank. Word forms come from a lexicon built from kaikki.org (Wiktionary) data.

**Tech Stack:** Node 22, TypeScript, Next.js 16, @supabase/supabase-js, zod, vitest, tsx. Template: `D:\cugop\pet-projects\jobs-search`.

**Spec:** `docs/superpowers/specs/2026-11-03-lit-lang-bot-design.md`

## Global Constraints
- One user: every update from a chat other than `TELEGRAM_CHAT_ID` is ignored.
- Bot never calls an LLM.
- Interface language: Russian. Lithuanian text has no stress marks.
- Session ≈ 15 min: new session = up to 8 portion tasks + 2 review; review session = up to 5 due words + up to 8 review tasks.
- New material: max 2 portions per day.
- Lesson advance: all portions served and lesson accuracy ≥ 70% (last 20 answers of that lesson); else revision; after 3 revisions advance anyway.
- Free RU→LT translation prompts ≤ 6 words.
- Diacritics-only mismatch counts as correct (shows correct spelling) unless the folded answer equals a `reject` form.
- Telegram may delete messages only < 48h old; deletion failures are swallowed.
- Bank warning when < 2 days of material.
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`.

## Review Focus
1. User sends a text when no task is waiting (or in the wrong topic) → polite hint, nothing crashes. Test in Task 7.
2. Webhook delivered twice (Telegram retry) for the same answer → answer recorded once. Test in Task 7 (update_id dedupe on session).
3. Bank empty at session start → explicit message, no empty session. Test in Task 6.
4. Answer with capital letters, trailing dot, missing diacritics, or Lithuanian quotes → judged per rules. Test in Task 2.
5. Topics unavailable (thread ids missing) → everything goes to the main chat. Test in Task 7.

---

### Task 1: Scaffold + text normalization
**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `.gitignore`, `.env.example`, `app/layout.tsx`, `app/page.tsx`, `src/config.ts`, `src/text/normalize.ts`, `tests/text/normalize.test.ts`
**Produces:** `stripStress(s): string` (removes U+0300/0301/0303 and U+0307 after i, keeps ą č ę ė į š ų ū ž), `fold(s): string` (stripStress + remove all Lithuanian diacritics), `normalizeAnswer(s): string` (lowercase, trim, collapse spaces, strip trailing `.!?…`, unify quotes/dashes), `tokenize(s): string[]` (Lithuanian word tokens, lowercase). `loadConfig()` like the template.
- [ ] Tests: `stripStress('knỹgą')==='knygą'`, `stripStress('danti̇̀s')==='dantis'`, `stripStress('duktė̃')==='duktė'`, `fold('šiandien')==='siandien'`, `normalizeAnswer('  Aš  gyvenu. ')==='aš gyvenu'`, `tokenize('„Labas“, Jonai!')` → `['labas','jonai']`.
- [ ] Implement, run `npm test`, commit.

### Task 2: Answer checking + task schema
**Files:** `src/tasks/schema.ts`, `src/tasks/check.ts`, tests.
**Produces:**
- zod `TaskPayload` discriminated by `kind`: `choice {question, options[], correct:number, explanation}`, `input {question, accept[], reject?[], target?{lemma, form:string /*lexicon key*/}, explanation}`, `translate {direction:'ru-lt'|'lt-ru', source, accept[], reject?[], explanation}`, `order {question, words[], accept[] /*sentences*/, explanation}`, `reading {text, questions:[{q, options[], correct}] , glossary?{word:translation}}`, `writing {prompt, minWords, maxWords}`. Common: `tags[]`, `lessonNo`, `slot:'new'|'review'`, `portionKey?`, `unverified?[]`.
- `checkText(answer, accept, reject?) → {correct, exact, expected}`.
- [ ] Tests: exact match; case/punctuation ignored; `siandien` vs accept `šiandien` → correct, exact=false; answer `knyga` with accept `knygą`, reject `knyga` → wrong; multiple accepts.
- [ ] Implement, test, commit.

### Task 3: Lexicon
**Files:** `scripts/build-lexicon.ts`, `src/lexicon/parse.ts`, `src/lexicon/lexicon.ts`, `data/lexicon.json.gz`, `tests/lexicon/parse.test.ts`, `tests/fixtures/kaikki-sample.jsonl`.
**Produces:** `LexEntry {lemma, pos, gender?, gloss, forms: Record<string,string>}`. Form keys: nouns/pron `nom.sg … voc.pl`; adj `m.nom.sg … f.loc.pl`; num `m.nom … f.loc`; verbs `inf`, `pres.1sg/2sg/3/1pl/2pl`, `past.*`, `freq.*`, `fut.*`, `cond.*`, `imp.2sg/1pl/2pl` (first variant; 3rd person shared). `parseEntry(raw) → LexEntry|null`; `loadLexicon(path?) → Lexicon` with `lookup(lemma) → LexEntry[]`, `lemmasOf(form) → {lemma,key}[]`, `has(form)`.
- Verb table parsing: after the first `inflection-template` marker read `error-unrecognized-form` items in blocks pres, past, freq, fut, cond, imp; inside a block the first item is 1sg, `second-person` items are 2sg, the first untagged item after them is 3rd, untagged items matching `/(me|m|mės|mėsi)$/` are 1pl, `plural,second-person` are 2pl, `plural,third-person` ends the block. Discard the verb if parsed `pres.3`/`past.3` ≠ the header forms.
- [ ] Tests on fixture lines for knyga, brolis, dantis, gyventi, mokytis, būti, geras, du: e.g. `forms['gen.sg']==='knygos'`, `gyventi pres.1sg==='gyvenu'`, `mokytis past.1pl==='mokėmės'`, `būti pres.3==='yra'`, `būti fut.3==='bus'`, `geras f.acc.sg==='gerą'`; `lemmasOf('namuose')` contains `{lemma:'namas', key:'loc.pl'}`.
- [ ] Build script reads kaikki JSONL path arg, writes gzip; run it; commit data.

### Task 4: Store (repo) + migrations
**Files:** `supabase/migrations/0001_init.sql`, `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`, `tests/store/contract.ts`, `tests/store/memory.test.ts`, `tests/store/supabase.test.ts` (gated by `RUN_SUPABASE_TESTS=1`).
**Tables:** `settings(key pk, value jsonb)`, `lessons(no pk, title, grammar, topic, skill, words text[])`, `portions(id, lesson_no, seq, theory, words jsonb, status ready|served, served_at)`, `words(id, lemma unique, translation, pos, gender, key_forms jsonb, example, lesson_no, verified, box, due_at, added_at)`, `tasks(id, kind, lesson_no, portion_id, slot, payload jsonb, tags text[], status ready|served|retired, created_at)`, `sessions(id, slot, started_at, finished_at, items jsonb, cursor, message_ids bigint[], last_update_id, state jsonb)`, `answers(id, task_id, session_id, answer, correct, exact, tags, lesson_no, disputed, dispute_note, review, reviewed_at, created_at)`.
**Produces:** `Store` interface — settings get/set; lessons upsert/list/get; portions add/nextReady(lessonNo)/markServed/countReady; words upsert/due(limit, now)/updateBox/list; tasks add/list(filter)/markServed/countReady; sessions create/get/active/update/finish/countNewToday(dayStart); answers add/forLesson(lessonNo, limit)/weakTags(sinceDays)/pendingWritings/pendingDisputes/setReview/setDispute.
- [ ] Contract tests per method on memory store; implement memory + supabase; commit.

### Task 5: Learning logic
**Files:** `src/learn/srs.ts`, `src/learn/progress.ts`, `src/learn/plan-session.ts`, tests.
**Produces:** `nextBox(box, remembered, now) → {box, dueAt}` (Leitner intervals days `[0,1,2,4,8,16,32]`; forgot → box 1, due +10 min). `lessonState(store) → {lessonNo, revisions}` (settings key `progress`). `decideAdvance(accuracy, portionsLeft, revisions) → 'continue'|'revise'|'advance'`. `planSession(store, now) → {slot:'new'|'review', portion?, items: SessionItem[]} | {empty: reason}` where `SessionItem = {type:'task', taskId} | {type:'word', wordId}`.
- [ ] Tests: advance at ≥70% with no portions left; revise below; advance after 3 revisions; slot new when no new today, review after; third session of a day is review; empty bank returns reason; review item counts.
- [ ] Implement, commit.

### Task 6: Telegram API + formatting
**Files:** `src/telegram/api.ts` (template + `message_thread_id`, `editMessageText`, `createForumTopic`), `src/telegram/format.ts`, `src/telegram/keyboards.ts`, `tests/helpers/fake-telegram.ts`, tests.
**Produces:** `TelegramApi.sendMessage(chatId, text, {markup?, threadId?})`, `editMessageText(chatId, id, text, markup?)`, `deleteMessage`, `answerCallbackQuery`, `createForumTopic(chatId, name) → {message_thread_id}`; formatters `formatTask(payload, state)`, `formatFeedback(result, explanation)`, `formatSummary(session)`, `formatWordCard(word)`, `formatProgress(stats)`. Callback data: `c:<idx>` choice, `o:<idx>` order add, `or` reset, `od` done, `d:<answerId>` dispute, `w:show`, `w:y`, `w:n`, `start`.

### Task 7: Bot flow
**Files:** `src/bot/handle-update.ts`, `src/bot/session-runner.ts`, `src/bot/topics.ts`, `app/api/telegram/webhook/route.ts`, `src/telegram/webhook-auth.ts`, tests.
- Session start: plan; if `new`, post portion theory to 📚 and new word cards to 📖 (upsert words, box 0 due now), then tasks in ✏️; every interactive message id stored; on finish delete all, post summary.
- Text answer in ✏️ (or main chat) → current input/translate task; text in 📝 → writing submission. Unexpected text → hint.
- Duplicate `update_id` ignored.
- [ ] Tests with memory store + fake telegram for: full new session, choice + order + input, wrong answer + dispute, word review flow, writing submission, empty bank, foreign chat ignored, duplicate update, no topics configured.

### Task 8: Cron routes
**Files:** `app/api/cron/remind/route.ts`, `src/cron/remind.ts`, `src/cron/auth.ts`, `vercel.json`, tests.
- Remind (06:00 and 17:00 UTC ≈ 08:00/19:00 Vilnius winter): message with «Начать занятие» button + bank warning if < 2 days; also deletes messages of abandoned sessions (> 3 h) and closes them.

### Task 9: CLI
**Files:** `cli/lit.ts`, `cli/commands.ts`, `src/tasks/validate.ts`, tests.
**Commands:** `status`, `weak-spots [--days 14]`, `course load|show <n>`, `vocab list [--due]`, `inflect <lemma>`, `check-form <form> [--lemma l]`, `portion add --file`, `tasks add --file`, `writing pending`, `writing review --file`, `disputes pending`, `disputes resolve --file`, `telegram chat-id|set-webhook --url|setup-topics`.
- `validate`: zod parse; each Lithuanian token in answers/LT texts must be a lexicon form, a known word, or listed in `unverified`; `input.target` form must equal lexicon form and be in `accept`; RU→LT source ≤ 6 words; reports per-item errors, saves only valid items.
- [ ] Tests for validate (unknown form rejected, target mismatch rejected, long translate rejected) and status output.

### Task 10: Course + skill + docs
**Files:** `course/lessons.json` (≈50 lessons), `.claude/skills/lit-generate/SKILL.md`, `README.md` (setup: BotFather, Supabase, Vercel, topics, routine), first content batch for lesson 1–2 via the CLI JSON format in `course/seed/`.
- [ ] `npm test`, `npm run typecheck`, `npm run build` all pass; commit.
