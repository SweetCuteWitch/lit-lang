# Lit-Lang Bot

Личный Telegram-бот для изучения литовского с нуля до A2 (экзамен I категории для ПМЖ).
Задания придумывает Claude по ежедневному расписанию (облачная routine), формы слов проверяются
по лексикону из Викисловаря, бот выдаёт и проверяет задания.

- Дизайн: `docs/superpowers/specs/2026-11-03-lit-lang-bot-design.md`
- План: `docs/superpowers/plans/2026-11-03-lit-lang-bot.md`
- Программа курса: `course/lessons.json`, стартовый материал: `course/seed/`
- Скилл генерации: `.claude/skills/lit-generate/SKILL.md`

## Как устроено
```
routine (раз в день) ── /lit-generate ──> CLI ──> Supabase <── бот (Vercel webhook) <──> Telegram
                                                     ^
                                      Vercel cron ───┘ (напоминания 08:00 и 19:00 по Вильнюсу)
```
- `app/api/telegram/webhook` — бот; `app/api/cron/remind` — напоминания.
- `src/bot` — занятия, `src/learn` — программа и повторение, `src/lexicon` — формы слов,
  `src/tasks` — схема, проверка ответов и валидация заданий, `src/store` — Supabase / память.
- `cli/` — инструменты для Claude: `npm run lit -- <команда>` (без аргументов — список).

## Развёртывание (один раз)
1. **Бот.** В @BotFather: `/newbot`, получите токен. Для тем в личном чате включите в настройках бота
   режим тем (Bot Settings → Threaded Mode / Topics), если он доступен.
2. **Supabase.** Новый проект → SQL Editor → выполните по порядку `supabase/migrations/0001_init.sql` и `0002_processed_updates.sql`.
   Нужны Project URL и service_role key.
3. **`.env.local`** по образцу `.env.example`. Секреты (`TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`) —
   случайные строки 16+ символов из `A-Za-z0-9_-`.
4. **ID чата.** Напишите боту `/start`, затем `npm run lit -- telegram chat-id` → `TELEGRAM_CHAT_ID`.
5. **Программа и стартовый материал:**
   ```
   npm run lit -- course load
   npm run lit -- bank add --file course/seed/lesson-01.json
   npm run lit -- bank add --file course/seed/lesson-02.json
   ```
6. **Vercel.** Импортируйте репозиторий, добавьте переменные из `.env.local`, задеплойте.
   Затем `npm run lit -- telegram set-webhook --url https://<app>.vercel.app/api/telegram/webhook`.
7. **Темы.** `npm run lit -- topics setup` создаст 📚 Уроки, ✏️ Тренировка, 📖 Словарь, 📝 Письмо.
   Если Telegram откажет (темы в личке недоступны): создайте приватную группу с темами, добавьте бота
   админом, впишите ID группы в `TELEGRAM_CHAT_ID` (и в Vercel) и повторите `topics setup`.
   Без тем всё работает в одном чате (`topics clear`).
8. **Routine.** Запушьте репозиторий на GitHub (приватный). В Claude Code: `/schedule` → ежедневная
   облачная routine на этом репозитории с промптом `/lit-generate`; в окружение routine добавьте
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
   Сначала запустите её вручную один раз и проверьте `status` — так видно, что из облака есть доступ
   к Supabase. Запасного варианта нет: если routine не работает, `/lit-generate` можно запустить локально.

## Разработка
```
npm test            # все тесты (Supabase — только с RUN_SUPABASE_TESTS=1, стирает таблицы!)
npm run typecheck
npm run build
npm run lexicon:build -- <kaikki.org-dictionary-Lithuanian.jsonl>   # пересобрать data/lexicon.json.gz
```
Лексикон: https://kaikki.org/dictionary/Lithuanian/kaikki.org-dictionary-Lithuanian.jsonl (Wiktionary, CC BY-SA).
