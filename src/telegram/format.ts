import type { BankStatus } from '../learn/progress';
import type { CheckResult } from '../tasks/check';
import type { TaskInput, TaskOf } from '../tasks/schema';
import type { Lesson, Word } from '../store/types';
import type { InlineMarkup, ReplyKeyboardMarkup } from './api';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const BTN_START = '▶️ Начать занятие';
export const BTN_MORE_NEW = '➕ Ещё новый материал';
export const BTN_PROGRESS = '📊 Прогресс';

export function mainKeyboard(): ReplyKeyboardMarkup {
  return { keyboard: [[{ text: BTN_START }], [{ text: BTN_MORE_NEW }, { text: BTN_PROGRESS }]], resize_keyboard: true, is_persistent: true };
}

const inline = (rows: [string, string][][]): InlineMarkup => ({
  inline_keyboard: rows.map((r) => r.map(([text, callback_data]) => ({ text, callback_data }))),
});

export const startButton = () => inline([[['▶️ Начать занятие', 'start']]]);
export const afterSessionButtons = () => inline([[['🔁 Ещё занятие', 'start'], ['➕ Новый материал', 'more']]]);

const KIND_LABEL: Record<TaskInput['kind'], string> = {
  choice: 'Выберите ответ',
  input: 'Впишите ответ',
  translate: 'Переведите',
  order: 'Соберите предложение',
  reading: 'Чтение',
  writing: 'Письмо',
};

const header = (n: number, total: number, t: TaskInput) => `<b>${n}/${total}</b> · ${KIND_LABEL[t.kind]}`;

export function formatChoice(t: TaskOf<'choice'>, n: number, total: number) {
  return {
    text: `${header(n, total, t)}\n\n${esc(t.question)}`,
    markup: inline(t.options.map((o, i) => [[o, `c:${i}`]])),
  };
}

export function formatTyped(t: TaskOf<'input'> | TaskOf<'translate'>, n: number, total: number) {
  const body =
    t.kind === 'input'
      ? esc(t.question)
      : `${t.direction === 'ru-lt' ? '🇷🇺 → 🇱🇹' : '🇱🇹 → 🇷🇺'}\n<b>${esc(t.source)}</b>`;
  return {
    text: `${header(n, total, t)}\n\n${body}\n\n<i>Напишите ответ сообщением.</i>`,
    markup: inline([[['🤷 Не знаю', 'idk']]]),
  };
}

export function formatOrder(t: TaskOf<'order'>, picked: number[], n: number, total: number) {
  const built = picked.map((i) => t.words[i]).join(' ');
  const rest = t.words.map((w, i) => [w, i] as const).filter(([, i]) => !picked.includes(i));
  const rows: [string, string][][] = [];
  for (let i = 0; i < rest.length; i += 3) rows.push(rest.slice(i, i + 3).map(([w, idx]) => [w, `o:${idx}`]));
  rows.push([['↩️ Сбросить', 'or'], ['✅ Готово', 'od']]);
  return {
    text: `${header(n, total, t)}\n\n${esc(t.question)}\n\n➡️ ${built ? `<b>${esc(built)}</b>` : '…'}`,
    markup: inline(rows),
  };
}

export function formatReading(t: TaskOf<'reading'>, q: number, n: number, total: number) {
  const question = t.questions[q];
  const glossary = Object.entries(t.glossary);
  const intro =
    q === 0
      ? `${t.title ? `<b>${esc(t.title)}</b>\n` : ''}${esc(t.text)}${glossary.length ? `\n\n<i>${glossary.map(([w, tr]) => `${esc(w)} — ${esc(tr)}`).join('; ')}</i>` : ''}\n\n`
      : '';
  return {
    text: `${header(n, total, t)} · вопрос ${q + 1}/${t.questions.length}\n\n${intro}<b>${esc(question.q)}</b>`,
    markup: inline(question.options.map((o, i) => [[o, `r:${i}`]])),
  };
}

export function formatWritingPrompt(t: TaskOf<'writing'>) {
  return (
    `📝 <b>Письменное задание</b>\n\n${esc(t.prompt)}\n\n` +
    `<i>${t.minWords}–${t.maxWords} слов. Ответьте на это сообщение (reply) или напишите в этой теме. ` +
    `Разбор придёт после следующей генерации заданий.</i>`
  );
}

