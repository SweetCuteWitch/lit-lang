# Возврат заданий и рецепты упражнений — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Задания закрепления перестают расходоваться (счётчик освоения 0–5 + дата показа, веса по темам), а бот сам добирает занятие заданиями из рецептов, которые CLI заранее развернул по лексикону.

**Architecture:** Счётчик и веса — чистые функции в `src/learn/mastery.ts` и `src/learn/pick.ts`; планировщик `plan-session.ts` собирает занятие из «созревших» заданий и вариантов рецептов. Рецепт (`src/tasks/recipe.ts`) разворачивается в CLI при `bank add` в готовые варианты (формы, accept/reject, дистракторы), бот без лексикона превращает вариант в обычное задание (`src/tasks/from-variant.ts`). Хранилище — новые поля `tasks` и таблица `recipes`.

**Tech Stack:** TypeScript, zod, vitest, Supabase (Postgres), Next.js на Vercel (бот), Node CLI.

**Spec:** `docs/superpowers/specs/2026-11-19-review-rotation-and-drills-design.md`

## Global Constraints
- `INTERVAL = [1, 3, 7, 14, 30, 60]` дней по **новому** score; `dueAt = локальная полночь (Вильнюс) через N дней`.
- Score: верно+точно → `min(score+1, 5)`; верно без диакритики → без изменений; неверно / «Не знаю» → `0`.
- Спор: кнопка → `score = 2`; вердикт `wrong` → `score = 0`, `dueAt` = завтра.
- Слабый тег: ≥ 3 ошибок за 14 дней **или** точность < 0.7 при ≥ 3 ответах. Освоенный: ≥ 5 ответов, точность ≥ 0.9, 0 ошибок за 7 дней.
- Вес задания: `(6 − score) × m`, m = 3 (есть слабый тег), 0.3 (все теги освоенные), иначе 1.
- Закрепление: `WORDS_PER_SESSION = 3`, `REVIEW_TASKS_PER_SESSION = 10`, `WEAK_TASKS_PER_SESSION = 6`; из одного рецепта ≤ 4 на занятие и ≤ 2 подряд.
- `writing` не вращается. Задание `slot=new` вращается только после того, как показано (`status = served`). `retired` не выдаётся никогда.
- Бот (Vercel) не загружает лексикон: всё из лексикона кладётся в `recipes.variants` в CLI.
- Тексты для пользователя — по-русски; литовские формы — только из лексикона.
- Случайность — через параметр `rand: () => number` (по умолчанию `Math.random`).

## Review Focus
1. **Старые данные после миграции**: задания со `status = served`, `score = 0`, `due_at = null` должны сразу стать кандидатами (null → `createdAt`), а `ready`-задания неподанных порций — нет. Тест в Task 5.
2. **Чтение с несколькими вопросами**: одна ошибка в середине → score 0, даже если последний вопрос верный; score обновляется ровно один раз. Тест в Task 6.
3. **Повторный `bank add` того же рецепта** не плодит дубли и не сбрасывает счётчики неизменённых вариантов; изменённый ответ → старое задание `retired`. Тест в Task 7.
4. **Пустой пул**: нет созревших заданий и рецептов — занятие закрепления из одних карточек слов или «пусто», без падения. Тест в Task 5.
5. **Двойное создание задания из одного варианта** (повторное планирование/гонка) — уникальность (`recipeId`, `variantKey`), второй раз задание не создаётся. Тест в Task 1 (контракт хранилища).

---

### Task 1: Хранилище — поля освоения у заданий и таблица рецептов

**Files:**
- Create: `supabase/migrations/0003_rotation_recipes.sql`
- Modify: `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`
- Test: `tests/store/contract.ts`

