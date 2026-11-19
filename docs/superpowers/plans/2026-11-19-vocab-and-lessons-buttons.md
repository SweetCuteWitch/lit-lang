# Кнопки «Словарь» и «Уроки» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Под «📊 Прогресс» — кнопки «📖 Словарь» (все слова с переводом и формами) и «📚 Уроки» (список пройденных уроков, затем ввод номера → теория урока заново).

**Architecture:** Чистые функции форматирования в `src/telegram/format.ts`; обработчики в новом `src/bot/library.ts`; подключение в `src/bot/handle-update.ts`. Ожидание номера — настройка `awaitingLesson` в store.

**Tech Stack:** TypeScript, vitest, Telegram Bot API (inline-кнопки, темы).

**Spec:** `docs/superpowers/specs/2026-11-19-vocab-and-lessons-buttons-design.md`

## Global Constraints
- Сообщение ≤ 4000 символов; словарь режется только между строками.
- Окно ожидания номера — 10 минут; номер — `/^\d{1,3}$/` после trim.
- Пройденный урок = у него есть порция со `status === 'served'`; теория — только выданные порции, по `seq`.
- Словарь → тема `vocab`, уроки и теория → тема `lessons` (через существующий `send(ctx, topic, …)`).
- Тексты: «Напишите номер урока, чтобы прочитать его ещё раз.», «Такого урока пока нет. Доступны: <номера через запятую>.», при пустом словаре «Словарь пока пуст.», без пройденных уроков «Пройденных уроков пока нет.»
- Callback data: `vocab`, `lessons`. Команды: `/vocab`, `/lessons`.

## Review Focus
1. Число во время активного занятия при ожидании номера → выбор урока, не ответ на задание; без ожидания — обычный ответ. Тест в Task 2.
2. Истёкшее ожидание (> 10 мин) → число идёт обычным путём. Тест в Task 2.
3. Неверный номер → подсказка, ожидание остаётся; верный → теория, ожидание снято. Тест в Task 2.
4. Словарь > 4000 символов → несколько сообщений, ни одно не длиннее 4000, ни одна строка не разорвана. Тест в Task 1.
5. Слова и названия с `<`, `&` экранируются (`esc`). Тест в Task 1.

---

### Task 1: Форматирование словаря, списка уроков и порции

**Files:**
- Modify: `src/telegram/format.ts`, `src/bot/session.ts` (`postPortion` использует новый `formatPortion`)
- Test: `tests/telegram/format.test.ts` (создать)

**Interfaces:**
- Produces (в `format.ts`):
  - `progressButtons(): InlineMarkup` — `[[['📖 Словарь','vocab'],['📚 Уроки','lessons']]]`.
  - `formatVocabList(words: Word[], lessons: Lesson[]): string[]` — группы по `lessonNo` по возрастанию, заголовок `📖 <b>Урок N: <название></b>` (без названия — `📖 <b>Урок N</b>`), строка `<b>лемма</b> — перевод` + ` <i>(м. р.|ж. р.)</i>` если есть род + ` · ` + `keyForms.join(', ')` если форм > 1; чанки ≤ 4000; пустой список → `['Словарь пока пуст.']`.
  - `formatLessonsList(lessons: Pick<Lesson,'no'|'title'>[]): string` — `📚 <b>Пройденные уроки</b>`, строки `N. <название>`, последняя строка — текст из Global Constraints; пустой → «Пройденных уроков пока нет.»
  - `formatPortion(lesson: Lesson | null, portion: Portion): string` — ровно текущий текст из `postPortion` (`📚 <b>Урок N: title</b> · часть k\n\n<theory>`); `postPortion` переходит на него.

- [ ] **Step 1: Тесты:** `formatVocabList` на 2 уроках даёт заголовки по порядку и строку `<b>knyga</b> — книга <i>(ж. р.)</i> · knyga, knygos, knygą`; 300 слов → ≥ 2 чанка, каждый ≤ 4000, склейка чанков через `\n` содержит каждую строку слова целиком; перевод `a < b & c` экранирован; пустой → «Словарь пока пуст.»; `formatLessonsList([{no:1,title:'Labas!'}])` содержит `1. Labas!` и строку про номер; `formatPortion` совпадает с прежним форматом.
- [ ] **Step 2:** `npm test -- tests/telegram/format.test.ts` → FAIL. **Step 3:** реализовать. **Step 4:** → PASS, `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(format): vocab list, lessons list and portion formatting`.

### Task 2: Обработчики и подключение

**Files:**
- Create: `src/bot/library.ts`
- Modify: `src/bot/handle-update.ts`
- Test: `tests/bot/library.test.ts` (создать; по образцу `tests/bot/bot.test.ts` с `createFakeTelegram`, `createMemoryStore`)

**Interfaces:**
- Consumes: `progressButtons`, `formatVocabList`, `formatLessonsList`, `formatPortion` (Task 1); `send(ctx, topic, text, opts)` из `src/bot/context.ts`.
- Produces (`library.ts`):
  - `AWAIT_LESSON_MS = 10 * 60_000`; настройка `awaitingLesson: { until: string } | null`.
  - `showVocab(ctx: BotCtx): Promise<void>` — шлёт чанки в `vocab`.
  - `showLessons(ctx: BotCtx): Promise<void>` — шлёт список в `lessons`; если есть пройденные — ставит `awaitingLesson` на `now + AWAIT_LESSON_MS`.
  - `tryLessonNumber(ctx: BotCtx, text: string): Promise<boolean>` — `false`, если нет действующего ожидания или текст не число; иначе отвечает (теория или подсказка) и возвращает `true`; при успехе снимает ожидание.
- `handle-update.ts`: `showProgress` шлёт с `markup: progressButtons()` (основная клавиатура постоянная, не теряется); `/vocab`, `/lessons` → обработчики; callback `vocab`/`lessons` → сначала `answerCallbackQuery`, затем обработчик; в `onText` вызов `tryLessonNumber` — сразу после команд/кнопок, до письма и ответа на задание.

- [ ] **Step 1: Тесты:**
  - «📊 Прогресс» → сообщение с inline-кнопками `vocab` и `lessons`.
  - callback `vocab` → в тему словаря пришли строки слов из store.
  - callback `lessons` при выданных порциях уроков 1–2 → список `1. …`, `2. …`; затем текст `2` → в тему уроков пришли все выданные порции урока 2 по порядку; повторный `2` уже не перехватывается (ожидание снято).
  - `7` при ожидании → «Такого урока пока нет. Доступны: 1, 2.», ожидание остаётся.
  - активное занятие с заданием `input` и ожидание → `2` не засчитан как ответ (ответов в store не прибавилось), пришла теория (Review Focus 1); без ожидания `2` идёт в ответ.
  - ожидание старше 10 минут → `2` идёт обычным путём (Review Focus 2).
- [ ] **Step 2:** `npm test -- tests/bot/library.test.ts` → FAIL. **Step 3:** реализовать. **Step 4:** → PASS, `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(bot): vocab and lessons buttons under progress`.