export function formatWordFront(w: Word, n: number, total: number) {
  return { text: `<b>${n}/${total}</b> · 📖 Слово\n\n<b>${esc(w.lemma)}</b>\n\nПомните перевод?`, markup: inline([[['👀 Показать', 'w:show']]]) };
}

export function formatWordBack(w: Word, n: number, total: number) {
  return {
    text: `<b>${n}/${total}</b> · 📖 Слово\n\n${wordCardBody(w)}`,
    markup: inline([[['✅ Помню', 'w:y'], ['❌ Не помню', 'w:n']]]),
  };
}

const GENDER: Record<string, string> = { m: 'м. р.', f: 'ж. р.' };

export function wordCardBody(w: Pick<Word, 'lemma' | 'translation' | 'pos' | 'gender' | 'keyForms' | 'example'>) {
  const meta = [w.gender ? GENDER[w.gender] : null, w.pos !== 'noun' ? w.pos : null].filter(Boolean).join(', ');
  const lines = [`<b>${esc(w.lemma)}</b> — ${esc(w.translation)}${meta ? ` <i>(${esc(meta)})</i>` : ''}`];
  if (w.keyForms.length > 1) lines.push(`Формы: ${w.keyForms.map(esc).join(', ')}`);
  if (w.example) lines.push(`<i>${esc(w.example)}</i>`);
  return lines.join('\n');
}

export function formatFeedback(r: CheckResult, explanation: string, withDispute: boolean, answerId: string) {
  let text: string;
  if (r.correct && r.exact) text = '✅ Верно!';
  else if (r.correct) text = `✅ Верно! Правильное написание: <b>${esc(r.expected)}</b>`;
  else text = `❌ Правильно: <b>${esc(r.expected)}</b>`;
  if (explanation) text += `\n<i>${esc(explanation)}</i>`;
  return { text, markup: withDispute ? inline([[['🙋 Я ответил правильно', `d:${answerId}`]]]) : undefined };
}

export function formatSummary(correct: number, total: number, weak: string[], bank: BankStatus | null) {
  const lines = [`🏁 <b>Занятие завершено</b>: ${correct}/${total}`];
  if (weak.length) lines.push(`Ошибки: ${weak.map(esc).join(', ')}`);
  if (bank?.low) lines.push(`⚠️ Заданий осталось примерно на ${bank.days} дн. Новые появятся после генерации.`);
  return lines.join('\n');
}

export function formatProgress(x: {
  lesson: Lesson | null; lessonNo: number; lessonsTotal: number; words: number; learned: number; streak: number; bank: BankStatus;
}) {
  const pct = x.lessonsTotal ? Math.round(((x.lessonNo - 1) / x.lessonsTotal) * 100) : 0;
  return [
    `📊 <b>Прогресс</b>`,
    `Урок ${x.lessonNo}${x.lessonsTotal ? ` из ${x.lessonsTotal}` : ''}${x.lesson ? `: ${esc(x.lesson.title)}` : ''} (${pct}% курса)`,
    `Слов в словаре: ${x.words}, выучено (3+ повторения): ${x.learned}`,
    `Серия: ${x.streak} дн. подряд`,
    `Запас заданий: ~${x.bank.days} дн. (порций: ${x.bank.portionsReady}, заданий на закрепление: ${x.bank.reviewReady})`,
  ].join('\n');
}

export const TEXT = {
  welcome:
    '👋 Labas! Я помогу выучить литовский до уровня A2.\n\nДва занятия в день по ~15 минут: утром новое, вечером закрепление. ' +
    'Нажмите «Начать занятие», когда будете готовы.',
  noTask: 'Сейчас я не жду ответа. Нажмите «▶️ Начать занятие».',
  useButtons: 'Ответьте на текущее задание кнопками под ним.',
  stale: 'Это задание уже не активно',
  disputed: 'Отправлено на проверку. Ошибка не засчитана.',
  writingSaved: '📨 Текст сохранён. Разбор придёт после следующей генерации заданий.',
  writingNoPrompt: 'Сейчас нет письменного задания. Оно появится в одном из вечерних занятий.',
  sessionIntro: (slot: 'new' | 'review', revision: boolean, n: number) =>
    revision
      ? `🔁 <b>Повторение урока</b> · ${n} заданий`
      : slot === 'new'
        ? `🆕 <b>Новый материал</b> · ${n} заданий. Теория — в теме 📚 Уроки, новые слова — в 📖 Словарь.`
        : `🔁 <b>Закрепление</b> · ${n} заданий`,
};