**Interfaces:**
- Produces (в `src/store/types.ts`):
  - `Task` += `score: number; dueAt: string | null; recipeId: string | null; variantKey: string | null`.
  - `addTasks(tasks: { payload: TaskInput; portionId: string | null; recipeId?: string; variantKey?: string }[], now: string): Promise<Task[]>` — пара (`recipeId`, `variantKey`), уже существующая, пропускается молча; возвращает только созданные.
  - `updateTaskScore(id: string, score: number, dueAt: string): Promise<void>`
  - `listTasks(filter)` — `TaskFilter` += `recipeId?: string`.
  - `RecipeRecord = { name: string; kind: 'form'; lessonNo: number; tags: string[]; payload: unknown; variants: Variant[] }` (`Variant` — из Task 3, импорт типа из `src/tasks/from-variant.ts`; в Task 1 можно объявить его там заранее), `Recipe = RecipeRecord & { id: string; createdAt: string }`.
  - `upsertRecipe(r: RecipeRecord, now: string): Promise<Recipe>` — по `name`; при замене `id` и `createdAt` сохраняются.
  - `getRecipe(name: string): Promise<Recipe | null>`, `listRecipes(): Promise<Recipe[]>`.

- [ ] **Step 1: Тесты контракта** в `storeContract`:
  - `new tasks start with score 0 and null dueAt` — `addTasks` → `score === 0`, `dueAt === null`, `recipeId === null`.
  - `updateTaskScore stores score and dueAt` — после вызова `getTask` возвращает их.
  - `addTasks skips a duplicate recipe variant` — два вызова с одним `recipeId`/`variantKey: '0#būti'` → второй возвращает `[]`, `listTasks({ recipeId })` длины 1.
  - `upsertRecipe replaces by name and keeps id` — второй upsert с теми же `name` и другими `variants` → тот же `id`, новые `variants`; `listRecipes()` длины 1; `getRecipe('nope')` → `null`.
- [ ] **Step 2:** `npm test -- tests/store/memory.test.ts` → FAIL (нет полей/методов).
- [ ] **Step 3: Миграция `0003`:** `tasks` += `score smallint not null default 0`, `due_at timestamptz`, `recipe_id uuid references recipes(id)`, `variant_key text`; `create unique index tasks_recipe_variant_idx on tasks (recipe_id, variant_key) where recipe_id is not null`; `create index tasks_due_idx on tasks (due_at)`. Таблица `recipes` (`id uuid pk default gen_random_uuid()`, `name text not null unique`, `kind text not null`, `lesson_no integer not null`, `tags text[] not null default '{}'`, `payload jsonb not null`, `variants jsonb not null default '[]'`, `created_at timestamptz not null`) создаётся **до** изменения `tasks`; `enable row level security`.
- [ ] **Step 4:** Реализовать в `memory.ts` и `supabase.ts` (Supabase: `insert ... onConflict` нельзя по частичному индексу — сначала выбрать существующие `variant_key` для `recipe_id`, вставить остальные; маппинг `taskRow` дополнить полями).
- [ ] **Step 5:** `npm test -- tests/store/memory.test.ts` → PASS; `npm run typecheck` → без ошибок.
- [ ] **Step 6: Commit** `feat(store): task mastery fields and recipes table`.

### Task 2: Счётчик освоения и статистика тегов

**Files:**
- Create: `src/learn/mastery.ts`
- Modify: `src/learn/progress.ts`
- Test: `tests/learn/mastery.test.ts`

**Interfaces:**
- Produces (`src/learn/mastery.ts`):
  - `TASK_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60]`, `MAX_SCORE = 5`
  - `nextTaskScore(score: number, r: { correct: boolean; exact: boolean }): number`
  - `taskDueAt(score: number, now: Date): string` — локальная полночь через `TASK_INTERVAL_DAYS[score]` дней (через `dayStart` из `src/time.ts`; чтобы не съехать на переходе времени, взять `dayStart(dayStart(now) + N·24ч + 12ч)`).
  - `TagStat = { tag: string; answers: number; wrong: number; wrong7: number; accuracy: number }`
  - `tagStats(store: Store, now: Date, days = 14): Promise<Map<string, TagStat>>` — по ответам `kind: 'task'` с `correct !== null`.
  - `tagClass(s: TagStat | undefined): 'weak' | 'mastered' | 'normal'`
  - `taskWeight(task: Pick<Task, 'score' | 'tags'>, stats: Map<string, TagStat>): number`
- `progress.ts`: `weakTags` не меняется (его использует CLI).

- [ ] **Step 1: Тесты:**
  - `nextTaskScore`: `(0,{correct:true,exact:true}) → 1`, `(5, exact) → 5`, `(3,{correct:true,exact:false}) → 3`, `(4,{correct:false,exact:false}) → 0`.
  - `taskDueAt`: при `now = 2026-11-03T20:00:00Z` (22:00 Вильнюс) `taskDueAt(0) === '2026-11-03T22:00:00.000Z'` (полночь 4-го по Вильнюсу), `taskDueAt(1) === '2026-11-05T22:00:00.000Z'`.
  - `tagClass`: `{answers:4, wrong:3}` → weak; `{answers:3, wrong:1, accuracy:0.66}` → weak; `{answers:5, wrong:0, wrong7:0, accuracy:1}` → mastered; `{answers:10, wrong:1, wrong7:1, accuracy:0.9}` → normal; `undefined` → normal.
  - `taskWeight`: score 0 + слабый тег → 18; score 5 + только освоенные → `0.3` (≈); слабый + освоенный → `(6-score)*3`.
  - `tagStats` на memory-store: 3 ответа с тегом `a` (2 неверных, один из них 8 дней назад) → `{answers:3, wrong:2, wrong7:1}`.
- [ ] **Step 2:** `npm test -- tests/learn/mastery.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(learn): task mastery score and tag stats`.

### Task 3: Задание из варианта

**Files:**
- Create: `src/tasks/from-variant.ts`
- Test: `tests/tasks/from-variant.test.ts`

**Interfaces:**
- Produces: типы `Present` и `Variant` (поля — в Task 4, «Interfaces») объявляются здесь, в `src/tasks/from-variant.ts`; `recipe.ts` их импортирует и реэкспортирует.
- Produces: `taskFromVariant(r: { lessonNo: number; tags: string[]; explanation: string }, v: Variant, present: Present, rand?: () => number): TaskInput` — всегда `slot: 'review'`, `unverified: []`, `explanation = [r.explanation, v.note].filter(Boolean).join(' ')`.
  - `input`: `{ question: v.question, accept: v.accept, reject: v.reject, target: v.target ?? undefined }`
  - `choice`: `options` = `[v.answer, ...v.distractors]`, перемешанные `rand`; `correct` = индекс ответа.
  - `order`: `question: 'Соберите фразу'` + `(lemma)`-подсказка из `v.question` в режиме формы; `words` = `v.orderWords` перемешанные (если перемешивание дало исходный порядок — сдвинуть на 1); `accept = [v.orderWords.join(' ')]`.

- [ ] **Step 1: Тесты:** для варианта `esu` — `input` содержит `accept ['esu']` и `target`; `choice` с `rand = () => 0` содержит все `[answer, ...distractors]` ровно по разу и `options[correct] === 'esu'`; `order` — `words` не в исходном порядке, `accept[0] === 'Aš esu studentas.'`; `explanation` склеивает рецепт и `note`.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(tasks): build tasks from recipe variants`.

### Task 4: Рецепт — схема и развёртка по лексикону

**Files:**
- Create: `src/tasks/recipe.ts`
- Modify: `src/tasks/validate.ts` (вынести проверку совпадений без диакритики в экспортируемую функцию)
- Test: `tests/tasks/recipe.test.ts` (лексикон — `tests/helpers/fixture-lexicon.ts`; если в нём нет нужных слов, дополнить фикстуру минимальными записями `būti`, `Rusija`, `vardas`, `pavardė`)

**Interfaces:**
- Produces:
  - `RecipeInput` (zod): `{ name: /^[a-z0-9-]+$/, kind: 'form', lessonNo: int ≥1, tags: string[] ≥1, explanation: string, frames: { lt: string; key: string; note?: string }[] ≥1, words: string[] ≥1, byGender?: { m: string; f: string }, present: ('input'|'choice'|'order')[] ≥1 }`; refine: в каждой `lt` ровно один `___`; при `byGender` в `lt` есть `{word}`.
  - `type Present = 'input' | 'choice' | 'order'` (объявлен в Task 3)
  - `Variant = { key: string; frame: number; lemma: string; question: string; answer: string; accept: string[]; reject: string[]; distractors: string[]; orderWords: string[] | null; present: Present[]; note: string; target: { lemma: string; key: string } | null }`
  - `expandRecipe(r: RecipeInput, env: ValidationEnv): { variants: Variant[]; warnings: string[] }`
  - В `validate.ts`: `diacriticClashes(lex: Lexicon, answer: string, listed: Set<string>): string[]` — то, что сейчас считается внутри `validateTask`; `validateTask` использует её.

Правила развёртки (из спеки):
- `key = "${frameIndex}#${lemma}"`. Слово без записи в лексиконе или без формы `key` → вариант пропущен, предупреждение (слова только с `keyForms` пропускаются всегда — решение плана: у `keyForms` нет ключей форм).
- Режим формы: `answer` = первая форма `forms[key]`, `accept` = все варианты `forms[key]`, `question = lt.replace('{word}', …) + " (lemma)"`, `target = {lemma, key}`, `reject = diacriticClashes(...)`.
- `byGender`: род из записи лексикона (нет рода → пропуск), `{word}` ← форма `key`, `answer = byGender[g]`, `accept = [answer]`, `distractors` = другое значение, `target = null`, без подсказки в вопросе.
- `distractors` (режим формы): до 3 других форм той же записи, отличных от `accept`; сначала ключи той же группы — для глаголов тот же первый сегмент (`pres.*`), для остальных тот же последний (`*.sg`), — затем прочие; без повторов.
- `orderWords`: фраза с подставленным ответом, `split(/\s+/)`, только если `present` содержит `order` и слов ≥ 3; иначе `null`, и `order` убирается из `present` варианта. `choice` без дистракторов тоже убирается. Вариант без единого вида — пропуск.
- Проверка каждого вида: собрать задание через `taskFromVariant` (Task 3) и прогнать `validateTask` с `lessonNo` рецепта; вид с ошибками убирается из `present`, ошибки — в `warnings`.

- [ ] **Step 1: Тесты:**
  - `expands a conjugation recipe`: рецепт `buti` с рамками `Aš ___ studentas.`/`pres.1sg` и `Jos ___ mano draugės.`/`pres.3`, слова `['būti']` → 2 варианта; у первого `answer 'esu'`, `question 'Aš ___ studentas. (būti)'`, `target {lemma:'būti',key:'pres.1sg'}`, `distractors` содержат только формы `pres.*` (`esi`, `yra`, …) и их ≤ 3.
  - `expands iš + gen`: `Aš esu iš ___.`/`gen.sg`, `['Rusija']` → `answer 'Rusijos'`, `orderWords ['Aš','esu','iš','Rusijos.']`.
  - `byGender picks koks/kokia`: `___ jūsų {word}?`/`nom.sg`, `['vardas','pavardė']`, `byGender {m:'Koks',f:'Kokia'}` → ответы `Koks`, `Kokia`, вопросы `___ jūsų vardas?`, `distractors ['Kokia']`/`['Koks']`.
  - `skips unknown words with a warning`: слово `rašiklis` (нет в лексиконе) → 0 вариантов от него, `warnings` содержит `rašiklis`.
  - `refuses a frame without ___`: `RecipeInput.safeParse` → `success false`.
  - `validate.ts`: существующие тесты `tests/tasks/validate.test.ts` проходят без изменений.
- [ ] **Step 2:** `npm test -- tests/tasks/recipe.test.ts` → FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** `npm test -- tests/tasks` → PASS.
- [ ] **Step 5: Commit** `feat(tasks): form recipes expanded by the lexicon`.

### Task 5: Планировщик — веса, слабая доля, добор рецептами

**Files:**
- Create: `src/learn/pick.ts`
- Modify: `src/learn/plan-session.ts`, `src/learn/progress.ts` (`REVIEW_TASKS_PER_SESSION = 10`, `bankStatus`), `src/telegram/format.ts` (`formatSummary`: «Нового материала осталось примерно на N дн.»)
- Test: `tests/learn/learn.test.ts` (обновить), `tests/learn/pick.test.ts`

**Interfaces:**
- Consumes: `taskWeight`, `tagStats`, `tagClass` (Task 2); `taskFromVariant` (Task 3); `Store.addTasks/listRecipes/listTasks` (Task 1).
- Produces:
  - `pick.ts`: `weightedSample<T>(items: T[], weight: (t: T) => number, k: number, rand: () => number): T[]` — без повторов, ключ `rand() ** (1 / w)`, берутся k наибольших; `w ≤ 0` не выбирается.
  - `pick.ts`: `rotatingCandidates(tasks: Task[], now: Date, maxLesson: number, onlyLesson?: number): Task[]` — `status !== 'retired'`, `kind !== 'writing'`, `slot === 'review' || status === 'served'`, `(dueAt ?? createdAt) ≤ now`, урок по условию.
  - `pick.ts`: `fillFromRecipes(store: Store, opts: { now: Date; maxLesson: number; need: number; weakOnly: boolean; stats: Map<string, TagStat>; perRecipe: Map<string, number>; rand: () => number }): Promise<Task[]>` — рецепты урока ≤ maxLesson; при `weakOnly` только со слабым тегом; порядок — рецепты со слабым тегом, затем по возрастанию минимальной точности их тегов (тег без ответов = 0.8); варианты, для которых ещё нет задания (`listTasks({ recipeId })`), берутся случайно, по кругу между рецептами, с учётом лимита 4 на рецепт в `perRecipe`; вид — случайный из `variant.present`; задания создаются через `addTasks` с `recipeId`/`variantKey`.
  - `pick.ts`: `spreadByRecipe(tasks: Task[]): Task[]` — переставляет так, чтобы не было больше 2 подряд с одним `recipeId` (если возможно).
  - `plan-session.ts`: `WORDS_PER_SESSION = 3`, `WEAK_TASKS_PER_SESSION = 6`, `MAX_PER_RECIPE = 4`; `PlanOptions` += `rand?: () => number`; `pickReview(store, now, lessonNo, limit, { onlyLesson?, weakMin, rand })` реализует алгоритм спеки (слабая часть до `weakMin` из кандидатов → добор рецептами `weakOnly` → остальное по весу → добор рецептами → короче).
  - Занятие нового материала: 2 задания `pickReview(..., { weakMin: 0 })`. Повторение урока: `onlyLesson = lessonNo`, `weakMin = 6`.
  - `bankStatus`: `days = portionsReady`, `low = portionsReady < 2`; `reviewReady` = число вращающихся заданий (без учёта срока); новое поле `dueNow` = число кандидатов на сейчас.

- [ ] **Step 1: Тесты `pick.test.ts`:** `weightedSample` с фиксированным `rand` возвращает k разных элементов и не берёт `w = 0`; при весах `[18, 0.3]` и 1000 прогонов с `Math.random` первый выбирается первым ≥ 95% раз; `rotatingCandidates` исключает `retired`, `writing`, `ready`-задание `slot=new`, задание с `dueAt` завтра, и включает `served` с `dueAt = null` (Review Focus 1); `spreadByRecipe(['r1','r1','r1','x'])` → нет трёх `r1` подряд.
- [ ] **Step 2: Тесты планировщика (`learn.test.ts`):**
  - `review session takes ≥6 weak-tag tasks when available`: 8 заданий с тегом `w` (3 неверных ответа по `w`) + 8 с тегом `ok` → 10 заданий, из них ≥ 6 с `w`, + ≤ 3 карточки слов.
  - `served tasks come back when due`: задание показано, `updateTaskScore(id, 1, вчера)` → снова в плане; с `dueAt` завтра — нет.
  - `fills from recipes when the pool is short`: 0 заданий, рецепт с 5 вариантами → в плане 4 задания (лимит на рецепт) с `recipeId`; повторный план не создаёт дублей (`listTasks({recipeId})` = 4 + новые варианты, не больше 5).
  - `empty pool gives words only or an empty plan` (Review Focus 4).
  - Существующие тесты, ожидающие «задание расходуется» — переписать под возврат.
- [ ] **Step 3:** `npm test -- tests/learn` → FAIL. **Step 4:** реализовать. **Step 5:** → PASS, `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(learn): weighted review with weak-topic share and recipe fill`.

### Task 6: Бот — обновление счётчика после ответа и спора

**Files:**
- Modify: `src/bot/session.ts`, `src/store/types.ts` (`SessionState` += `readingWrong?: boolean`)
- Test: `tests/bot/bot.test.ts`

**Interfaces:**
- Consumes: `nextTaskScore`, `taskDueAt` (Task 2), `Store.updateTaskScore` (Task 1).
- Produces: внутренняя `applyScore(ctx: BotCtx, task: Task, r: { correct: boolean; exact: boolean }): Promise<void>`; вызывается для `choice`/`input`/`translate`/`order`/«Не знаю» сразу, для `reading` — один раз после последнего вопроса с `correct = !readingWrong`, `exact = correct`. В `dispute()`: если у ответа есть `taskId` — `updateTaskScore(taskId, 2, taskDueAt(2, now))`.

- [ ] **Step 1: Тесты:** верный `choice` → score 1, `dueAt` = полночь через 3 дня; ответ без диакритики → score не меняется; «Не знаю» → 0; чтение из 3 вопросов с ошибкой во 2-м и верным 3-м → score 0, `updateTaskScore` вызван один раз (Review Focus 2); спор → score 2.
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать. **Step 4:** `npm test -- tests/bot` → PASS.
- [ ] **Step 5: Commit** `feat(bot): update task mastery after answers and disputes`.

### Task 7: CLI — рецепты в `bank add`, `recipes retire`, споры, `status`

**Files:**
- Modify: `cli/commands.ts`
- Test: `tests/cli/commands.test.ts`

**Interfaces:**
- Consumes: `RecipeInput`, `expandRecipe` (Task 4); `upsertRecipe/getRecipe/listRecipes/updateTaskScore/setTaskStatus` (Task 1); `taskDueAt`, `tagStats`, `tagClass` (Task 2); `bankStatus` (Task 5).
- Produces:
  - `BankFile` += `recipes: z.array(z.unknown()).default([])`; обрабатываются после порций и заданий, `known` — тот же `knownLemmas`. Вывод: `✓ рецепт <name> (урок N): K вариантов` (+ предупреждения строками `  ⚠ …`), `✗ рецепт #i: …` при ошибке схемы или 0 вариантах; код возврата 1 при любой `✗`.
  - Замена: если `getRecipe(name)` есть — задания рецепта (`listTasks({ recipeId })`), чей `variantKey` исчез или чей `answer` варианта изменился, → `setTaskStatus(..., 'retired')`; остальные сохраняют счётчики (Review Focus 3).
  - `recipes retire <name>` — все задания рецепта `retired`, сам рецепт получает `variants: []`. `recipes list` — имя, урок, теги, «использовано X из Y вариантов».
  - `DisputeFile` += `retireTask: z.boolean().default(false)`; `verdict: 'wrong'` → `updateTaskScore(taskId, 0, taskDueAt(0, now))`; `retireTask` → `setTaskStatus([taskId], 'retired')`.
  - `status`: строка «Запас» → `Запас: ~N дн. нового материала (порций: N)…`; новые строки `В обороте: X заданий, к показу сейчас: Y; по score 0–5: a/b/c/d/e/f`, `Рецепты: K (неиспользованных вариантов: U)`, `Слабые темы: …`, `Освоенные темы: …`.
  - `USAGE` дополнить.

- [ ] **Step 1: Тесты:** `bank add` с рецептом `buti` → `✓ рецепт buti (урок 2)`, `listRecipes()` длины 1; повторный `bank add` того же рецепта с изменённой рамкой 0 → задание по старой рамке 0 `retired`, задание рамки 1 сохраняет score; `recipes retire buti` → все задания `retired`; `disputes resolve` с `wrong` → score 0, с `retireTask` → `retired`; `status` печатает строки «В обороте» и «Рецепты».
- [ ] **Step 2:** → FAIL. **Step 3:** реализовать. **Step 4:** `npm test` → PASS, `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(cli): recipes in bank add, recipes retire, mastery in status`.

### Task 8: Скилл и первые рецепты на уроки 1–4

**Files:**
- Create: `course/seed/lesson-04-recipes.json` (рецепты уроков 2–4; имя файла после `lesson-02.json`, чтобы seed-тест загружал его после программы и уроков)
- Modify: `.claude/skills/lit-generate/SKILL.md`, `README.md` (шаг развёртывания: миграция `0003`)
- Test: `tests/course/seed.test.ts` (уже прогоняет все файлы `course/seed` через `bank add` с реальным лексиконом)

Рецепты (формат спеки, все `present` — по смыслу):
- `buti-pres` (урок 2, `verb:būti`): рамки на все 6 лиц (`Aš ___ studentas.` pres.1sg; `Tu ___ mano draugas.` pres.2sg; `Jis ___ mokytojas.` pres.3; `Jos ___ mano draugės.` pres.3 с `note` «jos → yra»; `Mes ___ draugai.` pres.1pl; `Jūs ___ studentai?` pres.2pl), слово `būti`, `present: ["input","choice","order"]`.
- `koks-kokia` (урок 3, `gender`, `introduce`): `___ jūsų {word}?` nom.sg, слова `vardas, pavardė, telefonas, šalis, knyga, namas, kėdė, kompiuteris`, `byGender {m:"Koks", f:"Kokia"}`, `present: ["choice"]`.
- `is-gen-countries` (урок 4, `prep:iš+gen`, `case:gen:sg`): `Aš esu iš ___.`, `Mano draugas yra iš ___.`, `Ji yra iš ___.` gen.sg; слова `Lietuva, Rusija, Ukraina, Latvija, Lenkija, Vokietija`; `present: ["input","choice","order"]`.
- `kalbeti-pres` (урок 4, `verb:pres:conj2`): 6 лиц с `lietuviškai/rusiškai/angliškai`; слово `kalbėti`; `present: ["input","choice","order"]`.

- [ ] **Step 1:** Написать файл; `npm test -- tests/course/seed.test.ts` → PASS (если вариант отклонён — исправить рецепт, не валидатор).
- [ ] **Step 2:** `SKILL.md`: раздел «Рецепты» (формат, правила развёртки кратко, имена, замена, `recipes retire`, `retireTask` в спорах); шаг 5 — цели: рецепт на грамматику каждого пройденного урока и на каждый слабый тег без рецепта; ручных review-заданий — переводы, чтение, письмо и то, что рецептом не выразить; цель после генерации `≥ 2 порции впереди` (убрать «≥ 40 review-заданий»).
- [ ] **Step 3:** `npm test && npm run typecheck && npm run build` → всё зелёное.
- [ ] **Step 4: Commit** `feat(course): first recipes; skill docs for recipes`.
- [ ] **Step 5 (с пользователем, до деплоя/merge):** пользователь выполняет `supabase/migrations/0003_rotation_recipes.sql` в SQL Editor (миграция аддитивная, старый код на ней работает), затем мержит и выкатывает бот; затем `npm run -s lit -- bank add --file course/seed/lesson-04-recipes.json` и `status`.
